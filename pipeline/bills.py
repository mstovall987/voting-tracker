"""Bills and resolutions from GovInfo's BILLSTATUS bulk data.

These are the same records that power Congress.gov (sponsor, cosponsors, actions, CRS summaries,
subjects, committees), refreshed by the Government Publishing Office several times a day. The
first run downloads one zip per bill type; later runs fetch only the files that changed.
"""
from __future__ import annotations

import json
import re
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
import xml.etree.ElementTree as ET

from .config import GOVINFO_BULK, HOUSE_BILL_TYPES, RAW_DIR
from .fetch import FetchError, download, file_meta, get_bytes, get_json

SOURCE = "govinfo:BILLSTATUS"
ZIP_THRESHOLD = 300  # if more files than this changed, download the whole zip instead

BILL_COLUMNS = (
    "bill_id", "congress", "bill_type", "number", "title", "short_title", "official_title",
    "introduced_date", "origin_chamber", "sponsor_id", "sponsor_name", "sponsor_party",
    "sponsor_state", "policy_area", "latest_action_date", "latest_action_text", "status",
    "status_date", "law_number", "summary", "summary_version", "text_url", "committees_json",
    "related_json", "cbo_json", "stages_json", "update_date",
)


# --------------------------------------------------------------------------- syncing

def _listing(congress: int, btype: str) -> dict[str, str]:
    """{file name: last-modified 'YYYY-MM-DDTHH:MM' (UTC)} for one bill type."""
    data = get_json(f"{GOVINFO_BULK}/json/BILLSTATUS/{congress}/{btype}")
    files = {}
    for f in data.get("files", []):
        if f.get("folder") or f.get("fileExtension") != "xml":
            continue
        stamp = datetime.strptime(f["formattedLastModifiedTime"], "%d-%b-%Y %H:%M")
        files[f["name"]] = stamp.strftime("%Y-%m-%dT%H:%M")
    return files


def _http_stamp(value: str | None) -> str | None:
    try:
        return parsedate_to_datetime(value).strftime("%Y-%m-%dT%H:%M") if value else None
    except (TypeError, ValueError):
        return None


def _mark(conn, name: str, stamp: str) -> None:
    conn.execute("INSERT OR REPLACE INTO source_files VALUES (?,?,?)", (SOURCE, name, stamp))


def sync_bill_type(conn, congress: int, btype: str, numbers=None, force: bool = False,
                   log=print) -> int:
    """Bring every bill of one type (or only the given bill numbers) up to date.
    Returns how many bills were (re)loaded."""
    files = _listing(congress, btype)
    if numbers is not None:
        wanted = {f"BILLSTATUS-{congress}{btype}{n}.xml" for n in numbers}
        files = {name: stamp for name, stamp in files.items() if name in wanted}
    known = dict(conn.execute("SELECT name, last_modified FROM source_files WHERE source=?",
                              (SOURCE,)).fetchall())
    stale = sorted(name for name, stamp in files.items() if force or known.get(name) != stamp)
    if not stale:
        log(f"bills ({btype}): up to date, {len(files)} files")
        return 0

    stored = 0
    remaining = set(stale)
    if len(stale) > ZIP_THRESHOLD:
        zpath = RAW_DIR / "govinfo" / f"BILLSTATUS-{congress}-{btype}.zip"
        log(f"bills ({btype}): {len(stale)} to load, downloading bulk zip...")
        download(f"{GOVINFO_BULK}/BILLSTATUS/{congress}/{btype}/BILLSTATUS-{congress}-{btype}.zip", zpath)
        zip_stamp = _http_stamp(file_meta(zpath).get("last_modified"))
        with zipfile.ZipFile(zpath) as zf, conn:
            in_zip = set(zf.namelist())
            for name in stale:
                # Files updated after the zip was built are fetched one by one below.
                if name not in in_zip or (zip_stamp and files[name] > zip_stamp):
                    continue
                _store(conn, zf.read(name))
                _mark(conn, name, files[name])
                remaining.discard(name)
                stored += 1

    if remaining:
        log(f"bills ({btype}): fetching {len(remaining)} changed files...")

        def fetch(name):
            try:
                return name, get_bytes(f"{GOVINFO_BULK}/BILLSTATUS/{congress}/{btype}/{name}")
            except FetchError as err:
                log(f"  ! {err}")
                return name, None

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(fetch, sorted(remaining)))
        with conn:
            for name, body in results:
                if body:
                    _store(conn, body)
                    _mark(conn, name, files[name])
                    stored += 1
    log(f"bills ({btype}): loaded {stored} (of {len(files)} total)")
    return stored


