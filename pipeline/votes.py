"""Roll-call votes from Voteview (voteview.com, UCLA).

Voteview republishes every House and Senate roll call with each member's position, normally by
the morning after the vote. We use it because senate.gov's own XML feed blocks automated
downloads. The same loader works for the House (chamber="house") when we expand.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict

from .config import RAW_DIR, VOTEVIEW_BASE
from .fetch import download

PREFIX = {"senate": "S", "house": "H"}
# Voteview cast codes. Paired/announced positions (2-5) are not recorded votes, so they count
# as "Not Voting", the same way the official tallies treat them.
CAST = {"1": "Yea", "6": "Nay", "7": "Present", "8": "Present"}
PARTY = {"100": "D", "200": "R"}
DOC_RE = re.compile(r"^(HCONRES|HJRES|HRES|HR|SCONRES|SJRES|SRES|S)(\d+)$")
PASSAGE = {
    "on passage of the bill", "on passage", "on the joint resolution", "on the resolution",
    "on the concurrent resolution", "on the conference report", "on the resolution of ratification",
    "on overriding the veto",
}
NEGATIVE = ("rejected", "defeated", "failed", "not agreed", "not sustained", "not well taken",
            "not confirmed", "not invoked", "not passed")
POSITIVE = ("agreed", "passed", "confirmed", "sustained", "well taken", "adopted", "invoked",
            "ratified", "overridden")


def bill_id_for(document: str, congress: int) -> str | None:
    m = DOC_RE.match(document or "")
    return f"{m.group(1).lower()}{int(m.group(2))}-{congress}" if m else None


def classify(question: str, document: str) -> str:
    q = (question or "").strip().lower()
    if document.startswith("PN"):
        return "nomination"
    if "cloture" in q:
        return "cloture"
    if q == "on the amendment":
        return "amendment"
    if q in PASSAGE or q.startswith("on the motion to concur") or "veto" in q:
        return "passage"
    if q.startswith("guilty"):
        return "impeachment"
    return "procedural"


def outcome(result: str) -> int | None:
    r = (result or "").lower()
    if any(w in r for w in NEGATIVE):
        return 0
    if any(w in r for w in POSITIVE):
        return 1
    return None


def sync_votes(conn, chamber: str, congress: int, force: bool = False, log=print) -> bool:
    prefix = PREFIX[chamber]
    raw = RAW_DIR / "voteview"
    names = {kind: f"{prefix}{congress}_{kind}.csv" for kind in ("rollcalls", "votes", "members")}
    changed = False
    for kind, name in names.items():
        changed |= download(f"{VOTEVIEW_BASE}/{kind}/{name}", raw / name)
    have = conn.execute("SELECT COUNT(*) FROM votes WHERE chamber=? AND congress=?",
                        (chamber, congress)).fetchone()[0]
    if not (changed or force or not have):
        log(f"votes ({chamber}): unchanged, {have} roll calls")
        return False

    def rows(kind):
        with open(raw / names[kind], newline="", encoding="utf-8") as fh:
            return list(csv.DictReader(fh))

    members = {m["icpsr"]: m for m in rows("members")
               if m["chamber"].lower() == chamber and m["bioguide_id"]}
    by_roll = defaultdict(list)
    for v in rows("votes"):
        if v["cast_code"] != "0":
            by_roll[v["rollnumber"]].append(v)

    vote_rows, position_rows = [], []
    for rc in rows("rollcalls"):
        session, number = int(rc["session"]), int(rc["clerk_rollnumber"])
        vote_id = f"{prefix.lower()}{congress}-{session}-{number}"
        document = (rc["bill_number"] or "").strip().upper()
        tally = {"Yea": 0, "Nay": 0, "Present": 0, "Not Voting": 0}
        seen = set()
        for v in by_roll.get(rc["rollnumber"], []):
            m = members.get(v["icpsr"])
            if not m or m["bioguide_id"] in seen:
                continue
            seen.add(m["bioguide_id"])
            position = CAST.get(v["cast_code"], "Not Voting")
            tally[position] += 1
            position_rows.append((vote_id, m["bioguide_id"], position,
                                  PARTY.get(m["party_code"], "I"), m["state_abbrev"]))
        vote_rows.append((
            vote_id, chamber, congress, session, number, rc["date"], rc["vote_question"],
            rc["vote_result"], rc["vote_desc"], classify(rc["vote_question"], document), document,
            bill_id_for(document, congress), rc["majority_requirement"], tally["Yea"], tally["Nay"],
            tally["Present"], tally["Not Voting"], outcome(rc["vote_result"]), "voteview",
        ))

    with conn:
        conn.execute("DELETE FROM vote_positions WHERE vote_id IN "
                     "(SELECT vote_id FROM votes WHERE chamber=? AND congress=?)", (chamber, congress))
        conn.execute("DELETE FROM votes WHERE chamber=? AND congress=?", (chamber, congress))
        conn.executemany(f"INSERT INTO votes VALUES ({','.join('?' * 19)})", vote_rows)
        conn.executemany("INSERT OR REPLACE INTO vote_positions VALUES (?,?,?,?,?)", position_rows)
        conn.execute("DELETE FROM member_scores WHERE chamber=? AND congress=?", (chamber, congress))
        for m in members.values():
            if m["nominate_dim1"]:
                conn.execute("INSERT OR REPLACE INTO member_scores VALUES (?,?,?,?,?)",
                             (m["bioguide_id"], chamber, congress, float(m["nominate_dim1"]),
                              float(m["nominate_dim2"]) if m["nominate_dim2"] else None))
    log(f"votes ({chamber}): loaded {len(vote_rows)} roll calls, {len(position_rows)} positions")
    return True
