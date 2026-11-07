// A minimalist take on the Senate front page: a design preview (web/minimal.html) that runs on the
// same data as the main tracker. Links into the tracker ("./#/senate/...") open the main app.

import { senate } from './data.js';
import {
  h, fmtDate, num, pctText, timeAgo, voteTitle, shortResult, PARTY_NAME, STATE_NAMES, setTopics, senatorHref,
} from './ui.js';
import { explainVote, KEY_REASON } from './voteguide.js';
import { searchBox } from './search.js';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const toApp = (hash) => `./${hash}`; // "#/senate/..." -> the main tracker
const PLURAL = { D: 'Democrats', R: 'Republicans', I: 'Independents' };
const IDEO_FALLBACK = { D: -0.35, I: -0.3, R: 0.5 }; // only if a senator has no score yet
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A tile-grid map: every state is one square in roughly its place, on 12 columns and 8 rows.
const TILES = {
  AK: [0, 0], ME: [11, 0],
  VT: [10, 1], NH: [11, 1],
  WA: [1, 2], ID: [2, 2], MT: [3, 2], ND: [4, 2], MN: [5, 2], IL: [6, 2], WI: [7, 2], MI: [8, 2], NY: [9, 2], RI: [10, 2], MA: [11, 2],
  OR: [1, 3], NV: [2, 3], WY: [3, 3], SD: [4, 3], IA: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
  CA: [1, 4], UT: [2, 4], CO: [3, 4], NE: [4, 4], MO: [5, 4], KY: [6, 4], WV: [7, 4], VA: [8, 4], MD: [9, 4], DE: [10, 4],
  AZ: [2, 5], NM: [3, 5], KS: [4, 5], AR: [5, 5], TN: [6, 5], NC: [7, 5], SC: [8, 5],
  OK: [4, 6], LA: [5, 6], MS: [6, 6], AL: [7, 6], GA: [8, 6],
  HI: [0, 7], TX: [4, 7], FL: [8, 7],
};

// ------------------------------------------------------------------ shell

function setupTheme() {
  const button = document.getElementById('theme');
  const current = () => document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const label = () => button.setAttribute('aria-label', `Switch to ${current() === 'dark' ? 'light' : 'dark'} mode`);
  button.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
    label();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
}

