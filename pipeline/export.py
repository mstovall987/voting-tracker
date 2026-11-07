"""Builds the static JSON files the website reads (web/data/senate/...) from the database.

This is also where the per-senator statistics are computed: attendance, party unity, agreement
with colleagues, sponsorship activity and month-by-month trends.

Definitions used (shown on the site too):
  * Missed votes    = roll calls a senator was eligible for but did not vote on.
  * Party-line vote = a roll call where most voting Democrats and most voting Republicans took
                      opposite sides. Independents count with the party they caucus with.
  * Party unity     = share of party-line votes where the senator sided with their caucus.
  * Agreement       = share of roll calls (where both voted Yea or Nay) with the same position.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from statistics import median

from .config import PHOTO_URL, SENATE_BILL_TYPES, WEB_DATA_DIR, congress_end, congress_start
from .fetch import utc_now
from .topics import LABELS as TOPIC_LABELS, TOPICS, topic_for_area, vote_topic

BILL_LABEL = {"s": "S.", "sres": "S.Res.", "sjres": "S.J.Res.", "sconres": "S.Con.Res.",
              "hr": "H.R.", "hres": "H.Res.", "hjres": "H.J.Res.", "hconres": "H.Con.Res."}
CONGRESS_GOV_TYPE = {"s": "senate-bill", "sres": "senate-resolution",
                     "sjres": "senate-joint-resolution", "sconres": "senate-concurrent-resolution",
                     "hr": "house-bill", "hres": "house-resolution",
                     "hjres": "house-joint-resolution", "hconres": "house-concurrent-resolution"}
PARTY_LETTER = {"Democrat": "D", "Republican": "R", "Independent": "I"}
POSITIONS = ("Yea", "Nay", "Present", "Not Voting")
POS_CHAR = {"Yea": "Y", "Nay": "N", "Present": "P", "Not Voting": "-"}
ADVANCED = {"passed_senate", "passed_house", "passed_both", "to_president", "law", "vetoed"}
SHARD_SIZE = 50          # bills per detail file (keeps the file count manageable)
MIN_SHARED_VOTES = 25    # minimum overlap before reporting how often two senators agree

SOURCES = {
    "votes:senate": ("Voteview (UCLA)", "https://voteview.com/data",
                     "Senate roll-call votes and each senator's position; DW-NOMINATE scores"),
    "bills:senate": ("GovInfo BILLSTATUS (Congress.gov data)", "https://www.govinfo.gov/bulkdata/BILLSTATUS",
                     "Bills, sponsors, cosponsors, actions and CRS summaries"),
    "members": ("@unitedstates/congress-legislators", "https://github.com/unitedstates/congress-legislators",
                "Senators, terms, contact info and committee assignments"),
}


# --------------------------------------------------------------------------- helpers

def ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def parse_bill_id(bill_id: str | None):
    m = re.match(r"^([a-z]+)(\d+)-(\d+)$", bill_id or "")
    return (m.group(1), int(m.group(2)), int(m.group(3))) if m else (None, None, None)


def bill_label(bill_id: str) -> str:
    btype, number, _ = parse_bill_id(bill_id)
    return f"{BILL_LABEL.get(btype, (btype or '').upper())} {number}" if btype else bill_id


def bill_url(bill_id: str) -> str | None:
    btype, number, congress = parse_bill_id(bill_id)
    if btype not in CONGRESS_GOV_TYPE:
        return None
    return f"https://www.congress.gov/bill/{ordinal(congress)}-congress/{CONGRESS_GOV_TYPE[btype]}/{number}"


def party_letter(value: str | None) -> str | None:
    v = (value or "").strip()
    if v in PARTY_LETTER:
        return PARTY_LETTER[v]
    return v if v in ("D", "R") else ("I" if v else None)


def pct(num, den):
    return round(100.0 * num / den, 1) if den else None


def days_between(a: str, b: str) -> int:
    return abs((date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days)


def month_range(first: str, last: str) -> list[str]:
    y, m = int(first[:4]), int(first[5:7])
    ey, em = int(last[:4]), int(last[5:7])
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def truncate(text: str | None, limit: int) -> str | None:
    if not text or len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def write_json(path: Path, obj) -> bool:
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == data:
        return False
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(path)
    return True


# --------------------------------------------------------------------------- loading

def load_committees(conn) -> dict[str, list]:
    info = {r["committee_id"]: dict(r) for r in conn.execute("SELECT * FROM committees")}
    by_member = defaultdict(list)
    for r in conn.execute("SELECT * FROM committee_members ORDER BY committee_id"):
        c = info.get(r["committee_id"])
        if not c or c["chamber"] not in ("senate", "joint"):
            continue
        by_member[r["bioguide_id"]].append({
            "id": c["committee_id"], "pid": c["parent_id"], "name": c["name"], "url": c["url"],
            "title": r["title"], "side": r["side"], "chamber": c["chamber"],
        })
    out = {}
    for bg, rows in by_member.items():
        mains = {r["id"]: {**r, "subs": []} for r in rows if not r["pid"]}
        for r in rows:
            if r["pid"]:
                parent = mains.get(r["pid"])
                if parent is not None:
                    parent["subs"].append({"name": r["name"], "title": r["title"]})
                else:
                    mains[r["id"]] = {**r, "subs": []}
        out[bg] = [{k: v for k, v in c.items() if k not in ("pid",)}
                   for c in sorted(mains.values(), key=lambda c: (c["title"] is None, c["name"] or ""))]
    return out


def load_senators(conn, congress: int, today: str) -> list[dict]:
    start, end = congress_start(congress), congress_end(congress)
    members = {r["bioguide_id"]: dict(r) for r in conn.execute("SELECT * FROM members")}
    terms = defaultdict(list)
    for r in conn.execute("SELECT * FROM terms ORDER BY start_date"):
        terms[r["bioguide_id"]].append(dict(r))
    scores = dict(conn.execute("SELECT bioguide_id, nominate_dim1 FROM member_scores "
                               "WHERE chamber='senate' AND congress=?", (congress,)).fetchall())
    committees = load_committees(conn)

    senators = []
    for bg, ts in terms.items():
        m = members.get(bg)
        senate = [t for t in ts if t["chamber"] == "senate"]
        here = [t for t in senate if t["start_date"] < end and (t["end_date"] or "9999-12-31") > start]
        if not m or not here:
            continue
        cur = here[-1]
        # Trust "is current" over the term's end date: appointed senators' terms are listed as
        # ending on the special-election date, but they serve until a successor is sworn in.
        current = bool(m["is_current"]) and cur is ts[-1] and cur["start_date"] <= today
        party = party_letter(cur["party"]) or "I"
        caucus = party_letter(cur["caucus"]) if cur["caucus"] else party
        since = cur["start_date"]
        for prev in reversed(senate[:senate.index(cur)]):
            if prev["end_date"] and days_between(prev["end_date"], since) <= 45:
                since = prev["start_date"]
            else:
                break
        senators.append({
            "id": bg,
            "name": m["official_name"] or f"{m['first_name']} {m['last_name']}",
            "last": m["last_name"],
            "party": party,
            "caucus": caucus,
            "state": cur["state"],
            "cls": cur["senate_class"],
            "rank": cur["state_rank"],
            "current": current,
            "since": since,
            "termEnd": cur["end_date"],
            "left": None if current else cur["end_date"],
            "how": cur["how"],
            "photo": PHOTO_URL.format(bioguide=bg),
            "ideo": scores.get(bg),
            "_m": m, "_terms": ts, "_cur": cur, "_committees": committees.get(bg, []),
        })
    senators.sort(key=lambda s: (s["state"] or "", not s["current"], s["cls"] or 0, s["since"]))
    return senators


def career(terms: list[dict]) -> list[dict]:
    """Merge back-to-back terms in the same seat into one span."""
    spans = []
    for t in terms:
        key = (t["chamber"], t["state"], t["district"] if t["chamber"] == "house" else None)
        if spans and spans[-1]["_key"] == key and spans[-1]["end"] and \
                days_between(spans[-1]["end"], t["start_date"]) <= 45:
            spans[-1]["end"] = t["end_date"]
            spans[-1]["party"] = party_letter(t["party"])
        else:
            spans.append({"_key": key, "chamber": t["chamber"], "state": t["state"],
                          "district": t["district"] if t["chamber"] == "house" else None,
                          "start": t["start_date"], "end": t["end_date"], "party": party_letter(t["party"])})
    return [{k: v for k, v in s.items() if k != "_key"} for s in spans]


def member_links(s: dict) -> dict:
    m, bg = s["_m"], s["id"]
    slug = re.sub(r"[^a-z]+", "-", f"{m['first_name']} {m['last_name']}".lower()).strip("-")
    links = {
        "Congress.gov": f"https://www.congress.gov/member/{slug}/{bg}",
        "Biography": f"https://bioguide.congress.gov/search/bio/{bg}",
    }
    if m["ballotpedia"]:
        links["Ballotpedia"] = "https://ballotpedia.org/" + m["ballotpedia"].replace(" ", "_")
    if m["wikipedia"]:
        links["Wikipedia"] = "https://en.wikipedia.org/wiki/" + m["wikipedia"].replace(" ", "_")
    if m["opensecrets_id"]:
        links["OpenSecrets"] = f"https://www.opensecrets.org/members-of-congress/summary?cid={m['opensecrets_id']}"
    social = json.loads(m["social_json"] or "{}")
    if social.get("twitter"):
        links["X / Twitter"] = f"https://x.com/{social['twitter']}"
    if social.get("facebook"):
        links["Facebook"] = f"https://www.facebook.com/{social['facebook']}"
    if social.get("instagram"):
        links["Instagram"] = f"https://www.instagram.com/{social['instagram']}"
    if social.get("youtube"):
        links["YouTube"] = f"https://www.youtube.com/{social['youtube']}"
    elif social.get("youtube_id"):
        links["YouTube"] = f"https://www.youtube.com/channel/{social['youtube_id']}"
    return links


# --------------------------------------------------------------------------- analysis

def analyze_votes(conn, congress: int, senators: list[dict]):
    ids = [s["id"] for s in senators]
    caucus_of = {s["id"]: s["caucus"] for s in senators}
    votes = [dict(r) for r in conn.execute(
        "SELECT * FROM votes WHERE chamber='senate' AND congress=? ORDER BY date, session, number",
        (congress,))]
    positions = defaultdict(dict)
    for r in conn.execute(
            "SELECT p.vote_id, p.bioguide_id, p.position, p.party FROM vote_positions p "
            "JOIN votes v ON v.vote_id = p.vote_id WHERE v.chamber='senate' AND v.congress=?",
            (congress,)):
        positions[r["vote_id"]][r["bioguide_id"]] = (r["position"], r["party"])

    stats = {bg: Counter() for bg in ids}
    monthly = {bg: defaultdict(Counter) for bg in ids}
    caucus_monthly = defaultdict(Counter)
    yea_bits = dict.fromkeys(ids, 0)
    nay_bits = dict.fromkeys(ids, 0)
    out = []
    for idx, v in enumerate(votes):
        pos = positions.get(v["vote_id"], {})
        by_party = {"D": [0, 0, 0, 0], "R": [0, 0, 0, 0], "I": [0, 0, 0, 0]}
        side = {"D": Counter(), "R": Counter()}
        for bg, (p, party) in pos.items():
            by_party.setdefault(party or "I", [0, 0, 0, 0])[POSITIONS.index(p)] += 1
            c = caucus_of.get(bg)
            if c in side and p in ("Yea", "Nay"):
                side[c][p] += 1

        def majority(c):
            y, n = side[c]["Yea"], side[c]["Nay"]
            return "Y" if y > n else "N" if n > y else None

        dm, rm = majority("D"), majority("R")
        party_line = bool(dm and rm and dm != rm)
        month = v["date"][:7]
        for bg, (p, _party) in pos.items():
            if bg not in stats:
                continue
            s, mo = stats[bg], monthly[bg][month]
            s["eligible"] += 1
            mo["e"] += 1
            if p == "Not Voting":
                s["missed"] += 1
                mo["mv"] += 1
                continue
            if p == "Present":
                s["present"] += 1
                continue
            if p == "Yea":
                yea_bits[bg] |= 1 << idx
            else:
                nay_bits[bg] |= 1 << idx
            c = caucus_of.get(bg)
            if party_line and c in ("D", "R"):
                with_party = p[0] == (dm if c == "D" else rm)
                s["unity_votes"] += 1
                mo["uv"] += 1
                caucus_monthly[(c, month)]["uv"] += 1
                if with_party:
                    s["unity_with"] += 1
                    mo["uw"] += 1
                    caucus_monthly[(c, month)]["uw"] += 1
            if v["passed"] is not None:
                s["decided"] += 1
                if (p == "Yea") == bool(v["passed"]):
                    s["won"] += 1
        out.append({
            "id": v["vote_id"], "s": v["session"], "n": v["number"], "d": v["date"],
            "q": v["question"], "r": v["result"], "desc": v["description"], "cat": v["category"],
            "doc": v["document"], "bill": v["bill_id"], "req": v["majority_req"],
            "t": [v["yea"], v["nay"], v["present"], v["not_voting"]],
            "p": by_party, "pl": party_line, "dm": dm, "rm": rm, "ok": v["passed"],
            "pos": "".join(POS_CHAR[pos[bg][0]] if bg in pos else "." for bg in ids),
        })

    agreement = {}
    for a in ids:
        voted_a = yea_bits[a] | nay_bits[a]
        rows = []
        for b in ids:
            if a == b:
                continue
            both = (voted_a & (yea_bits[b] | nay_bits[b])).bit_count()
            if both < MIN_SHARED_VOTES:
                continue
            same = ((yea_bits[a] & yea_bits[b]) | (nay_bits[a] & nay_bits[b])).bit_count()
            rows.append((same / both, b, both))
        agreement[a] = rows
    return out, stats, monthly, caucus_monthly, agreement


def load_bills(conn, congress: int):
    bills = {r["bill_id"]: dict(r) for r in conn.execute("SELECT * FROM bills WHERE congress=?", (congress,))}
    cos, actions, subjects = defaultdict(list), defaultdict(list), defaultdict(list)
    for r in conn.execute("SELECT c.* FROM cosponsors c JOIN bills b USING (bill_id) "
                          "WHERE b.congress=? ORDER BY c.date, c.name", (congress,)):
        cos[r["bill_id"]].append(dict(r))
    for r in conn.execute("SELECT a.* FROM bill_actions a JOIN bills b USING (bill_id) "
                          "WHERE b.congress=? ORDER BY a.bill_id, a.seq", (congress,)):
        actions[r["bill_id"]].append(dict(r))
    for r in conn.execute("SELECT s.* FROM bill_subjects s JOIN bills b USING (bill_id) "
                          "WHERE b.congress=? ORDER BY s.subject", (congress,)):
        subjects[r["bill_id"]].append(r["subject"])
    return bills, cos, actions, subjects


def bill_summary(b: dict, cos_rows: list[dict], names: dict) -> dict:
    active = [c for c in cos_rows if not c["withdrawn_date"]]
    cp = Counter(c["party"] for c in active)
    return {
        "id": b["bill_id"], "label": bill_label(b["bill_id"]),
        "title": b["title"] or b["official_title"] or bill_label(b["bill_id"]),
        "intro": b["introduced_date"], "la": b["latest_action_date"],
        "lt": truncate(b["latest_action_text"], 200), "st": b["status"], "sd": b["status_date"],
        "pa": b["policy_area"], "tp": topic_for_area(b["policy_area"]),
        "cc": len(active), "cp": [cp.get("D", 0), cp.get("R", 0), cp.get("I", 0)],
        "sp": b["sponsor_id"], "spn": names.get(b["sponsor_id"]) or b["sponsor_name"],
        "spp": b["sponsor_party"], "sps": b["sponsor_state"], "law": b["law_number"],
    }


def topic_votes(votes: list[dict], ids: list[str]):
    """Per senator and topic: Yea/Nay votes cast, party-line votes, and whose majority they
    sided with on those. Also each senator's Yea/Nay on final confirmation votes."""
    tstats = {bg: defaultdict(Counter) for bg in ids}
    confirms = {bg: Counter() for bg in ids}
    for v in votes:
        confirmation = v["cat"] == "nomination" and (v["q"] or "").strip().lower() == "on the nomination"
        for i, bg in enumerate(ids):
            p = v["pos"][i]
            if p != "Y" and p != "N":
                continue
            c = tstats[bg][v["tp"]]
            c["votes"] += 1
            if v["pl"]:  # parties on opposite sides, so p matches exactly one majority
                c["pl"] += 1
                c["withD" if p == v["dm"] else "withR"] += 1
            if confirmation:
                confirms[bg][p] += 1
    return tstats, confirms


