# Voting Tracker

A website that tracks what members of Congress propose and how they vote, rebuilt from free
official data. **Phase 1 covers the U.S. Senate (119th Congress, 2025–2027).** The House, the
President and state legislatures are planned next (see the roadmap below).

- **Overview**: a seat chart of all 100 senators ordered by voting record, a quick search (press `/`)
  for any senator, state, topic or bill, and a map with every state split into its two seats. Light and
  dark themes follow your system setting; the button in the header switches them.
- **Senator profiles**: how they voted on the key votes, a plain-English summary and a topic-by-topic
  table of where they stand, party unity month by month, missed votes, an ideology score compared with
  every other senator, who they vote with across the aisle, committee seats, what they sponsor and
  cosponsor, and their full voting record (filterable by topic, key votes, or "votes against their party").
- **Key votes**: about 100 of the 900+ roll calls are flagged as key (laws, budget and spending fights,
  cabinet-level confirmations, close votes, war powers, veto overrides) and lead each senator's record.
- **Plain English**: every vote says what kind of vote it was (cloture, motion to proceed, a Congressional
  Review Act resolution...) and what Yea and Nay actually meant, e.g. "voted to overturn the rule".
- **Compare**: pick any two senators to see how often they agree (overall and by topic), their key votes
  side by side, every vote where they split, and the bills they worked on together.
- **Topics**: every bill and roll-call vote is tagged with one of about 20 topics (health care,
  immigration, taxes and so on). Each topic page shows its latest votes, newest bills, what became law,
  the most active senators and who crosses party lines on it. Votes and bill search filter by topic too.
- **Legislation**: newly introduced bills, bills with recent action, what became law, and a search over
  every Senate bill and resolution. Each bill has a progress tracker, its CRS summary, cosponsors, every
  action, and links to the full text.
- **Floor votes**: every roll-call vote, how each party split, and how every senator voted.

## Quick start

Requires Python 3.10+ (no extra packages) and an internet connection.

**On Windows, just double-click `Start Voting Tracker.bat`.** It starts the local web server and opens
the site in your browser; keep its window open while you browse. Double-click `Update data.bat` to
download the newest votes and bills. (Opening `web/index.html` directly shows only the header: browsers
block pages opened from a file from loading their data.)

From a terminal instead:

```bash
python -m pipeline update
```

The first run takes about a minute (it downloads roughly 40 MB). Then start the site:

```bash
python serve.py --open
```

That opens http://localhost:8000. To keep the data current while you work:

```bash
python -m pipeline watch
```

`watch` checks every source every 30 minutes (`--every 10` for every 10 minutes). Each check only
downloads what changed, so a run with no news takes about 5 seconds.

## Where the data comes from, and how fresh it is