def sync_referenced_house_bills(conn, congress: int, force: bool = False, log=print) -> int:
    """House bills the Senate voted on (e.g. H.R. 1), so Senate votes can show their titles."""
    by_type = defaultdict(set)
    for (bill_id,) in conn.execute(
            "SELECT DISTINCT bill_id FROM votes WHERE congress=? AND bill_id IS NOT NULL", (congress,)):
        m = re.match(r"^([a-z]+)(\d+)-\d+$", bill_id)
        if m and m.group(1) in HOUSE_BILL_TYPES:
            by_type[m.group(1)].add(int(m.group(2)))
    return sum(sync_bill_type(conn, congress, btype, numbers=nums, force=force, log=log)
               for btype, nums in sorted(by_type.items()))


# --------------------------------------------------------------------------- parsing

def _t(el, path: str, default=None):
    if el is None:
        return default
    value = el.findtext(path)
    return value.strip() if value and value.strip() else default


class _HTMLText(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "table", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("• ")

    def handle_endtag(self, tag):
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(html: str | None) -> str | None:
    """CRS summaries arrive as HTML; keep plain paragraphs (one per line)."""
    if not html:
        return None
    parser = _HTMLText()
    parser.feed(html)
    parser.close()
    lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(parser.parts).split("\n")]
    return "\n".join(line for line in lines if line) or None


def _party(value: str | None) -> str | None:
    if not value:
        return None
    return value if value in ("D", "R") else "I"


def _vote_ref(item) -> str | None:
    rv = item.find("recordedVotes/recordedVote")
    if rv is None:
        return None
    chamber = (_t(rv, "chamber") or "").lower()
    roll, session, congress = _t(rv, "rollNumber"), _t(rv, "sessionNumber"), _t(rv, "congress")
    if chamber not in ("senate", "house") or not (roll and session and congress):
        return None
    try:
        return f"{chamber[0]}{int(congress)}-{int(session)}-{int(roll)}"
    except ValueError:
        return None


def _dedupe_actions(actions: list[dict]) -> list[dict]:
    """Congress.gov repeats some actions: a Library of Congress copy prefixed with a
    standard label ("Passed/agreed to in Senate: ...") plus the chamber's own copy. Keep one."""
    by_date = defaultdict(set)
    for a in actions:
        by_date[a["date"]].add(a["text"])
    out = []
    for a in actions:
        head, sep, rest = a["text"].partition(": ")
        if sep and rest in by_date[a["date"]] and a["text"] != rest:
            continue
        out.append(a)
    return out


# Milestones, matched against action text. Congress.gov adds standardized Library of Congress
# copies of key actions ("Passed/agreed to in Senate: ..."), which makes these reliable.
STAGE_PATTERNS = {
    "introduced": r"introduced in (the )?(senate|house)|^submitted in (the )?(senate|house)",
    "reported": r"reported (by|to|with|without|favorably|an original)|ordered to be reported|"
                r"placed on (the )?(senate legislative|union|house) calendar",
    "passed_senate": r"passed/agreed to in senate|^passed senate",
    "passed_house": r"passed/agreed to in house",
    "failed": r"failed of passage/not agreed to in (senate|house)",
    "to_president": r"presented to president",
    "vetoed": r"vetoed by president|pocket vetoed",
    "law": r"became (public|private) law|signed by president",
}