# ---- key votes: the roll calls most people care about, picked by fixed, visible rules
CABINET_RE = re.compile(
    r"to be (Secretary of (?!the (Army|Navy|Air Force))|Attorney General|Director of National Intelligence|"
    r"Director of the Central Intelligence Agency|Director of the Office of Management and Budget|"
    r"Administrator of the Environmental Protection Agency|United States Trade Representative|"
    r"Representative of the United States of America to the United Nations|"
    r"Administrator of the Small Business Administration|Chief Justice of the United States|"
    r"Associate Justice of the Supreme Court|Chairman of the Board of Governors of the Federal Reserve)", re.I)
WAR_POWERS_RE = re.compile(r"war powers|from hostilities", re.I)
CLOSE_MARGIN = 2  # decided by this many votes or fewer (ties are broken by the Vice President)


def key_reasons(v: dict, bill: dict | None) -> list[str]:
    """Why a roll call counts as a key vote (empty list if it doesn't). Reasons:
    law       final vote on a measure that became law
    passage   final passage of a bill, whatever the outcome
    budget    final vote on a budget resolution, reconciliation or spending bill
    veto      vote to override a veto
    cabinet   confirmation of a cabinet-level official, Supreme Court justice or Fed chair
    close     final passage or confirmation decided by 2 votes or fewer
    war       war powers resolutions (directing the President to end military action)"""
    reasons = []
    q = (v["q"] or "").strip().lower()
    confirmation = v["cat"] == "nomination" and q == "on the nomination"
    final = v["cat"] == "passage"
    if final:
        if bill and bill.get("st") == "law":
            reasons.append("law")
        elif q == "on passage of the bill":
            reasons.append("passage")
        if bill and bill.get("tp") == "budget":
            reasons.append("budget")
        if "veto" in q:
            reasons.append("veto")
    # A single roll call can confirm several nominees at once; judge it by the first one named.
    if confirmation and CABINET_RE.search((v["desc"] or "").split(";")[0]):
        reasons.append("cabinet")
    if (final or confirmation) and abs(v["t"][0] - v["t"][1]) <= CLOSE_MARGIN:
        reasons.append("close")
    if v["cat"] != "amendment" and WAR_POWERS_RE.search(f"{v['desc'] or ''} {(bill or {}).get('title') or ''}"):
        reasons.append("war")
    return reasons