function setupDateline() {
  const d = new Date();
  document.getElementById('dateline').textContent =
    `${DAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function setupSlashKey() {
  // "/" jumps to the search box (unless you're already typing somewhere).
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    const input = document.querySelector('.search-input');
    if (e.key === '/' && !typing && input) {
      e.preventDefault();
      input.focus();
    }
  });
}

/** Sections and rows drift up as they scroll into view. Without motion (or JS) everything simply shows. */
function setupReveal(root) {
  const targets = [...root.querySelectorAll('.reveal, .stagger')];
  if (reducedMotion || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('motion');
  let fired = false;
  const io = new IntersectionObserver((entries) => {
    fired = true;
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((el) => io.observe(el));
  // Safety net: a throttled background tab may never report visibility, so show everything.
  setTimeout(() => { if (!fired) targets.forEach((el) => el.classList.add('in')); }, 1500);
}

// ------------------------------------------------------------------ pieces

function section(id, no, kicker, title, accent, lede, link, ...body) {
  return h('section', { class: 'sec', id, 'aria-labelledby': `${id}-title` },
    h('header', { class: 'sec-head reveal' },
      h('p', { class: 'sec-no' }, h('span', null, no), kicker),
      h('div', { class: 'sec-titles' },
        h('h2', { id: `${id}-title` }, title, ' ', h('em', null, accent)),
        lede ? h('p', null, lede) : null),
      link ? h('a', { class: 'sec-link', href: link[1] }, link[0], h('span', { 'aria-hidden': 'true' }, '→')) : null),
    ...body);
}

function initials(name) {
  const parts = (name || '').split(/\s+/).filter((p) => /^[A-Za-z]/.test(p));
  return ((parts[0]?.[0] || '') + (parts.at(-1)?.[0] || '')).toUpperCase();
}

function portrait(x) {
  const box = h('span', { class: 'portrait', 'aria-hidden': 'true' });
  if (!x.photo) {
    box.textContent = initials(x.name);
    return box;
  }
  const img = h('img', { src: x.photo, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => { img.remove(); box.textContent = initials(x.name); });
  box.append(img);
  return box;
}

function delegationText(seats) {
  if (!seats.length) return 'No senators';
  if (seats.length === 1) return `One ${PARTY_NAME[seats[0].party]}, one seat vacant`;
  const [a, b] = seats.map((x) => x.party);
  return a === b ? `Two ${PLURAL[a]}` : `One ${PARTY_NAME[a]}, one ${PARTY_NAME[b]}`;
}

// ------------------------------------------------------------------ hero

function hero(meta, senators, current) {
  const side = (p) => current.filter((x) => (x.caucus || x.party) === p).length;
  const [dSide, rSide] = [side('D'), side('R')];
  const majority = rSide > dSide ? 'Republican majority' : dSide > rSide ? 'Democratic majority' : 'Evenly split';
  // The dot only turns green when the data was rebuilt in the last two days.
  const fresh = Date.now() - Date.parse(meta.generatedAt) < 2 * 86400000;
  return h('section', { class: 'hero', 'aria-labelledby': 'hero-title' },
    h('div', { class: 'hero-labels' },
      h('span', null, 'United States Senate'),
      h('span', null, `${meta.congressLabel} · ${meta.congressStart.slice(0, 4)}–${meta.congressEnd.slice(2, 4)}`),
      h('span', {
        class: `fresh${fresh ? ' on' : ''}`,
        title: fresh ? 'Data rebuilt in the last two days' : 'Data not rebuilt in the last two days',
      }, h('i', { 'aria-hidden': 'true' }), `Updated ${timeAgo(meta.generatedAt)}`)),
    h('div', { class: 'hero-head' },
      h('h1', { class: 'hero-title', id: 'hero-title' },
        h('span', { class: 'ln' }, h('span', null, 'Every vote,')),
        h('span', { class: 'ln' }, h('span', null, h('em', null, 'on the record.')))),
      h('p', { class: 'majority' },
        h('b', null, `${Math.max(dSide, rSide)}–${Math.min(dSide, rSide)}`),
        h('span', null, majority))),
    h('div', { class: 'hero-sub' },
      h('p', { class: 'hero-lede' }, 'What all one hundred senators write, sign on to and vote for, drawn from official congressional records and kept current as the Senate acts.'),
      h('div', { class: 'hero-find' },
        searchBox(senators, meta.congress),
        h('p', { class: 'hero-note' },
          h('span', null, `Latest roll call ${fmtDate(meta.latestVote)}`),
          h('span', { class: 'kbd-hint' }, 'Press ', h('kbd', null, '/'), ' to search')))),
    chamber(current));
}

/** All 100 senators as 100 fine lines, ordered by voting record, colored by party. */
function chamber(current) {
  const score = (x) => x.ideo ?? IDEO_FALLBACK[x.party] ?? 0;
  const seats = [...current].sort((a, b) => score(a) - score(b));
  const count = (p) => current.filter((x) => x.party === p).length;
  const tip = h('div', { class: 'strip-tip', 'aria-hidden': 'true', hidden: true });
  const strip = h('div', {
    class: 'strip', role: 'group',
    'aria-label': `All ${seats.length} senators, from most liberal to most conservative by voting record. Use the arrow keys to move between them.`,
  });
  const links = seats.map((x, i) => h('a', {
    class: `seat p-${x.party}`, href: toApp(senatorHref(x.id)), tabindex: i ? '-1' : '0',
    'aria-label': `${x.name}, ${PARTY_NAME[x.party]}, ${STATE_NAMES[x.state]}`,
    style: { '--i': String(i) },
  }, h('span', { class: 'tk' })));
  strip.append(...links, tip);

  function show(i) {
    const x = seats[i];
    tip.replaceChildren(
      h('span', { class: 'tip-name' }, x.name),
      h('span', { class: 'tip-meta' }, `${PARTY_NAME[x.party]} · ${STATE_NAMES[x.state]}`),
      h('span', { class: 'tip-meta' }, `${pctText(x.stats.unity, 0)} party unity · ${pctText(x.stats.missedPct, 1)} missed`));
    tip.hidden = false;
    strip.classList.add('lit');
    links.forEach((a, k) => a.classList.toggle('on', k === i));
    // Center the label over its line, but keep it inside the strip at either end.
    const width = strip.clientWidth;
    const center = ((i + 0.5) / seats.length) * width;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(width - half, Math.max(half, center))}px`;
  }
  function hide() {
    tip.hidden = true;
    strip.classList.remove('lit');
    links.forEach((a) => a.classList.remove('on'));
  }

  // Touch: the first tap shows a senator, a second tap on the same line opens their page.
  let pointer = 'mouse';
  strip.addEventListener('pointerdown', (e) => { pointer = e.pointerType; });
  links.forEach((a, i) => {
    a.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') show(i); });
    a.addEventListener('focus', () => show(i));
    a.addEventListener('click', (e) => {
      if (pointer === 'touch' && !a.classList.contains('on')) { e.preventDefault(); show(i); }
    });
    a.addEventListener('keydown', (e) => {
      const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: seats.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      const j = Math.max(0, Math.min(seats.length - 1, next));
      links[i].tabIndex = -1;
      links[j].tabIndex = 0;
      links[j].focus();
    });
  });
  // Keep the label while a keyboard user is on a line; otherwise it goes with the pointer.
  strip.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && !strip.querySelector(':focus-visible')) hide(); });
  strip.addEventListener('focusout', (e) => { if (!strip.contains(e.relatedTarget)) hide(); });
  document.addEventListener('pointerdown', (e) => { if (!strip.contains(e.target)) hide(); });

  const item = (p, label) => (count(p) ? h('span', { class: `lg p-${p}` }, h('b', null, String(count(p))), ` ${count(p) === 1 ? PARTY_NAME[p] : label}`) : null);
  return h('figure', { class: 'chamber' },
    strip,
    h('div', { class: 'strip-foot' },
      h('span', { class: 'end' }, '← More liberal'),
      h('div', { class: 'legend' }, item('D', 'Democrats'), item('I', 'Independents'), item('R', 'Republicans')),
      h('span', { class: 'end' }, 'More conservative →')),
    h('figcaption', null,
      'Each line is one senator, placed by voting record (', h('span', { class: 'nw' }, 'DW-NOMINATE'), ' scores from Voteview). ',
      h('span', { class: 'hint-hover' }, 'Hover to meet them.'),
      h('span', { class: 'hint-touch' }, 'Tap a line to meet a senator; tap it again to open their page.')));
}

