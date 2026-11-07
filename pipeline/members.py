"""Members of Congress, their terms, committees and social accounts, from the volunteer-run
@unitedstates/congress-legislators project (usually updated within a day or two of a change)."""
from __future__ import annotations

import json

from .config import LEGISLATORS_BASE, RAW_DIR, congress_start
from .fetch import download

FILES = (
    "legislators-current.json",
    "legislators-historical.json",
    "legislators-social-media.json",
    "committees-current.json",
    "committee-membership-current.json",
)
CHAMBERS = {"sen": "senate", "rep": "house"}


def sync_members(conn, congress: int, force: bool = False, log=print) -> bool:
    raw = RAW_DIR / "legislators"
    changed = False
    for name in FILES:
        changed |= download(f"{LEGISLATORS_BASE}/{name}", raw / name)
    have = conn.execute("SELECT COUNT(*) FROM members").fetchone()[0]
    if not (changed or force or not have):
        log("members: unchanged")
        return False

    def load(name):
        return json.loads((raw / name).read_text(encoding="utf-8"))

    # Everyone serving now, plus anyone whose service ended during the tracked Congress
    # (resignations, appointments that ended) so their votes still have a name attached.
    since = congress_start(congress)
    people = [(p, 1) for p in load("legislators-current.json")]
    people += [(p, 0) for p in load("legislators-historical.json")
               if any((t.get("end") or "") > since for t in p.get("terms", []))]
    social = {s["id"].get("bioguide"): s.get("social", {}) for s in load("legislators-social-media.json")}

    with conn:
        conn.execute("DELETE FROM members")
        conn.execute("DELETE FROM terms")
        for person, is_current in people:
            ids, name, bio = person["id"], person["name"], person.get("bio", {})
            bioguide = ids["bioguide"]
            conn.execute(
                "INSERT OR REPLACE INTO members VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (bioguide, name.get("first"), name.get("middle"), name.get("last"), name.get("suffix"),
                 name.get("nickname"), name.get("official_full"), bio.get("birthday"), bio.get("gender"),
                 ids.get("lis"), ids.get("icpsr"), ids.get("govtrack"), ids.get("opensecrets"),
                 ids.get("ballotpedia"), ids.get("wikipedia"), is_current,
                 json.dumps(social.get(bioguide) or {})),
            )
            for t in person.get("terms", []):
                chamber = CHAMBERS.get(t.get("type"))
                if not chamber:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO terms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (bioguide, chamber, t.get("start"), t.get("end"), t.get("state"), t.get("district"),
                     t.get("class"), t.get("state_rank"), t.get("party"), t.get("caucus"), t.get("how"),
                     t.get("url"), t.get("phone"), t.get("office") or t.get("address"),
                     t.get("contact_form")),
                )

        conn.execute("DELETE FROM committees")
        conn.execute("DELETE FROM committee_members")
        for c in load("committees-current.json"):
            cid = c.get("thomas_id")
            if not cid:
                continue
            conn.execute("INSERT OR REPLACE INTO committees VALUES (?,?,?,?,?)",
                         (cid, c.get("name"), c.get("type"), None, c.get("url")))
            for sub in c.get("subcommittees", []):
                conn.execute("INSERT OR REPLACE INTO committees VALUES (?,?,?,?,?)",
                             (cid + sub["thomas_id"], sub.get("name"), c.get("type"), cid, None))
        for cid, roster in load("committee-membership-current.json").items():
            for m in roster:
                if m.get("bioguide"):
                    conn.execute("INSERT OR REPLACE INTO committee_members VALUES (?,?,?,?,?)",
                                 (cid, m["bioguide"], m.get("party"), m.get("title"), m.get("rank")))
    log(f"members: loaded {len(people)} legislators")
    return True