PARTY_PLURAL = {"D": "Democrats", "R": "Republicans"}


def join_and(parts) -> str:
    parts = list(parts)
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def count_measures(n: int) -> str:
    return f"{n} bill or resolution" if n == 1 else f"{n} bills and resolutions"


def summarize(s: dict, st: dict, topic_rows: list[dict], ctx: dict) -> list[str]:
    """A few plain-English sentences built only from numbers shown elsewhere on the profile."""
    name = s["last"]
    if st["eligible"] < 40:
        return [f"{name} cast only {st['eligible']} roll-call votes this Congress, too few to summarize."]
    caucus = s["caucus"] if s["caucus"] in ("D", "R") else None
    own = ("the Democratic caucus" if s["party"] == "I" else PARTY_PLURAL[caucus]) if caucus else None
    other = PARTY_PLURAL["R" if caucus == "D" else "D"] if caucus else None
    med = ctx["medians"]
    out = []

    unity = st["unity"]
    if own and unity is not None:
        rank = ctx["unity_rank"].get(s["id"]) if s["current"] else None
        if rank == 1:
            out.append(f"{name} breaks with {own} more often than any other senator, siding with them on "
                       f"{unity:.1f}% of party-line votes.")
        elif rank and rank <= 10:
            out.append(f"{name} is among the senators most likely to break with {own}, siding with them on "
                       f"{unity:.1f}% of party-line votes ({ordinal(rank)}-lowest of {ctx['n_ranked']}).")
        elif unity >= 95:
            out.append(f"{name} is a dependable vote for {own}, siding with them on {unity:.1f}% of "
                       f"party-line votes.")
        else:
            out.append(f"{name} usually votes with {own}, siding with them on {unity:.1f}% of party-line votes.")
        crossings = []
        for t in topic_rows:
            if t["id"] == "other" or t["pl"] < 6:
                continue
            cross = t["withR"] if caucus == "D" else t["withD"]
            if cross >= 3 and cross / t["pl"] >= 0.2:
                crossings.append((cross / t["pl"], cross, t))
        crossings.sort(key=lambda c: (-c[0], -c[1]))
        if crossings:
            parts = [f"{TOPIC_LABELS[t['id']].lower()} ({cross} of {t['pl']}{' party-line votes' if i == 0 else ''})"
                     for i, (_, cross, t) in enumerate(crossings[:2])]
            out.append(f"{name} sides with {other} most often on {join_and(parts)}.")
        elif unity >= 95:
            out.append(f"There is no issue area where {name} regularly crosses party lines.")

    total = st["sponsored"]
    if total == 0:
        out.append(f"{name} has not introduced any bills or resolutions this Congress.")
    else:
        top = [t for t in sorted(topic_rows, key=lambda t: -t["sp"]) if t["sp"] and t["id"] != "other"][:2]
        parts = [f"{TOPIC_LABELS[t['id']].lower()} ({t['sp']})" for t in top]
        focus = f", most often on {join_and(parts)}" if parts else ""
        laws = st["enacted"]
        law_text = ("none has become law yet" if laws == 0 else "one has become law" if laws == 1
                    else f"{laws} have become law")
        out.append(f"{name} has introduced {count_measures(total)}{focus}; {law_text}.")
        bp, mbp = st["bipartisanPct"], med["bipartisanPct"]
        if bp is not None and mbp is not None and total >= 5:
            compare = ("more often than" if bp >= mbp + 10 else "less often than" if bp <= mbp - 10
                       else "about as often as")
            out.append(f"{bp:.0f}% of them have at least one cosponsor from the other party, {compare} "
                       f"the typical senator ({mbp:.0f}%).")

    c = ctx["confirms"].get(s["id"], {})
    yes, total_c = c.get("Y", 0), c.get("Y", 0) + c.get("N", 0)
    if total_c >= 10:
        out.append(f"On final confirmation votes, {name} voted for {round(100 * yes / total_c)}% of the "
                   f"President's nominees ({yes} of {total_c}).")

    mp, mm = st["missedPct"], med["missedPct"]
    if mp is not None and mm is not None and mp >= max(5.0, 2 * mm):
        out.append(f"{name} has missed {mp:.1f}% of roll-call votes, more than most senators (median {mm:.1f}%).")
    return out


