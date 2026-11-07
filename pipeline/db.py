"""SQLite schema and connection helper. The database (data/tracker.db) is the source of truth;
the website's JSON files are generated from it by export.py."""
from __future__ import annotations

import sqlite3

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
    bioguide_id    TEXT PRIMARY KEY,     -- Congress's permanent member ID, e.g. S000148
    first_name     TEXT,
    middle_name    TEXT,
    last_name      TEXT,
    suffix         TEXT,
    nickname       TEXT,
    official_name  TEXT,
    birthday       TEXT,
    gender         TEXT,
    lis_id         TEXT,
    icpsr          INTEGER,
    govtrack_id    INTEGER,
    opensecrets_id TEXT,
    ballotpedia    TEXT,
    wikipedia      TEXT,
    is_current     INTEGER NOT NULL DEFAULT 0,
    social_json    TEXT
);
CREATE TABLE IF NOT EXISTS terms (
    bioguide_id  TEXT NOT NULL,
    chamber      TEXT NOT NULL,          -- 'senate' | 'house'
    start_date   TEXT NOT NULL,
    end_date     TEXT,
    state        TEXT,
    district     INTEGER,
    senate_class INTEGER,
    state_rank   TEXT,
    party        TEXT,
    caucus       TEXT,                   -- set for independents, e.g. 'Democrat'
    how          TEXT,                   -- e.g. 'appointment'
    url          TEXT,
    phone        TEXT,
    office       TEXT,
    contact_form TEXT,
    PRIMARY KEY (bioguide_id, chamber, start_date)
);
CREATE TABLE IF NOT EXISTS committees (
    committee_id TEXT PRIMARY KEY,
    name         TEXT,
    chamber      TEXT,
    parent_id    TEXT,
    url          TEXT
);
CREATE TABLE IF NOT EXISTS committee_members (
    committee_id TEXT NOT NULL,
    bioguide_id  TEXT NOT NULL,
    side         TEXT,                   -- 'majority' | 'minority'
    title        TEXT,
    rank         INTEGER,
    PRIMARY KEY (committee_id, bioguide_id)
);
CREATE TABLE IF NOT EXISTS member_scores (
    bioguide_id   TEXT NOT NULL,
    chamber       TEXT NOT NULL,
    congress      INTEGER NOT NULL,
    nominate_dim1 REAL,                  -- DW-NOMINATE: -1 most liberal .. +1 most conservative
    nominate_dim2 REAL,
    PRIMARY KEY (bioguide_id, chamber, congress)
);
CREATE TABLE IF NOT EXISTS votes (
    vote_id      TEXT PRIMARY KEY,       -- e.g. 's119-2-256' = Senate, 119th Congress, session 2, roll call 256
    chamber      TEXT NOT NULL,
    congress     INTEGER NOT NULL,
    session      INTEGER NOT NULL,
    number       INTEGER NOT NULL,
    date         TEXT NOT NULL,
    question     TEXT,
    result       TEXT,
    description  TEXT,
    category     TEXT,                   -- passage | nomination | amendment | cloture | procedural
    document     TEXT,                   -- e.g. 'HR1', 'PN1129'
    bill_id      TEXT,                   -- e.g. 'hr1-119' when the vote concerns a bill
    majority_req TEXT,
    yea          INTEGER,
    nay          INTEGER,
    present      INTEGER,
    not_voting   INTEGER,
    passed       INTEGER,
    source       TEXT
);
CREATE INDEX IF NOT EXISTS votes_bill ON votes(bill_id);
CREATE TABLE IF NOT EXISTS vote_positions (
    vote_id     TEXT NOT NULL,
    bioguide_id TEXT NOT NULL,
    position    TEXT NOT NULL,           -- Yea | Nay | Present | Not Voting
    party       TEXT,                    -- D | R | I at the time of the vote
    state       TEXT,
    PRIMARY KEY (vote_id, bioguide_id)
);
CREATE INDEX IF NOT EXISTS positions_member ON vote_positions(bioguide_id);
CREATE TABLE IF NOT EXISTS bills (
    bill_id            TEXT PRIMARY KEY, -- e.g. 's5-119'
    congress           INTEGER NOT NULL,
    bill_type          TEXT NOT NULL,
    number             INTEGER NOT NULL,
    title              TEXT,
    short_title        TEXT,
    official_title     TEXT,
    introduced_date    TEXT,
    origin_chamber     TEXT,
    sponsor_id         TEXT,
    sponsor_name       TEXT,
    sponsor_party      TEXT,
    sponsor_state      TEXT,
    policy_area        TEXT,
    latest_action_date TEXT,
    latest_action_text TEXT,
    status             TEXT,
    status_date        TEXT,
    law_number         TEXT,
    summary            TEXT,
    summary_version    TEXT,
    text_url           TEXT,
    committees_json    TEXT,
    related_json       TEXT,
    cbo_json           TEXT,
    update_date        TEXT,
    stages_json        TEXT              -- {milestone: first date}, e.g. {"passed_senate": "2025-03-04"}
);
CREATE INDEX IF NOT EXISTS bills_sponsor ON bills(sponsor_id);
CREATE TABLE IF NOT EXISTS cosponsors (
    bill_id        TEXT NOT NULL,
    bioguide_id    TEXT NOT NULL,
    name           TEXT,
    party          TEXT,
    state          TEXT,
    date           TEXT,
    is_original    INTEGER,
    withdrawn_date TEXT,
    PRIMARY KEY (bill_id, bioguide_id)
);
CREATE INDEX IF NOT EXISTS cosponsors_member ON cosponsors(bioguide_id);
CREATE TABLE IF NOT EXISTS bill_actions (
    bill_id  TEXT NOT NULL,
    seq      INTEGER NOT NULL,
    date     TEXT,
    time     TEXT,
    text     TEXT,
    type     TEXT,
    chamber  TEXT,
    vote_ref TEXT,                       -- roll call id when the action was a recorded vote
    PRIMARY KEY (bill_id, seq)
);
CREATE TABLE IF NOT EXISTS bill_subjects (
    bill_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    PRIMARY KEY (bill_id, subject)
);
CREATE TABLE IF NOT EXISTS source_files (   -- last-modified stamps of individual source files
    source        TEXT NOT NULL,
    name          TEXT NOT NULL,
    last_modified TEXT,
    PRIMARY KEY (source, name)
);
CREATE TABLE IF NOT EXISTS sync_log (       -- when each source was last checked / last changed
    source     TEXT PRIMARY KEY,
    checked_at TEXT,
    changed_at TEXT,
    detail     TEXT
);
"""


MIGRATIONS = {  # columns added after the first release: table -> {column: type}
    "bills": {"stages_json": "TEXT"},
}


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for table, columns in MIGRATIONS.items():
        have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for column, ctype in columns.items():
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ctype}")
    conn.commit()
    return conn
