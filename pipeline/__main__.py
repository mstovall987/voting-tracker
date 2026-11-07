"""Command-line entry point.

    python -m pipeline update            download anything new, then rebuild the website data
    python -m pipeline update --force    re-process everything from scratch
    python -m pipeline export            rebuild the website data from the local database only
    python -m pipeline watch             keep updating (default every 30 minutes; --every N)
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime

from . import bills, export, members, votes
from .config import CURRENT_CONGRESS, SENATE_BILL_TYPES
from .db import connect
from .fetch import FetchError, utc_now


def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def _step(conn, key: str, fn) -> None:
    """Run one sync step; a failing source is logged and skipped so the rest still updates."""
    checked = utc_now()
    try:
        changed = bool(fn())
    except FetchError as err:
        log(f"WARNING {key}: {err} -- keeping the data we already have")
        return
    row = conn.execute("SELECT changed_at FROM sync_log WHERE source=?", (key,)).fetchone()
    changed_at = checked if changed or not row else row["changed_at"]
    conn.execute("INSERT OR REPLACE INTO sync_log VALUES (?,?,?,?)", (key, checked, changed_at, None))
    conn.commit()


def update(congress: int, force: bool = False, skip_bills: bool = False) -> None:
    started = time.time()
    conn = connect()
    try:
        _step(conn, "members", lambda: members.sync_members(conn, congress, force=force, log=log))
        _step(conn, "votes:senate", lambda: votes.sync_votes(conn, "senate", congress, force=force, log=log))
        if not skip_bills:
            def sync_senate_bills():
                n = sum(bills.sync_bill_type(conn, congress, t, force=force, log=log) for t in SENATE_BILL_TYPES)
                return n + bills.sync_referenced_house_bills(conn, congress, force=force, log=log)
            _step(conn, "bills:senate", sync_senate_bills)
        export.export_senate(conn, congress, log=log)
    finally:
        conn.close()
    log(f"done in {time.time() - started:.0f}s")


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    parser = argparse.ArgumentParser(prog="python -m pipeline", description="Voting Tracker data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("update", "watch"):
        p = sub.add_parser(name)
        p.add_argument("--congress", type=int, default=CURRENT_CONGRESS)
        p.add_argument("--force", action="store_true", help="re-process everything")
        p.add_argument("--skip-bills", action="store_true", help="only members and votes")
        if name == "watch":
            p.add_argument("--every", type=float, default=30, help="minutes between updates")
    p = sub.add_parser("export")
    p.add_argument("--congress", type=int, default=CURRENT_CONGRESS)
    args = parser.parse_args(argv)

    if args.command == "export":
        conn = connect()
        try:
            export.export_senate(conn, args.congress, log=log)
        finally:
            conn.close()
    elif args.command == "update":
        update(args.congress, force=args.force, skip_bills=args.skip_bills)
    else:
        log(f"watching: updating every {args.every:g} minutes (Ctrl+C to stop)")
        first = True
        while True:
            try:
                update(args.congress, force=args.force and first, skip_bills=args.skip_bills)
            except Exception as err:  # keep the loop alive through unexpected errors
                log(f"ERROR during update: {err!r}")
            first = False
            time.sleep(args.every * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