// ------------------------------------------------------------------ figures

function figures(meta, votesData, recent) {
  const sessions = {};
  for (const v of votesData.votes) sessions[v.s] = (sessions[v.s] || 0) + 1;
  const startYear = Number(meta.congressStart.slice(0, 4));
  const bySession = Object.entries(sessions).map(([s, n]) => `${num(n)} in ${startYear + Number(s) - 1}`).join(', ');
  const items = [
    [meta.counts.votes, 'Roll-call votes', bySession],
    [votesData.votes.filter((v) => v.key).length, 'Key votes', 'Laws, budgets, cabinet picks and the closest calls'],
    [meta.counts.measures, 'Bills & resolutions', 'Introduced by senators this Congress'],
    [recent.laws.filter((b) => /^s/.test(b.id)).length, 'Signed into law', 'Senate bills enacted this Congress'],
  ];
  return h('section', { class: 'figures', 'aria-label': `The ${meta.congressLabel} in numbers` },
    items.map(([n, label, sub], i) => h('div', { class: 'figure reveal', style: { '--d': `${i * 90}ms` } },
      h('span', { class: 'fig-no' }, String(i + 1).padStart(2, '0')),
      h('p', { class: 'fig-v' }, num(n)),
      h('p', { class: 'fig-l' }, label),
      h('p', { class: 'fig-sub' }, sub))));
}

// ------------------------------------------------------------------ 01 votes

