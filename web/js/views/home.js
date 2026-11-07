// Senate home: a dark "stage" (headline, search, seat chart, headline numbers, live ticker),
// then the state explorer, the votes that mattered, and what's moving.

import { senate, senatorsById } from '../data.js';
import {
  h, avatar, partyTag, PARTY_NAME, STATE_NAMES, fmtDate, num, pctText, statTile, billRow, voteRow,
  senatorHref, timeAgo, topicTag, topicList, animateCounts, voteTitle,
} from '../ui.js';
import { drawSenateMap } from '../map.js';
import { legend, hemicycle, sparkline } from '../charts.js';
import { searchBox } from '../search.js';

let mounted = null; // { root, select(code, opts) }

export function isMounted() {
  return Boolean(mounted && mounted.root.isConnected);
}

export function selectState(code) {
  mounted?.select(code, { scroll: true });
}

const today = new Date().toISOString().slice(0, 10);
const IDEO_FALLBACK = { D: -0.35, I: -0.3, R: 0.5 }; // only if a senator has no score yet

export function termText(x) {
  if (!x.current) return `left office ${fmtDate(x.left)}`;
  if (x.termEnd && x.termEnd <= today) return 'serving until a successor is sworn in';
  return `term ends ${fmtDate(x.termEnd)}`;
}

function mini(label, value) {
  return h('span', { class: 'mini-stat' }, h('span', { class: 'v' }, value), h('span', { class: 'l' }, label));
}

export function senatorCard(x) {
  const role = [
    PARTY_NAME[x.party] + (x.party === 'I' && x.caucus === 'D' ? ' (caucuses with Democrats)' : ''),
    x.rank ? `${x.rank[0].toUpperCase()}${x.rank.slice(1)} senator` : null,
  ].filter(Boolean).join(' · ');
  return h('a', { class: 'senator-card', href: senatorHref(x.id) },
    avatar(x, 'md'),
    h('div', null,
      h('div', { class: 'name' }, x.name, ' ', partyTag(x.party, x.state)),
      h('div', { class: 'meta' }, role),
      h('div', { class: 'meta' }, `${x.how === 'appointment' ? 'Appointed' : 'Serving since'} ${fmtDate(x.since)} · ${termText(x)}`),
      h('div', { class: 'mini-stats' },
        mini('Missed votes', pctText(x.stats.missedPct)),
        mini('Party unity', pctText(x.stats.unity)),
        mini('Bills sponsored', num(x.stats.sponsored)),
        mini('Became law', num(x.stats.enacted)))));
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
}

/** The floating card shown over a hovered seat. */
function seatCard(x) {
  return h('div', { class: 'seat-card' },
    avatar(x, 'sm'),
    h('div', null,
      h('div', { class: 'seat-name' }, x.name),
      h('div', { class: 'seat-meta' }, `${PARTY_NAME[x.party]} · ${STATE_NAMES[x.state]}`),
      h('div', { class: 'seat-stats' },
        h('span', null, h('b', null, pctText(x.stats.unity, 0)), ' party unity'),
        h('span', null, h('b', null, pctText(x.stats.missedPct, 1)), ' missed'))));
}

/** A slow, endless crawl of the latest roll calls (pauses on hover; static if motion is reduced). */
function ticker(votesData) {
  const items = () => votesData.votes.slice(-14).reverse().map((v) => h('a', { class: 'tick-item', href: `#/senate/vote/${v.id}` },
    h('span', { class: 'tick-res', 'aria-hidden': 'true' }, v.ok === 1 ? '✓' : v.ok === 0 ? '✕' : '•'),
    h('span', { class: 'visually-hidden' }, v.ok === 1 ? 'Passed: ' : v.ok === 0 ? 'Failed: ' : ''),
    h('span', null, clip(voteTitle(v, votesData.bills), 72)),
    h('span', { class: 'tick-tally' }, `${v.t[0]}–${v.t[1]}`)));
  const copy = h('div', { class: 'ticker-group', 'aria-hidden': 'true' }, items());
  copy.querySelectorAll('a').forEach((a) => a.setAttribute('tabindex', '-1'));
  return h('div', { class: 'ticker' },
    h('span', { class: 'ticker-label' }, 'Latest votes'),
    h('div', { class: 'ticker-viewport' },
      h('div', { class: 'ticker-track' }, h('div', { class: 'ticker-group' }, items()), copy)));
}

