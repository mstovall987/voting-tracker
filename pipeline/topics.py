"""Topics: plain-language groups of the Library of Congress "policy areas".

Every bill gets exactly one policy area from the Congressional Research Service (e.g. "Health",
"Armed Forces and National Security"). We group the ~33 areas into the topics below and tag every
bill and roll-call vote with one:

* Bills use their official policy area.
* Votes use the topic of the bill they are about; nomination votes are "Nominations".
* Amendments to budget and spending bills (budget resolutions, reconciliation, appropriations)
  cover every subject, so for those the topic is read from the amendment's own text using the
  keyword rules below (falling back to "Budget & spending").
"""
from __future__ import annotations

import re

TOPICS = [
    {"id": "budget", "label": "Budget & spending", "areas": ["Economics and Public Finance"]},
    {"id": "taxes", "label": "Taxes", "areas": ["Taxation"]},
    {"id": "economy", "label": "Business, finance & trade",
     "areas": ["Finance and Financial Sector", "Commerce", "Foreign Trade and International Finance"]},
    {"id": "health", "label": "Health care", "areas": ["Health"]},
    {"id": "immigration", "label": "Immigration", "areas": ["Immigration"]},
    {"id": "defense", "label": "Defense & veterans", "areas": ["Armed Forces and National Security"]},
    {"id": "foreign", "label": "Foreign policy", "areas": ["International Affairs"]},
    {"id": "justice", "label": "Crime & justice", "areas": ["Crime and Law Enforcement", "Law"]},
    {"id": "rights", "label": "Civil rights", "areas": ["Civil Rights and Liberties, Minority Issues"]},
    {"id": "environment", "label": "Environment, energy & public lands",
     "areas": ["Environmental Protection", "Energy", "Public Lands and Natural Resources", "Animals"]},
    {"id": "education", "label": "Education", "areas": ["Education"]},
    {"id": "labor", "label": "Jobs & workers", "areas": ["Labor and Employment"]},
    {"id": "social", "label": "Families, housing & safety net",
     "areas": ["Social Welfare", "Families", "Housing and Community Development"]},
    {"id": "agriculture", "label": "Agriculture & food", "areas": ["Agriculture and Food"]},
    {"id": "transportation", "label": "Transportation & infrastructure",
     "areas": ["Transportation and Public Works", "Water Resources Development", "Emergency Management"]},
    {"id": "technology", "label": "Science & technology", "areas": ["Science, Technology, Communications"]},
    {"id": "government", "label": "Government & elections",
     "areas": ["Government Operations and Politics", "Congress"]},
    {"id": "tribal", "label": "Native American affairs", "areas": ["Native Americans"]},
    {"id": "culture", "label": "Culture, sports & history",
     "areas": ["Arts, Culture, Religion", "Sports and Recreation", "Social Sciences and History"]},
    {"id": "other", "label": "Other", "areas": ["Private Legislation", "Geographic Areas, Entities, and Committees"]},
    {"id": "nominations", "label": "Nominations", "areas": []},
]
LABELS = {t["id"]: t["label"] for t in TOPICS}
_AREA_TO_TOPIC = {area: t["id"] for t in TOPICS for area in t["areas"]}

# Amendment text -> topic, for amendments to budget/spending bills. First match wins, so the
# order matters (e.g. Medicaid rules for immigrants count as health; tariffs as trade, not taxes).
_AMENDMENT_RULES = [(topic, re.compile(pattern, re.I)) for topic, pattern in [
    ("taxes", r"internal revenue code|income tax rate"),
    ("health", r"medicaid|medicare|health|hospital|abortion|planned parenthood|\bchip\b|prescription|"
               r"drug pric|affordable care|insulin|vaccin|\bcdc\b|\bnih\b|opioid|maternal|nursing home"),
    ("immigration", r"immigra|\baliens?\b|border|asylum|deport|\bvisas?\b|citizenship|sanctuary|refugee"),
    ("foreign", r"international|foreign (aid|assistance)|usaid|ukraine|israel|\bgaza\b|china|taiwan|"
                r"\biran\b|russia|\bnato\b|embass|global|humanitarian|united nations|europe|eurasia|"
                r"africa|central asia|institute of peace"),
    ("government", r"federal employee|federal workforce|civil serv|administrative state|\bdoge\b|"
                   r"inspector general|executive order|election"),
    ("economy", r"tariff|\btrade\b|small business|consumer|\bbanks?\b|banking|financial|crypto|"
                r"price gouging|inflation|cost of living|grocer"),
    ("taxes", r"\btax|\birs\b"),
    ("education", r"educat|school|student|college|universit|teacher|scholarship|head start"),
    ("defense", r"defense|military|armed forces|veteran|pentagon|national guard|troops|servicemember|"
                r"missile|nuclear weapon"),
    ("agriculture", r"agricultur|farm|\bsnap\b|nutrition|food (aid|assistance|stamps?|security|insecurity|bank)|"
                    r"hemp|rural development"),
    ("environment", r"energy|electric|\boil\b|natural gas|coal|solar|\bwind\b|climate|emission|\bepa\b|"
                    r"environment|clean (air|water)|pollut|public lands?|national park|forest|wildlife|"
                    r"conservation|drilling|mining|park service|wildfire|wildland"),
    ("labor", r"worker|wage|labor|\bunions?\b|overtime|pension|\bjobs?\b|employment"),
    ("social", r"child ?care|famil|housing|homeless|\brent\b|social security|disabilit|seniors|caregiv|"
               r"poverty|welfare"),
    ("justice", r"crime|criminal|police|law enforcement|prison|\bguns?\b|firearm|court|judge|justice|traffick"),
    ("transportation", r"transport|highway|infrastructure|airport|aviation|\bfaa\b|\brail|transit|bridge|"
                       r"\bports?\b|disaster|\bfema\b"),
    ("technology", r"artificial intelligence|\bai\b|technolog|cyber|broadband|broadcast|internet|telecom|"
                   r"science|research|space|\bnasa\b"),
    ("rights", r"civil rights|discriminat|voting rights|lgbt|religious freedom|free speech"),
    ("tribal", r"tribal|\btribes?\b|native american"),
]]


def topic_for_area(policy_area: str | None) -> str:
    return _AREA_TO_TOPIC.get(policy_area or "", "other")


def topic_from_text(text: str) -> str | None:
    for topic, rx in _AMENDMENT_RULES:
        if rx.search(text):
            return topic
    return None


def vote_topic(category: str, description: str | None, bill_topic: str | None) -> str:
    """Topic for a roll call, given its category, description and the topic of its bill."""
    if category == "nomination":
        return "nominations"
    topic = bill_topic or "other"
    text = (description or "").strip()
    # Amendments and motions describe themselves as "To ..."; votes on the bill itself repeat the
    # bill's title ("A bill to ...", "A concurrent resolution ..."), which keeps the bill's topic.
    if topic == "budget" and text.startswith("To "):
        return topic_from_text(text) or topic
    return topic
