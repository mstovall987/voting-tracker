"""Shared settings: where files live, which Congress to track, and the data sources."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"            # raw downloads + SQLite database (not served to the web)
RAW_DIR = DATA_DIR / "raw"
DB_PATH = DATA_DIR / "tracker.db"
WEB_DIR = ROOT / "web"
WEB_DATA_DIR = WEB_DIR / "data"     # JSON files the website reads

# 119th Congress = Jan 3, 2025 to Jan 3, 2027. Override with the TRACKER_CONGRESS env var.
CURRENT_CONGRESS = int(os.environ.get("TRACKER_CONGRESS", "119"))

USER_AGENT = "VotingTracker/0.1 (personal civic-data project)"

# Data sources: all free and public, no API key needed.
LEGISLATORS_BASE = "https://unitedstates.github.io/congress-legislators"
VOTEVIEW_BASE = "https://voteview.com/static/data/out"
GOVINFO_BULK = "https://www.govinfo.gov/bulkdata"
PHOTO_URL = "https://bioguide.congress.gov/photo/{bioguide}.jpg"

SENATE_BILL_TYPES = ("s", "sjres", "sconres", "sres")
HOUSE_BILL_TYPES = ("hr", "hjres", "hconres", "hres")


def congress_start(congress: int) -> str:
    """First day of a Congress (Jan 3 of an odd year, true since the 74th Congress)."""
    return f"{1789 + 2 * (congress - 1)}-01-03"


def congress_end(congress: int) -> str:
    return congress_start(congress + 1)