def derive_stages(actions: list[dict]) -> dict[str, str]:
    """{milestone: first date reached} from the full (un-deduplicated) action list."""
    stages = {}
    for key, pattern in STAGE_PATTERNS.items():
        rx = re.compile(pattern)
        dates = [a["date"] for a in actions if a["date"] and rx.search(a["text"].lower())]
        if dates:
            stages[key] = min(dates)
    if "introduced" not in stages:
        dates = [a["date"] for a in actions if a["date"]]
        if dates:
            stages["introduced"] = min(dates)
    return stages


def derive_status(btype: str, stages: dict[str, str], law_number: str | None):
    """Furthest stage a measure has reached, as (status, date)."""
    if law_number:
        return "law", stages.get("law")
    passed_s, passed_h = stages.get("passed_senate"), stages.get("passed_house")
    if btype in ("sres", "hres") and (passed_s or passed_h):
        return "agreed_to", passed_s or passed_h
    if btype in ("sconres", "hconres") and passed_s and passed_h:
        return "agreed_to", max(passed_s, passed_h)
    for key in ("vetoed", "to_president"):
        if key in stages:
            return key, stages[key]
    if passed_s and passed_h:
        return "passed_both", max(passed_s, passed_h)
    if passed_s:
        return "passed_senate", passed_s
    if passed_h:
        return "passed_house", passed_h
    for key in ("failed", "reported"):
        if key in stages:
            return key, stages[key]
    return "introduced", stages.get("introduced")


SHORT_TITLE_PREF = ("Enacted", "Passed", "Reported", "Introduced")