function voteEntry(v, bills) {
  const bill = v.bill ? bills[v.bill] : null;
  const kind = explainVote(v, bill).title;
  const [yea, nay] = v.t;
  const seats = Math.max(100, yea + nay);
  const need = { '3/5': 60, '2/3': 66.67 }[v.req] || 50;
  // "War powers resolution · War powers" says the same thing twice; keep the first.
  const reasons = (v.key || []).map((k) => KEY_REASON[k] || k).filter((r) => !kind.toLowerCase().includes(r.toLowerCase()));
  const meta = [kind, ...reasons, v.pl ? 'Party-line' : null].filter(Boolean);
  const outcome = v.ok === 1 ? 'won' : v.ok === 0 ? 'lost' : '';
  return h('li', { class: 'reveal' },
    h('a', { class: 'entry', href: toApp(`#/senate/vote/${v.id}`) },
      h('span', { class: 'e-date' }, fmtDate(v.d)),
      h('span', { class: 'e-main' },
        h('span', { class: 'e-title' }, voteTitle(v, bills)),
        h('span', { class: 'e-meta' }, meta.map((m, k) => [k ? ' · ' : '', h('span', { class: 'nw' }, m)]))),
      h('span', { class: 'e-out' },
        h('span', { class: `e-res ${outcome}` }, shortResult(v.r)),
        h('span', { class: 'e-tally' }, `${yea}–${nay}`),
        h('span', {
          class: 'e-bar', role: 'img',
          'aria-label': `${yea} yea, ${nay} nay; it needed ${need === 50 ? 'a simple majority' : `${Math.round(need)} votes`}`,
          style: { '--yea': `${(100 * yea) / seats}%`, '--nay': `${(100 * nay) / seats}%`, '--need': `${need}%` },
        }, h('i', { class: 'y' }), h('i', { class: 'n' })))));
}

function keyVotes(votesData) {
  const list = votesData.votes.filter((v) => v.key).slice(-6).reverse();
  return section('votes', '01', 'Votes', 'The votes that', 'mattered.',
    'Laws, budgets, cabinet picks, war powers and the closest calls: the six most recent key votes on the Senate floor.',
    ['All key votes', toApp('#/senate/votes?key=1')],
    h('ol', { class: 'ledger' }, list.map((v) => voteEntry(v, votesData.bills))));
}

// ------------------------------------------------------------------ 02 states