| What | Source | How fresh |
|---|---|---|
| Senate roll-call votes, each senator's position, ideology scores | [Voteview](https://voteview.com/data) (UCLA) | Usually by the morning after a vote |
| Bills, sponsors, cosponsors, actions, CRS summaries, subjects | [GovInfo BILLSTATUS](https://www.govinfo.gov/bulkdata/BILLSTATUS) (the records behind Congress.gov) | Several times a day |
| Senators, terms, contact info, committees, social accounts | [@unitedstates/congress-legislators](https://github.com/unitedstates/congress-legislators) | Within a day or two of a change |
| Photos | [Biographical Directory of Congress](https://bioguide.congress.gov) | Updated by Congress; brand-new members may lag |
| Map shapes | [us-atlas](https://github.com/topojson/us-atlas) (Census boundaries), loaded from a CDN | Static |

None of these need an API key. The Senate's own roll-call XML on senate.gov is the fastest source
(minutes after a vote), but its firewall blocks automated downloads, which is why votes come from
Voteview. Nothing here is "live during the vote", but it is close: votes arrive by the next morning and
bills within hours.

## How the numbers are defined

- **Missed votes**: roll calls held while the senator was in office that they did not vote on.
- **Party-line vote**: a roll call where most voting Democrats and most voting Republicans took opposite
  sides. Independents count with the party they caucus with.
- **Party unity**: on party-line votes, how often the senator sided with their own party.
- **Broke with party**: any vote where the senator voted against most of their own party.
- **Agreement**: share of votes, where both senators voted Yea or Nay, on which they voted the same way
  (at least 25 shared votes).
- **Bipartisan bills**: sponsored measures with at least one cosponsor from the other party.
- **Ideology score**: Voteview's DW-NOMINATE first dimension, from -1 (most liberal) to +1 (most
  conservative), estimated from every roll-call vote.
- **Bill status**: the furthest milestone reached (introduced, out of committee, passed a chamber, sent
  to the President, became law), read from the official action history.
- **Key vote**: a final vote on a measure that became law; final passage of any bill; a final vote on a
  budget, reconciliation or spending bill; a veto override; confirmation of a cabinet-level official,
  Supreme Court justice or Fed chair; any final passage or confirmation decided by 2 votes or fewer; or a
  war powers vote. The rules live in `key_reasons()` in `pipeline/export.py`.

## Topics, and "where they stand"

- **Bills** get their topic from the policy area the Congressional Research Service assigns every bill
  (only 7 of 6,886 Senate measures lack one). `pipeline/topics.py` groups the ~33 official policy areas
  into about 20 plain-language topics.
- **Votes** take the topic of the bill they are about. Nomination votes are "Nominations". Amendments to
  budget and spending bills (budget resolutions, reconciliation, appropriations) cover every subject, so
  their topic is read from the amendment's own text with keyword rules (e.g. "Medicaid" → health care,
  "tariffs" → business, finance & trade). Edit the rules in `topics.py` to change how they're sorted.
- **Where they stand**: a Yea vote is not support for a topic, because bills on the same topic pull in
  opposite directions. So each topic shows which side the senator took when the parties split (party-line
  votes), plus how many bills they sponsored and cosponsored on it.
- **The summary** on each profile is written by fixed rules from those same numbers (party-unity rank,
  the topics where they cross party lines most, what they introduce, bipartisan cosponsors, confirmation
  votes, attendance). No AI writes it, so every claim can be traced to a number on the page.

## Project layout

```
pipeline/            Python data pipeline (standard library only)
  members.py         senators, terms, committees    <- congress-legislators
  votes.py           roll calls + positions         <- Voteview (works for the House too)
  bills.py           bills, cosponsors, actions     <- GovInfo BILLSTATUS
  topics.py          topic groups + amendment keyword rules
  export.py          computes the statistics and summaries, writes web/data/*.json
  db.py              SQLite schema (data/tracker.db is the source of truth)
web/                 static website (plain HTML/CSS/JavaScript, no build step)
  js/views/          one file per page
  js/voteguide.js    plain-English explanations of each kind of vote
  data/              generated JSON (rebuilt by the pipeline)
data/                raw downloads + SQLite database (generated, safe to delete)
serve.py             local web server (Start Voting Tracker.bat runs it)
.github/workflows/   the scheduled job that updates and publishes the site on GitHub
```

## Put it online (free, updates itself)

The included GitHub workflow (`.github/workflows/update-and-publish.yml`) downloads new data twice an
hour and republishes the site to GitHub Pages, so the public site stays current without your computer.

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Put this folder on GitHub as a **public** repository. Free Pages hosting and unlimited workflow
   minutes need a public repo; the code becomes visible, and the data is public anyway. The easiest way
   is [GitHub Desktop](https://desktop.github.com): sign in, then *File → Add local repository* → choose
   this folder → *create a repository* → *Publish repository*, unticking "Keep this code private".
   `.gitignore` keeps the downloaded data out. With the GitHub CLI instead: `gh auth login`, then
   `gh repo create voting-tracker --public --source . --push`.
3. On the repository page: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
4. *Actions* tab → *Update data and publish site* → *Run workflow*. About two minutes later the site is
   live at `https://YOUR-USERNAME.github.io/voting-tracker/`, and it refreshes itself every 30 minutes.

GitHub pauses scheduled workflows in a repository that has had no commits for 60 days; if the site stops
updating, open the Actions tab and re-enable the workflow (or push any small change).

## Roadmap

1. **Senate** (done): refine it first.
2. **House**: Clerk of the House roll-call XML (posted within minutes) plus Voteview, the same bill
   records, and congressional-district maps. `votes.py` already accepts `chamber="house"`.
3. **President**: executive orders and proclamations (Federal Register API, no key), bills signed or
   vetoed, and nominations tied to the Senate confirmation votes already tracked.
4. **States**: Open States or LegiScan (both have free API keys). Coverage and speed vary by state.

## Notes

- To track another Congress (e.g. the 120th, starting Jan 3, 2027), set `TRACKER_CONGRESS=120`.
- `data/` and `web/data/` are rebuilt on every run. Delete them to start fresh.
- This folder lives in OneDrive, so OneDrive syncs the generated files too (about 40 MB raw plus 30 MB of
  JSON). If that gets in the way, move the project outside OneDrive.