function sectionHead(title, accent, lede, link) {
  return h('div', { class: 'section-head' },
    h('div', null,
      h('h2', { class: 'display' }, title, ' ', h('em', null, accent)),
      lede ? h('p', null, lede) : null),
    link ? h('a', { class: 'more-link', href: link[1] }, link[0]) : null);
}

function heroStage(meta, senators, current, kpis, votesData) {
  const count = (p) => current.filter((x) => x.party === p).length;
  const [d, r, i] = [count('D'), count('R'), count('I')];
  const dSide = d + current.filter((x) => x.party === 'I' && x.caucus === 'D').length;
  const rSide = r + current.filter((x) => x.party === 'I' && x.caucus === 'R').length;
  const majority = rSide > dSide ? 'Republican majority' : dSide > rSide ? 'Democratic majority' : 'Evenly split';
  const seats = [...current].sort((a, b) => (a.ideo ?? IDEO_FALLBACK[a.party]) - (b.ideo ?? IDEO_FALLBACK[b.party]));
  // The dot only glows green when the data was rebuilt in the last two days.
  const fresh = Date.now() - Date.parse(meta.generatedAt) < 2 * 86400000;
  return h('section', { class: 'stage hero-stage' },
    h('div', { class: 'hero-copy-c' },
      h('div', { class: `live-pill${fresh ? ' fresh' : ''}`, title: fresh ? 'Data rebuilt in the last two days' : 'Data not rebuilt in the last two days' },
        h('span', { class: 'live-dot', 'aria-hidden': 'true' }), `U.S. Senate · ${meta.congressLabel}`),
      h('h1', { class: 'hero-title' },
        h('span', { class: 'line' }, h('span', null, 'The Senate,')),
        h('span', { class: 'line' }, h('span', null, h('em', null, 'vote by vote.')))),
      h('p', { class: 'hero-lede' }, 'What every senator writes, signs on to and votes for, rebuilt from official congressional records and refreshed as the Senate acts.'),
      searchBox(senators, meta.congress),
      h('div', { class: 'hero-meta' }, `Latest roll call ${fmtDate(meta.latestVote)} · updated ${timeAgo(meta.generatedAt)}`)),
    h('div', { class: 'hero-chart' },
      hemicycle(seats, {
        center: { small: majority, big: `${Math.max(rSide, dSide)}–${Math.min(rSide, dSide)}` },
        card: seatCard,
        onPick: (id) => { location.hash = senatorHref(id); },
      }),
      h('div', { class: 'hero-legend' },
        h('span', null, h('span', { class: 'dot party-D', 'aria-hidden': 'true' }), h('b', null, String(d)), 'Democrats'),
        i ? h('span', null, h('span', { class: 'dot party-I', 'aria-hidden': 'true' }), h('b', null, String(i)), i === 1 ? 'Independent' : 'Independents') : null,
        h('span', null, h('span', { class: 'dot party-R', 'aria-hidden': 'true' }), h('b', null, String(r)), 'Republicans')),
      h('p', { class: 'hero-caption-note' }, 'Seats run from most liberal (left) to most conservative (right) by voting record. ',
        h('span', { class: 'hint-hover' }, 'Hover a seat to meet its senator.'),
        h('span', { class: 'hint-touch' }, 'Tap a seat to meet its senator; tap again to open their page.'))),
    kpis,
    ticker(votesData));
}