function statesSection(current) {
  const byState = new Map();
  for (const x of current) {
    if (!byState.has(x.state)) byState.set(x.state, []);
    byState.get(x.state).push(x);
  }
  for (const seats of byState.values()) {
    seats.sort((a, b) => (a.rank === 'senior' ? -1 : b.rank === 'senior' ? 1 : a.since.localeCompare(b.since)));
  }

  const stat = (value, label) => h('span', null, h('b', null, value), h('small', null, label));
  const person = (x) => {
    const caucus = x.party === 'I' && x.caucus && x.caucus !== 'I' ? `Caucuses with ${PLURAL[x.caucus]}` : null;
    const role = [
      PARTY_NAME[x.party],
      caucus,
      x.rank ? `${x.rank[0].toUpperCase()}${x.rank.slice(1)} senator` : null,
      `${x.how === 'appointment' ? 'Appointed' : 'Since'} ${x.since.slice(0, 4)}`,
    ].filter(Boolean).map((part, k) => [k ? ' · ' : '', h('span', { class: 'nw' }, part)]);
    return h('a', { class: 'person', href: toApp(senatorHref(x.id)) },
      portrait(x),
      h('span', { class: 'person-body' },
        h('span', { class: 'person-name' }, x.name),
        h('span', { class: 'person-role' }, h('i', { class: `sw p-${x.party}`, 'aria-hidden': 'true' }), h('span', null, role)),
        h('span', { class: 'person-stats' },
          stat(pctText(x.stats.unity), 'Party unity'),
          stat(pctText(x.stats.missedPct), 'Missed votes'),
          stat(num(x.stats.sponsored), 'Bills sponsored'))));
  };

  const all = [...byState.values()];
  const same = (p) => all.filter((s) => s.length === 2 && s.every((x) => x.party === p)).length;
  const [dd, rr] = [same('D'), same('R')];
  const split = all.filter((s) => new Set(s.map((x) => x.party)).size > 1).length;
  const overview = () => h('div', { class: 'st-over' },
    h('p', { class: 'st-k' }, 'The delegations'),
    h('p', { class: 'st-lead' }, 'Two seats per state, fifty states. Here is how they divide.'),
    h('div', {
      class: 'deleg-bar', role: 'img',
      'aria-label': `${dd} states with two Democrats, ${split} with senators from two parties, ${rr} with two Republicans`,
    },
      h('i', { class: 'p-D', style: { flexGrow: String(dd) } }),
      h('i', { class: 'split', style: { flexGrow: String(split) } }),
      h('i', { class: 'p-R', style: { flexGrow: String(rr) } })),
    h('ul', { class: 'deleg' },
      h('li', { class: 'p-D' }, h('b', null, String(dd)), h('span', null, 'States with two Democrats')),
      h('li', { class: 'split' }, h('b', null, String(split)), h('span', null, 'States with senators from two parties')),
      h('li', { class: 'p-R' }, h('b', null, String(rr)), h('span', null, 'States with two Republicans'))),
    h('p', { class: 'st-hint' },
      h('span', { class: 'hint-hover' }, 'Hover a state to meet its senators; click to keep it here.'),
      h('span', { class: 'hint-touch' }, 'Tap a state to meet its senators.')));
  const detail = (abbr) => {
    const seats = byState.get(abbr) || [];
    return h('div', { class: 'st-detail' },
      h('p', { class: 'st-k' }, `${abbr} · ${delegationText(seats)}`),
      h('h3', { class: 'st-name' }, STATE_NAMES[abbr]),
      h('div', { class: 'st-people' }, seats.map(person)),
      h('a', { class: 'st-link', href: toApp(`#/senate/state/${abbr}`) }, `Open ${STATE_NAMES[abbr]}`, h('span', { 'aria-hidden': 'true' }, '→')));
  };

  const panel = h('div', { class: 'st-panel' });
  const status = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  const views = new Map(); // built once per state, so portraits don't reload
  const render = (abbr) => {
    const key = abbr || '';
    if (!views.has(key)) views.set(key, abbr ? detail(abbr) : overview());
    const node = views.get(key);
    if (panel.firstChild !== node) panel.replaceChildren(node);
  };

  let pinned = null;
  const tiles = Object.entries(TILES).map(([abbr, [col, row]], k) => {
    const seats = byState.get(abbr) || [];
    return h('button', {
      class: 'tile', type: 'button', 'data-state': abbr, tabindex: k ? '-1' : '0', 'aria-pressed': 'false',
      'aria-label': `${STATE_NAMES[abbr]}: ${delegationText(seats)}`,
      style: { gridColumn: String(col + 1), gridRow: String(row + 1), '--col': String(col), '--row': String(row) },
    },
      h('span', { class: 'ab' }, abbr),
      h('span', { class: 'pair', 'aria-hidden': 'true' },
        seats.map((x) => h('span', { class: `pp p-${x.party}` }, h('b', null, x.party), h('i')))));
  });
  const grid = h('div', {
    class: 'tiles', role: 'group',
    'aria-label': 'States on a grid map. Use the arrow keys to move between them and Enter to show one.',
  }, tiles);

  function pin(abbr) {
    pinned = abbr;
    tiles.forEach((t) => t.setAttribute('aria-pressed', t.dataset.state === abbr ? 'true' : 'false'));
    render(abbr);
    status.textContent = abbr ? `Showing ${STATE_NAMES[abbr]}: ${delegationText(byState.get(abbr) || [])}` : 'Showing all fifty states';
  }

  // Arrow keys move to the nearest state in that direction, preferring the same row or column.
  function neighbor(abbr, key) {
    const [c, r] = TILES[abbr];
    let best = null;
    let bestScore = Infinity;
    for (const [other, [c2, r2]] of Object.entries(TILES)) {
      const dc = c2 - c;
      const dr = r2 - r;
      const ahead = { ArrowRight: dc, ArrowLeft: -dc, ArrowDown: dr, ArrowUp: -dr }[key];
      if (!(ahead > 0)) continue;
      const off = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dr) : Math.abs(dc);
      const scoreOf = off * 10 + ahead;
      if (scoreOf < bestScore) { bestScore = scoreOf; best = other; }
    }
    return best;
  }

  tiles.forEach((t) => {
    const abbr = t.dataset.state;
    t.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') render(abbr); });
    t.addEventListener('focus', () => render(abbr));
    t.addEventListener('click', () => pin(pinned === abbr ? null : abbr));
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { pin(null); return; }
      const next = neighbor(abbr, e.key);
      if (!next) return;
      e.preventDefault();
      const target = tiles.find((x) => x.dataset.state === next);
      t.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    });
  });
  grid.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') render(pinned); });
  grid.addEventListener('focusout', (e) => { if (!grid.contains(e.relatedTarget)) render(pinned); });
  render(null);

  const legendItem = (p) => h('span', { class: `p-${p}` }, PARTY_NAME[p]);
  const list = h('details', { class: 'st-list' },
    h('summary', null, 'View all states as a list'),
    h('ul', null, Object.keys(STATE_NAMES).map((abbr) => h('li', null,
      h('a', { href: toApp(`#/senate/state/${abbr}`) }, STATE_NAMES[abbr]),
      h('span', null, (byState.get(abbr) || []).map((x) => `${x.name} (${x.party})`).join(', '))))));

  return section('states', '02', 'States', 'Fifty states,', 'one hundred seats.',
    'Every state sends two senators, each elected to a six-year term. Pick a state to meet its pair.',
    ['All senators', toApp('#/senate/senators')],
    h('div', { class: 'states stagger' },
      h('div', { class: 'map' },
        grid,
        h('div', { class: 'map-foot' },
          h('div', { class: 'map-legend' }, legendItem('D'), legendItem('R'), legendItem('I')),
          h('span', null, 'Letters mark each seat’s party')),
        list),
      panel),
    status);
}