# --------------------------------------------------------------------------- export

def export_senate(conn, congress: int, log=print) -> None:
    out = WEB_DATA_DIR / "senate"
    today = date.today().isoformat()
    start, end = congress_start(congress), congress_end(congress)
    senators = load_senators(conn, congress, today)
    ids = [s["id"] for s in senators]
    caucus_of = {s["id"]: s["caucus"] for s in senators}
    names = {s["id"]: s["name"] for s in senators}

    votes, vstats, monthly, caucus_monthly, agreement = analyze_votes(conn, congress, senators)
    bills, cos, actions, subjects = load_bills(conn, congress)
    summaries = {bid: bill_summary(b, cos[bid], names) for bid, b in bills.items()}
    for v in votes:  # each roll call takes its bill's topic (or its amendment's, on budget bills)
        v["tp"] = vote_topic(v["cat"], v["desc"], summaries[v["bill"]]["tp"] if v["bill"] in summaries else None)
        reasons = key_reasons(v, summaries.get(v["bill"]))
        if reasons:
            v["key"] = reasons
    tstats, confirms = topic_votes(votes, ids)

    sponsored_by, cosponsored_by = defaultdict(list), defaultdict(list)
    for bid, b in bills.items():
        if b["bill_type"] in SENATE_BILL_TYPES and b["sponsor_id"]:
            sponsored_by[b["sponsor_id"]].append(bid)
        for c in cos[bid]:
            if not c["withdrawn_date"]:
                cosponsored_by[c["bioguide_id"]].append(c)

    def side_of(bioguide, party):
        return caucus_of.get(bioguide) or ("D" if party == "I" else party)

    last_month = min(today, end)[:7]
    if votes:
        last_month = max(last_month, votes[-1]["d"][:7])
    months = month_range(start, last_month)

    # ---- pass 1: every senator's numbers (pass 2 compares them with Senate-wide medians)
    computed = {}
    for s in senators:
        bg = s["id"]
        st = vstats[bg]
        sp = sorted((bills[x] for x in sponsored_by.get(bg, [])),
                    key=lambda b: (b["introduced_date"] or "", b["number"]), reverse=True)
        co = sorted(cosponsored_by.get(bg, []), key=lambda c: c["date"] or "", reverse=True)
        my_side = side_of(bg, s["party"])
        bipartisan = sum(1 for b in sp if any(side_of(c["bioguide_id"], c["party"]) != my_side
                                             for c in cos[b["bill_id"]] if not c["withdrawn_date"]))
        cross_co = sum(1 for c in co if bills.get(c["bill_id"]) and
                       side_of(bills[c["bill_id"]]["sponsor_id"], bills[c["bill_id"]]["sponsor_party"]) != my_side)
        sp_bills = [b for b in sp if b["bill_type"] in ("s", "sjres")]
        mon = monthly[bg]
        for b in sp:
            if b["introduced_date"]:
                mon[b["introduced_date"][:7]]["sp"] += 1
        for c in co:
            if c["date"]:
                mon[c["date"][:7]]["co"] += 1
        for b in sp:
            tstats[bg][summaries[b["bill_id"]]["tp"]]["sp"] += 1
        for c in co:
            if c["bill_id"] in summaries:
                tstats[bg][summaries[c["bill_id"]]["tp"]]["co"] += 1

        stats = {
            "eligible": st["eligible"], "missed": st["missed"], "present": st["present"],
            "missedPct": pct(st["missed"], st["eligible"]),
            "partyLineVotes": st["unity_votes"], "unity": pct(st["unity_with"], st["unity_votes"]),
            "winPct": pct(st["won"], st["decided"]),
            "sponsored": len(sp), "sponsoredBills": len(sp_bills), "sponsoredRes": len(sp) - len(sp_bills),
            "cosponsored": len(co),
            "enacted": sum(1 for b in sp if b["status"] == "law"),
            "passedSenate": sum(1 for b in sp_bills if b["status"] in ADVANCED),
            "bipartisan": bipartisan, "bipartisanPct": pct(bipartisan, len(sp)),
            "crossCosponsorPct": pct(cross_co, len(co)),
        }
        computed[bg] = (stats, sp, co)

    current_ids = [s["id"] for s in senators if s["current"]]

    def med(key):
        values = [computed[bg][0][key] for bg in current_ids if computed[bg][0][key] is not None]
        return round(median(values), 1) if values else None

    medians = {k: med(k) for k in ("missedPct", "unity", "sponsored", "cosponsored", "bipartisanPct", "enacted")}
    ranked = sorted((computed[bg][0]["unity"], bg) for bg in current_ids if computed[bg][0]["unity"] is not None)
    ctx = {"medians": medians, "unity_rank": {bg: i + 1 for i, (_, bg) in enumerate(ranked)},
           "n_ranked": len(ranked), "confirms": confirms}

    # ---- pass 2: per-senator files
    listing = []
    for s in senators:
        bg = s["id"]
        stats, sp, co = computed[bg]
        mon = monthly[bg]
        public = {k: v for k, v in s.items() if not k.startswith("_")}
        listing.append({**public, "stats": stats})
        topic_rows = sorted(
            ({"id": tp, **{k: c[k] for k in ("votes", "pl", "withD", "withR", "sp", "co")}}
             for tp, c in tstats[bg].items()),
            key=lambda t: (-(t["pl"] + t["sp"] + t["votes"]), t["id"]))

        rows = agreement.get(bg, [])
        fmt = lambda r: {"id": r[1], "pct": round(100 * r[0], 1), "n": r[2]}
        cur = s["_cur"]
        detail = {
            **public,
            "official": s["_m"]["official_name"],
            "birthday": s["_m"]["birthday"],
            "gender": s["_m"]["gender"],
            "url": cur["url"], "phone": cur["phone"], "office": cur["office"], "contact": cur["contact_form"],
            "links": member_links(s),
            "career": career(s["_terms"]),
            "committees": s["_committees"],
            "stats": stats,
            "monthly": [{"m": m, "e": mon[m]["e"], "mv": mon[m]["mv"], "uv": mon[m]["uv"],
                         "uw": mon[m]["uw"], "sp": mon[m]["sp"], "co": mon[m]["co"]} for m in months],
            "agreement": {
                "top": [fmt(r) for r in sorted(rows, reverse=True)[:5]],
                "cross": [fmt(r) for r in sorted((r for r in rows if caucus_of.get(r[1]) != s["caucus"]),
                                                 reverse=True)[:5]],
                "ownLow": [fmt(r) for r in sorted(r for r in rows if caucus_of.get(r[1]) == s["caucus"])[:5]],
            },
            "policyAreas": Counter(b["policy_area"] for b in sp if b["policy_area"]).most_common(),
            "topics": topic_rows,
            "summary": summarize(s, stats, topic_rows, ctx),
            "sponsored": [summaries[b["bill_id"]] for b in sp],
            "cosponsored": [{**summaries[c["bill_id"]], "cd": c["date"], "orig": c["is_original"]}
                            for c in co if c["bill_id"] in summaries],
        }
        write_json(out / "members" / f"{bg}.json", detail)

    for stale in (out / "members").glob("*.json"):
        if stale.stem not in ids:
            stale.unlink()
    write_json(out / "senators.json", listing)

    # ---- votes (with every senator's position, in `members` order)
    referenced = {v["bill"] for v in votes if v["bill"]}
    write_json(out / "votes.json", {
        "members": ids,
        "votes": votes,
        "bills": {bid: {"label": summaries[bid]["label"], "title": summaries[bid]["title"],
                        "st": summaries[bid]["st"], "law": summaries[bid]["law"]}
                  for bid in sorted(referenced) if bid in summaries},
    })

    # ---- bills: one searchable index + detail shards
    votes_by_bill = defaultdict(list)
    for v in votes:
        if v["bill"]:
            votes_by_bill[v["bill"]].append({"id": v["id"], "d": v["d"], "q": v["q"], "r": v["r"],
                                             "t": v["t"], "cat": v["cat"], "desc": v["desc"], "ok": v["ok"],
                                             "key": v.get("key")})
    index = sorted(summaries.values(), key=lambda x: (x["intro"] or "", x["id"]), reverse=True)
    write_json(out / "bills" / "index.json", index)
    shards = defaultdict(dict)
    for bid, b in bills.items():
        shards[f"{b['bill_type']}-{b['number'] // SHARD_SIZE}"][bid] = {
            **summaries[bid],
            "shortTitle": b["short_title"], "officialTitle": b["official_title"],
            "summary": b["summary"], "summaryVersion": b["summary_version"],
            "textUrl": b["text_url"], "url": bill_url(bid), "origin": b["origin_chamber"],
            "committees": json.loads(b["committees_json"] or "[]"),
            "related": json.loads(b["related_json"] or "[]"),
            "cbo": json.loads(b["cbo_json"] or "[]"),
            "stages": json.loads(b["stages_json"] or "{}"),
            "subjects": subjects.get(bid, []),
            "cosponsors": [{"id": c["bioguide_id"], "name": names.get(c["bioguide_id"]) or c["name"],
                            "party": c["party"], "state": c["state"], "d": c["date"],
                            "orig": c["is_original"], "wd": c["withdrawn_date"]} for c in cos[bid]],
            "actions": [{"d": a["date"], "t": a["text"], "ty": a["type"], "ch": a["chamber"],
                         "v": a["vote_ref"]} for a in actions.get(bid, [])],
            "votes": votes_by_bill.get(bid, []),
            "updated": b["update_date"],
        }
    for key, payload in shards.items():
        write_json(out / "bills" / "detail" / f"{key}.json", payload)

    # ---- recent activity feed
    senate_measures = [x for x in index if parse_bill_id(x["id"])[0] in SENATE_BILL_TYPES]
    write_json(out / "recent.json", {
        "introduced": senate_measures[:60],
        "moving": sorted((x for x in summaries.values() if x["st"] not in ("introduced", None)),
                         key=lambda x: (x["la"] or "", x["id"]), reverse=True)[:60],
        "laws": sorted((x for x in summaries.values() if x["st"] == "law"),
                       key=lambda x: (x["sd"] or "", x["id"]), reverse=True),
    })

    # ---- topics: what is happening on each subject, and who leads or crosses party lines on it
    measures_by_topic, all_by_topic, votes_by_topic = defaultdict(list), defaultdict(list), defaultdict(list)
    for x in senate_measures:
        measures_by_topic[x["tp"]].append(x)
    for x in summaries.values():
        all_by_topic[x["tp"]].append(x)
    for v in votes:
        votes_by_topic[v["tp"]].append(v)
    topics_out = []
    for t in TOPICS:
        tid = t["id"]
        tb, tv = measures_by_topic.get(tid, []), votes_by_topic.get(tid, [])
        crossers = []
        for bg in current_ids:
            c = tstats[bg].get(tid)
            if not c or c["pl"] < 3 or caucus_of[bg] not in ("D", "R"):
                continue
            cross = c["withR"] if caucus_of[bg] == "D" else c["withD"]
            if cross:
                crossers.append((cross / c["pl"], cross, c["pl"], bg))
        crossers.sort(key=lambda r: (-r[0], -r[1]))
        laws = sorted((x for x in all_by_topic.get(tid, []) if x["st"] == "law"),
                      key=lambda x: (x["sd"] or "", x["id"]), reverse=True)
        moving = sorted((x for x in all_by_topic.get(tid, []) if x["st"] not in ("introduced", None)),
                        key=lambda x: (x["la"] or "", x["id"]), reverse=True)
        sponsors = Counter(x["sp"] for x in tb if x["sp"] in current_ids)
        topics_out.append({
            "id": tid, "label": t["label"], "areas": t["areas"],
            "counts": {"bills": len(tb), "passed": sum(1 for x in tb if x["st"] in ADVANCED or x["st"] == "agreed_to"),
                       "laws": len(laws), "votes": len(tv), "partyLine": sum(1 for v in tv if v["pl"])},
            "topSponsors": [{"id": bg, "n": n} for bg, n in sponsors.most_common(6)],
            "crossers": [{"id": bg, "cross": cr, "n": n} for _, cr, n, bg in crossers[:6]],
            "newest": tb[:8], "moving": moving[:8], "laws": laws[:12],
            "recentVotes": [v["id"] for v in reversed(tv[-8:])],
        })
    write_json(out / "topics.json", topics_out)

    # ---- meta: freshness, composition, chamber-wide reference values
    current = [x for x in listing if x["current"]]
    sync = {r["source"]: dict(r) for r in conn.execute("SELECT * FROM sync_log")}
    intro_by_month = Counter((x["intro"] or "")[:7] for x in senate_measures)
    laws_by_month = Counter((x["sd"] or "")[:7] for x in senate_measures if x["st"] == "law")
    write_json(out / "meta.json", {
        "generatedAt": utc_now(),
        "congress": congress, "congressLabel": f"{ordinal(congress)} Congress",
        "congressStart": start, "congressEnd": end,
        "composition": Counter(x["party"] for x in current),
        "counts": {"senators": len(current), "former": len(listing) - len(current),
                   "votes": len(votes), "measures": len(senate_measures)},
        "latestVote": votes[-1]["d"] if votes else None,
        "latestBillUpdate": max((b["update_date"] or "" for b in bills.values()), default=None),
        "months": months,
        "monthly": {"introduced": [intro_by_month.get(m, 0) for m in months],
                    "laws": [laws_by_month.get(m, 0) for m in months]},
        "caucusUnity": {c: [pct(caucus_monthly[(c, m)]["uw"], caucus_monthly[(c, m)]["uv"]) for m in months]
                        for c in ("D", "R")},
        "medians": medians,
        "topics": [{"id": t["id"], "label": t["label"], "areas": t["areas"]} for t in TOPICS],
        "sources": [{"key": key, "name": name, "url": url, "what": what,
                     "checkedAt": sync.get(key, {}).get("checked_at"),
                     "changedAt": sync.get(key, {}).get("changed_at")}
                    for key, (name, url, what) in SOURCES.items()],
    })
    log(f"export: {len(listing)} senators, {len(votes)} votes, {len(bills)} bills -> {out}")