export async function render(stateCode) {
  const [meta, senators, votesData, recent, byId] = await Promise.all([
    senate.meta(), senate.senators(), senate.votes(), senate.recent(), senatorsById(),
  ]);
  document.title = 'U.S. Senate · Voting Tracker';
  const current = senators.filter((x) => x.current);
  const seatsByState = new Map();
  for (const x of current) {
    if (!seatsByState.has(x.state)) seatsByState.set(x.state, []);
    seatsByState.get(x.state).push(x);
  }
  for (const seats of seatsByState.values()) {
    seats.sort((a, b) => (a.rank === 'senior' ? -1 : b.rank === 'senior' ? 1 : a.since.localeCompare(b.since)));
  }
  const formerByState = new Map();
  for (const x of senators.filter((y) => !y.current)) {
    if (!formerByState.has(x.state)) formerByState.set(x.state, []);
    formerByState.get(x.state).push(x);
  }

  const sessions = votesData.votes.reduce((acc, v) => { acc[v.s] = (acc[v.s] || 0) + 1; return acc; }, {});
  const sessionYear = (sNum) => Number(meta.congressStart.slice(0, 4)) + Number(sNum) - 1;
  const senateLaws = recent.laws.filter((b) => /^s/.test(b.id)).length;
  const keyVotesAll = votesData.votes.filter((v) => v.key);
  const perMonth = (list) => {
    const counts = {};
    for (const v of list) counts[v.d.slice(0, 7)] = (counts[v.d.slice(0, 7)] || 0) + 1;
    return meta.months.map((m) => counts[m] || 0);
  };
  const kpis = h('div', { class: 'kpis' },
    statTile('Roll-call votes', num(meta.counts.votes),
      Object.entries(sessions).map(([sNum, n]) => `${num(n)} in ${sessionYear(sNum)}`).join(' · '),
      { count: meta.counts.votes, spark: sparkline(perMonth(votesData.votes), meta.months) }),
    statTile('Key votes', num(keyVotesAll.length), 'Laws, budget fights, cabinet picks, close calls',
      { count: keyVotesAll.length, spark: sparkline(perMonth(keyVotesAll), meta.months) }),
    statTile('Bills & resolutions', num(meta.counts.measures), 'Introduced by senators this Congress',
      { count: meta.counts.measures, spark: sparkline(meta.monthly?.introduced || [], meta.months) }),
    statTile('Signed into law', num(senateLaws), 'Senate bills enacted this Congress',
      { count: senateLaws, spark: sparkline(meta.monthly?.laws || [], meta.months) }));

  // ---- state explorer: the map beside the selected state's senators
  const mapBox = h('div', { class: 'map-wrap' }, h('div', { class: 'loading' }, 'Loading map'));
  const select = h('select', { class: 'select', 'aria-label': 'Choose a state' },
    h('option', { value: '' }, 'Choose a state…'),
    Object.entries(STATE_NAMES).map(([abbr, name]) => h('option', { value: abbr }, name)));
  const go = (code) => { location.hash = code ? `#/senate/state/${code}` : '#/senate'; };
  select.addEventListener('change', () => go(select.value));
  const panel = h('div', { class: 'state-panel', 'aria-live': 'polite' });
  const mapCard = h('section', { class: 'card map-card', id: 'states' },
    h('div', { class: 'map-col' },
      h('div', { class: 'card-head' },
        h('div', null, h('h2', null, 'The map'), h('p', null, 'Each state is split into its two seats, colored by party.')),
        select),
      mapBox,
      h('div', { class: 'map-foot' },
        legend([['bg-D', 'Democrat'], ['bg-R', 'Republican'], ['bg-I', 'Independent']]),
        h('a', { class: 'more-link', href: '#/senate/senators' }, `All ${current.length} senators →`))),
    panel);

  let mapApi = null;
  let selected = null;
  function showState(code, { scroll = false } = {}) {
    selected = code && seatsByState.has(code) ? code : null;
    select.value = selected || '';
    mapApi?.select(selected);
    if (!selected) {
      const delegations = [...seatsByState.entries()];
      const split = delegations.filter(([, seats]) => new Set(seats.map((x) => x.party)).size > 1).map(([abbr]) => abbr).sort();
      const both = (p) => delegations.filter(([, seats]) => seats.length === 2 && seats.every((x) => x.party === p)).length;
      const [dd, rr] = [both('D'), both('R')];
      const stat = (n, label, cls) => h('div', { class: 'deleg-stat' },
        h('span', { class: `dot ${cls}`, 'aria-hidden': 'true' }), h('b', null, String(n)), h('span', null, label));
      panel.replaceChildren(h('div', { class: 'state-empty' },
        h('div', { class: 'eyebrow' }, 'Pick a state'),
        h('p', { class: 'state-empty-title' }, 'Every state sends two senators. Choose one on the map to meet them.'),
        h('div', { class: 'delegations' },
          h('div', { class: 'seg-bar', role: 'img', 'aria-label': `${dd} states with two Democrats, ${split.length} with senators from two parties, ${rr} with two Republicans` },
            h('span', { class: 'bg-D', style: { flexGrow: String(dd) } }),
            h('span', { class: 'bg-context', style: { flexGrow: String(split.length) } }),
            h('span', { class: 'bg-R', style: { flexGrow: String(rr) } })),
          h('div', { class: 'deleg-stats' },
            stat(dd, `${dd === 1 ? 'state' : 'states'} with two Democrats`, 'party-D'),
            stat(split.length, `${split.length === 1 ? 'state' : 'states'} with senators from two parties`, 'bg-context'),
            stat(rr, `${rr === 1 ? 'state' : 'states'} with two Republicans`, 'party-R'))),
        split.length ? h('div', { class: 'state-suggest' },
          h('span', { class: 'muted' }, 'States with one senator from each party:'),
          h('div', { class: 'chips' }, split.map((abbr) => h('a', { class: 'chip', href: `#/senate/state/${abbr}` }, STATE_NAMES[abbr])))) : null));
      document.title = 'U.S. Senate · Voting Tracker';
      return;
    }
    document.title = `${STATE_NAMES[selected]} senators · Voting Tracker`;
    const former = formerByState.get(selected) || [];
    panel.replaceChildren(...[
      h('div', { class: 'eyebrow' }, 'Senators from'),
      h('h2', null, STATE_NAMES[selected]),
      h('div', { class: 'senator-cards' }, seatsByState.get(selected).map(senatorCard)),
      former.length ? h('p', { class: 'former' }, 'Also served this Congress: ',
        former.flatMap((x, k) => [k ? ', ' : '', h('a', { href: senatorHref(x.id) }, x.name), ` (${x.party}, until ${fmtDate(x.left)})`])) : null,
    ].filter(Boolean));
    if (scroll) {
      const box = panel.getBoundingClientRect();
      if (box.top < 70 || box.bottom > window.innerHeight) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
  showState(stateCode);
  if (stateCode) requestAnimationFrame(() => mapCard.scrollIntoView({ block: 'start' }));

  drawSenateMap(mapBox, { seatsByState, onSelect: go })
    .then((api) => { mapApi = api; api.select(selected); })
    .catch((err) => {
      console.warn(err);
      mapBox.replaceChildren(h('p', { class: 'note' }, 'The map could not be loaded (it needs an internet connection). Use the state list above.'));
    });

  // ---- activity
  const keyCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, '★ Key votes'), h('p', null, 'Laws, budget fights, cabinet confirmations, close calls, war powers')),
      h('a', { class: 'more-link', href: '#/senate/votes?key=1' }, 'All key votes →')),
    h('div', { class: 'rows compact' }, keyVotesAll.slice(-5).reverse().map((v) => voteRow(v, votesData.bills))));
  const votesCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Latest floor votes'), h('p', null, `Most recent: ${fmtDate(meta.latestVote)}`)),
      h('a', { class: 'more-link', href: '#/senate/votes' }, 'All votes →')),
    h('div', { class: 'rows compact' }, votesData.votes.slice(-5).reverse().map((v) => voteRow(v, votesData.bills))));
  const billsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Newly introduced'), h('p', null, 'The latest Senate bills and resolutions')),
      h('a', { class: 'more-link', href: '#/senate/legislation' }, 'All legislation →')),
    h('div', { class: 'rows compact' }, recent.introduced.slice(0, 6).map((b) => billRow(b, byId))));
  const topicsCard = h('section', { class: 'card topic-strip' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Browse by topic'), h('p', null, 'Every bill and roll-call vote is tagged with one topic.')),
      h('a', { class: 'more-link', href: '#/senate/topics' }, 'All topics →')),
    h('div', { class: 'tag-list' }, topicList().filter((t) => t.id !== 'other').map((t) => topicTag(t.id))));

  const root = h('div', { class: 'home' },
    heroStage(meta, senators, current, kpis, votesData),
    sectionHead('Your senators,', 'state by state.', 'Every state is split into its two seats. Pick one to see who represents it, how they vote and what they write.', null),
    mapCard,
    sectionHead('The votes', 'that mattered.', 'Laws, budget fights, cabinet confirmations and the closest calls, plus everything else on the floor.', ['All floor votes →', '#/senate/votes']),
    h('div', { class: 'grid-2-even' }, keyCard, votesCard),
    sectionHead('What’s', 'moving.', 'The newest bills and resolutions, and every topic the Senate is working on.', ['All legislation →', '#/senate/legislation']),
    h('div', { class: 'grid-2-even' }, billsCard, topicsCard));
  mounted = { root, select: showState };
  requestAnimationFrame(() => animateCounts(kpis)); // runs once the page is on screen
  return root;
}