// ------------------------------------------------------------------ 03 topics

function topicsSection(topics) {
  const list = topics.filter((t) => t.id !== 'other' && t.counts.bills > 0).sort((a, b) => b.counts.bills - a.counts.bills);
  const max = list[0]?.counts.bills || 1;
  const noms = topics.find((t) => t.id === 'nominations');
  return section('topics', '03', 'Topics', 'What the Senate', 'works on.',
    'Every bill is filed under one topic. Each rule is drawn to scale: bills and resolutions introduced this Congress.',
    ['All topics', toApp('#/senate/topics')],
    h('ol', { class: 'index' }, list.map((t, i) => h('li', { class: 'reveal', style: { '--d': `${(i % 10) * 45}ms` } },
      h('a', { href: toApp(`#/senate/topic/${t.id}`), style: { '--w': (t.counts.bills / max).toFixed(4) } },
        h('span', { class: 'ix-n' }, String(i + 1).padStart(2, '0')),
        h('span', { class: 'ix-label' }, t.label),
        h('span', { class: 'ix-count' }, num(t.counts.bills), h('span', { class: 'visually-hidden' }, ' bills')))))),
    noms?.counts.votes
      ? h('p', { class: 'index-note' }, `Nominations aren’t bills, so they aren’t counted here. The Senate held ${num(noms.counts.votes)} roll-call votes on them.`)
      : null);
}

// ------------------------------------------------------------------ footer

function footer(meta) {
  document.getElementById('foot').replaceChildren(
    h('div', { class: 'foot-grid reveal' },
      h('div', null,
        h('p', { class: 'foot-k' }, 'About'),
        h('p', null, 'Every Senate vote and bill, rebuilt from free public records. Independent: not affiliated with Congress, any party or any campaign.')),
      h('div', null,
        h('p', { class: 'foot-k' }, 'Sources'),
        h('ul', null, meta.sources.map((src) => h('li', null, h('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.name))))),
      h('div', null,
        h('p', { class: 'foot-k' }, 'Freshness'),
        h('p', null, `Data rebuilt ${timeAgo(meta.generatedAt)}`),
        h('p', null, `Latest roll call ${fmtDate(meta.latestVote)}`)),
      h('div', null,
        h('p', { class: 'foot-k' }, 'Design preview'),
        h('p', null, 'A minimalist take on the front page.'),
        h('p', null, h('a', { href: './' }, 'Open the current design →')))),
    h('p', { class: 'foot-mark reveal', 'aria-hidden': 'true' }, 'Voting ', h('em', null, 'Tracker')));
}

// ------------------------------------------------------------------ start

async function start() {
  setupTheme();
  setupDateline();
  setupSlashKey();
  if (location.protocol === 'file:') return; // the page explains how to open it instead
  const main = document.getElementById('main');
  try {
    const [meta, senators, votesData, recent, topics] = await Promise.all([
      senate.meta(), senate.senators(), senate.votes(), senate.recent(), senate.topics(),
    ]);
    setTopics(meta.topics); // the search box suggests topics
    const current = senators.filter((x) => x.current);
    main.replaceChildren(
      hero(meta, senators, current),
      figures(meta, votesData, recent),
      keyVotes(votesData),
      statesSection(current),
      topicsSection(topics));
    footer(meta);
    setupReveal(document.body);
  } catch (err) {
    console.error(err);
    main.replaceChildren(h('div', { class: 'boot' },
      h('p', null, h('strong', null, 'The data could not be loaded.')),
      h('p', null, String(err?.message || err)),
      h('p', null, 'Run ', h('code', null, 'python -m pipeline update'), ' in the project folder, then reload.')));
  }
}

start();