def parse_billstatus(xml_bytes: bytes) -> dict:
    root = ET.fromstring(xml_bytes)
    b = root.find("bill")
    btype = (_t(b, "type", "")).lower()
    number = int(_t(b, "number", "0"))
    congress = int(_t(b, "congress", "0"))
    bill_id = f"{btype}{number}-{congress}"

    titles = [(_t(i, "titleType", ""), _t(i, "title", "")) for i in b.findall("titles/item")]
    short_title = None
    for pref in SHORT_TITLE_PREF:
        short_title = next((t for tt, t in titles if tt.startswith("Short Title") and pref in tt
                            and "portions" not in tt.lower()), None)
        if short_title:
            break
    official_title = next((t for tt, t in titles if tt.startswith("Official Title")), None)

    sponsor = b.find("sponsors/item")
    sponsor_name = " ".join(filter(None, [_t(sponsor, "firstName"), _t(sponsor, "lastName")])) or None

    actions = []
    for item in b.findall("actions/item"):
        source = (_t(item, "sourceSystem/name") or "").lower()
        chamber = "senate" if "senate" in source else "house" if "house" in source else None
        actions.append({
            "date": _t(item, "actionDate"), "time": _t(item, "actionTime"),
            "text": _t(item, "text", ""), "type": _t(item, "type"), "chamber": chamber,
            "vote_ref": _vote_ref(item),
        })
    actions.sort(key=lambda a: (a["date"] or "", a["time"] or ""))  # source lists newest first

    laws = [f"{'P.L.' if (_t(i, 'type') or '').startswith('Public') else 'Pvt.L.'} {_t(i, 'number')}"
            for i in b.findall("laws/item") if _t(i, "number")]
    law_number = laws[0] if laws else None
    # Milestones first, from the full list: the standardized "Passed/agreed to in House: ..."
    # copies that _dedupe_actions removes are exactly what the stage patterns look for.
    stages = derive_stages(actions)
    status, status_date = derive_status(btype, stages, law_number)
    actions = _dedupe_actions(actions)

    summaries = []
    for s in b.findall("summaries/summary"):
        html = s.findtext("text") or s.findtext("cdata/text") or ""
        summaries.append((_t(s, "actionDate", ""), _t(s, "updateDate", ""), _t(s, "actionDesc", ""), html))
    summary = summary_version = None
    if summaries:
        latest = max(summaries, key=lambda x: (x[0], x[1]))
        summary = html_to_text(latest[3])
        summary_version = f"{latest[2]} ({latest[0]})" if latest[2] else latest[0]

    versions = []
    for tv in b.findall("textVersions/item"):
        urls = [_t(f, "url") for f in tv.findall("formats/item")]
        url = next((u for u in urls if u and u.endswith(".htm")), None) or next((u for u in urls if u), None)
        if url:
            versions.append(((_t(tv, "date") or ""), url))
    text_url = max(versions)[1] if versions else None

    committees = [{"name": _t(c, "name"), "chamber": _t(c, "chamber"), "code": _t(c, "systemCode")}
                  for c in b.findall("committees/item")]
    related = []
    for r in b.findall("relatedBills/item")[:12]:
        kinds = sorted({_t(d, "type") for d in r.findall("relationshipDetails/item") if _t(d, "type")})
        related.append({"id": f"{(_t(r, 'type') or '').lower()}{_t(r, 'number')}-{_t(r, 'congress')}",
                        "title": _t(r, "title"), "rel": ", ".join(kinds)})
    cbo = [{"title": _t(c, "title"), "date": (_t(c, "pubDate") or "")[:10], "url": _t(c, "url")}
           for c in b.findall("cboCostEstimates/item")]

    cosponsors = []
    for c in b.findall("cosponsors/item"):
        bg = _t(c, "bioguideId")
        if not bg:
            continue
        cosponsors.append((
            bill_id, bg, " ".join(filter(None, [_t(c, "firstName"), _t(c, "lastName")])),
            _party(_t(c, "party")), _t(c, "state"), _t(c, "sponsorshipDate"),
            1 if (_t(c, "isOriginalCosponsor") or "").lower() == "true" else 0,
            _t(c, "sponsorshipWithdrawnDate"),
        ))

    subjects = sorted({_t(i, "name") for i in b.findall("subjects/legislativeSubjects/item") if _t(i, "name")})

    return {
        "bill_id": bill_id, "congress": congress, "bill_type": btype, "number": number,
        "title": _t(b, "title"), "short_title": short_title, "official_title": official_title,
        "introduced_date": _t(b, "introducedDate"), "origin_chamber": _t(b, "originChamber"),
        "sponsor_id": _t(sponsor, "bioguideId"), "sponsor_name": sponsor_name,
        "sponsor_party": _party(_t(sponsor, "party")), "sponsor_state": _t(sponsor, "state"),
        "policy_area": _t(b, "policyArea/name"),
        "latest_action_date": _t(b, "latestAction/actionDate"),
        "latest_action_text": _t(b, "latestAction/text"),
        "status": status, "status_date": status_date, "law_number": law_number,
        "summary": summary, "summary_version": summary_version, "text_url": text_url,
        "committees_json": json.dumps(committees), "related_json": json.dumps(related),
        "cbo_json": json.dumps(cbo),
        "stages_json": json.dumps(stages),
        "update_date": _t(b, "updateDateIncludingText") or _t(b, "updateDate"),
        "_cosponsors": cosponsors,
        "_actions": [(bill_id, i, a["date"], a["time"], a["text"], a["type"], a["chamber"], a["vote_ref"])
                     for i, a in enumerate(actions)],
        "_subjects": [(bill_id, s) for s in subjects],
    }


def _store(conn, xml_bytes: bytes) -> None:
    bill = parse_billstatus(xml_bytes)
    bill_id = bill["bill_id"]
    for table in ("cosponsors", "bill_actions", "bill_subjects"):
        conn.execute(f"DELETE FROM {table} WHERE bill_id=?", (bill_id,))
    conn.execute(f"INSERT OR REPLACE INTO bills ({','.join(BILL_COLUMNS)}) "
                 f"VALUES ({','.join('?' * len(BILL_COLUMNS))})", [bill[c] for c in BILL_COLUMNS])
    conn.executemany("INSERT OR REPLACE INTO cosponsors VALUES (?,?,?,?,?,?,?,?)", bill["_cosponsors"])
    conn.executemany("INSERT OR REPLACE INTO bill_actions VALUES (?,?,?,?,?,?,?,?)", bill["_actions"])
    conn.executemany("INSERT OR REPLACE INTO bill_subjects VALUES (?,?)", bill["_subjects"])
