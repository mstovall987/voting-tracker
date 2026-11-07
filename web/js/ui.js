// Shared DOM + formatting helpers. Data is always inserted as text (h() appends text nodes,
// never innerHTML), so nothing in the data files can inject markup into the page.

import { KEY_REASON, explainVote, positionMeaning } from './voteguide.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Create an HTML element: h('a', {href: '#'}, 'text', childNode, ...) */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  append(el, children);
  return el;
}

/** Create an SVG element. */
export function s(tag, attrs = null, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) setAttrs(el, attrs);
  append(el, children);
  return el;
}

// ------------------------------------------------------------------ formatting

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-30' -> 'Sep 30, 2026' (parsed as a calendar date, so no time-zone shift). */
export function fmtDate(iso, { short = false } = {}) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return short ? `${MONTHS[m - 1]} ${d}` : `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function fmtMonth(ym, { short = false } = {}) {
  const [y, m] = ym.split('-').map(Number);
  return short ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${y}`;
}

export const num = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
export const pctText = (p, digits = 1) => (p === null || p === undefined ? '—' : `${Number(p).toFixed(digits)}%`);
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function timeAgo(isoDateTime) {
  if (!isoDateTime) return 'never';
  const seconds = (Date.now() - new Date(isoDateTime).getTime()) / 1000;
  if (seconds < 90) return 'just now';
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} minutes ago`;
  const hours = minutes / 60;
  if (hours < 36) return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const year = (iso) => (iso ? iso.slice(0, 4) : '');

// ------------------------------------------------------------------ vocabulary

export const PARTY_NAME = { D: 'Democrat', R: 'Republican', I: 'Independent' };
export const PARTY_PLURAL = { D: 'Democrats', R: 'Republicans', I: 'Independents' };
export const PARTY_ORDER = ['D', 'R', 'I'];

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming',
};

export const STATUS = {
  introduced: { label: 'Introduced', step: 0 },
  reported: { label: 'Out of committee', step: 1 },
  passed_senate: { label: 'Passed Senate', step: 2 },
  passed_house: { label: 'Passed House', step: 2 },
  passed_both: { label: 'Passed both chambers', step: 3 },
  to_president: { label: 'Sent to President', step: 4 },
  law: { label: 'Became law', step: 5 },
  vetoed: { label: 'Vetoed', step: 4 },
  agreed_to: { label: 'Agreed to', step: 5 },
  failed: { label: 'Failed', step: 2 },
};

export const CATEGORY = {
  passage: 'Final passage',
  nomination: 'Nomination',
  amendment: 'Amendment',
  cloture: 'Cloture',
  procedural: 'Procedural',
  impeachment: 'Impeachment',
};

export const POSITION_LABEL = { Y: 'Yea', N: 'Nay', P: 'Present', '-': 'Not voting' };

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
export const senateClass = (c) => (c ? `Class ${ROMAN[c] || c}` : '');

// ------------------------------------------------------------------ topics
// The topic list comes from the pipeline (meta.json), so Python stays the single source of truth.

let TOPICS = [];
let TOPIC_BY_ID = new Map();

export function setTopics(list) {
  TOPICS = list || [];
  TOPIC_BY_ID = new Map(TOPICS.map((t) => [t.id, t]));
}

export const topicList = () => TOPICS;
export const topicLabel = (id) => TOPIC_BY_ID.get(id)?.label || 'Other';
export const topicHref = (id) => `#/senate/topic/${id}`;

export function topicTag(id, { link = true, title = null } = {}) {
  if (!id) return null;
  const attrs = { class: 'topic-tag', title };
  return link ? h('a', { ...attrs, href: topicHref(id) }, topicLabel(id)) : h('span', attrs, topicLabel(id));
}

/** <select> of topics; counts (Map id -> n) limits the list to topics that have items. */
export function topicSelect(value, onChange, { counts = null, label = 'Topic' } = {}) {
  const sel = h('select', { class: 'select', 'aria-label': label },
    h('option', { value: '' }, 'All topics'),
    TOPICS.filter((t) => !counts || counts.get(t.id))
      .map((t) => h('option', { value: t.id }, counts ? `${t.label} (${counts.get(t.id).toLocaleString('en-US')})` : t.label)));
  sel.value = value || '';
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export function countBy(items, key) {
  const m = new Map();
  for (const item of items) {
    const k = typeof key === 'function' ? key(item) : item[key];
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

// ------------------------------------------------------------------ small components

export function partyDot(party) {
  return h('span', { class: `dot party-${party || 'I'}`, 'aria-hidden': 'true' });
}

/** "D-NY" style tag; the letter always accompanies party color. */
export function partyTag(party, state) {
  return h('span', { class: 'party-tag', title: PARTY_NAME[party] || '' }, state ? `${party}-${state}` : party);
}

function initials(name) {
  const parts = (name || '').replace(/,.*$/, '').split(/\s+/).filter((p) => /^[A-Za-z]/.test(p));
  return ((parts[0]?.[0] || '') + (parts.at(-1)?.[0] || '')).toUpperCase();
}

export function avatar(senator, size = 'sm') {
  const wrap = h('span', { class: `avatar avatar-${size} ring-${senator.party}`, 'aria-hidden': 'true' });
  if (senator.photo) {
    const img = h('img', { src: senator.photo, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      img.remove();
      wrap.textContent = initials(senator.name);
    });
    wrap.append(img);
  } else {
    wrap.textContent = initials(senator.name);
  }
  return wrap;
}

export function senatorHref(id) {
  return `#/senate/senator/${id}`;
}

export function senatorChip(senator) {
  return h('a', { class: 'chip-senator', href: senatorHref(senator.id) },
    avatar(senator, 'xs'), h('span', null, senator.name), partyTag(senator.party, senator.state));
}

export function statusPill(status, law) {
  const info = STATUS[status] || { label: status || 'Unknown' };
  return h('span', { class: `pill status-${status}`, title: law ? `Public law ${law}` : null },
    status === 'law' && law ? `${info.label} · ${law}` : info.label);
}

/** A headline number. Optional: spark (a sparkline node), count (a number to count up to on arrival). */
export function statTile(label, value, sub = null, { spark = null, count = null } = {}) {
  return h('div', { class: 'kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value', 'data-count': count === null ? null : String(count) }, value),
    sub ? h('div', { class: 'sub' }, sub) : null,
    spark ? h('div', { class: 'kpi-spark' }, spark) : null);
}

/** Count [data-count] numbers up from zero (quickly), unless the reader prefers reduced motion. */
export function animateCounts(root, duration = 900) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const el of root.querySelectorAll('[data-count]')) {
    const target = Number(el.dataset.count);
    if (!Number.isFinite(target) || target < 10) continue;
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration);
      el.textContent = Math.round(target * (1 - (1 - p) ** 3)).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick);
    };
    el.textContent = '0';
    requestAnimationFrame(tick);
  }
}

/**
 * A slim Yea/Nay bar for a roll call: Yeas fill from the left and Nays from the right, each split by
 * party color, with a notch at the share needed to win. The breakdown is also in its label.
 */
export function tallyBar(v) {
  const parts = (k) => PARTY_ORDER.map((p) => [p, v.p?.[p]?.[k] || 0]).filter(([, c]) => c > 0);
  const yea = parts(0);
  const nay = parts(1);
  const sum = (xs) => xs.reduce((a, [, c]) => a + c, 0);
  const seats = Math.max(100, sum(yea) + sum(nay));
  const text = (xs) => xs.map(([p, c]) => `${c} ${PARTY_PLURAL[p]}`).join(', ') || 'none';
  const mark = { '3/5': '60%', '2/3': '66.67%' }[v.req] || '50%';
  const side = (xs, cls) => h('span', { class: `tally-side ${cls}`, style: { width: `${(100 * sum(xs)) / seats}%` } },
    xs.map(([p, c]) => h('span', { class: `bg-${p}`, style: { flexGrow: String(c) } })));
  return h('span', {
    class: 'tally-bar', role: 'img', style: { '--mark': mark },
    'aria-label': `Yea ${sum(yea)}: ${text(yea)}. Nay ${sum(nay)}: ${text(nay)}.`,
    title: `Yea ${sum(yea)} (${text(yea)}) · Nay ${sum(nay)} (${text(nay)})`,
  }, side(yea, 'yea'), side(nay, 'nay'));
}

/** Thin segmented bar for a party split, e.g. cosponsors [D, R, I]. Text beside it carries numbers. */
export function partySegBar(counts, { thin = false } = {}) {
  const total = counts.reduce((a, b) => a + b, 0);
  const bar = h('div', { class: `seg-bar${thin ? ' thin' : ''}`, 'aria-hidden': 'true' });
  if (!total) return bar;
  counts.forEach((c, i) => {
    if (c > 0) bar.append(h('span', { class: `bg-${PARTY_ORDER[i]}`, style: { width: `${(100 * c) / total}%` } }));
  });
  return bar;
}

export function partyCountsText(counts) {
  return PARTY_ORDER.map((p, i) => (counts[i] ? `${counts[i]} ${p}` : null)).filter(Boolean).join(' · ');
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading', role: 'status' }, text);
}

export function errorBox(err) {
  return h('div', { class: 'error-box' },
    h('h2', null, 'Could not load this page'),
    h('p', { class: 'ink-2', style: { marginTop: '8px' } }, String(err?.message || err)),
    h('p', { class: 'ink-2', style: { marginTop: '8px' } },
      'If the data has not been built yet, run ', h('code', null, 'python -m pipeline update'),
      ' in the project folder, then reload.'));
}

/** A list that renders `pageSize` items at a time with a "Show more" button. */
export function pagedList(items, render, { pageSize = 40, empty = 'Nothing to show.', className = 'rows' } = {}) {
  const box = h('div', { class: 'paged' });
  if (!items.length) {
    box.append(h('p', { class: 'empty' }, empty));
    return box;
  }
  const list = h('div', { class: className });
  const more = h('button', { class: 'btn more', type: 'button' });
  let shown = 0;
  const next = () => {
    const slice = items.slice(shown, shown + pageSize);
    list.append(...slice.map(render));
    shown += slice.length;
    more.textContent = `Show more (${num(items.length - shown)} remaining)`;
    more.hidden = shown >= items.length;
  };
  more.addEventListener('click', next);
  box.append(list, more);
  next();
  return box;
}

/** Tabs: items = [[key, label, count?]]; calls onSelect(key). */
export function tabBar(items, active, onSelect, label = 'Sections') {
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': label },
    items.map(([key, text, count]) => h('button', {
      class: 'tab', role: 'tab', type: 'button', 'aria-selected': key === active ? 'true' : 'false',
      onclick: () => onSelect(key),
    }, text, count !== undefined && count !== null ? h('span', { class: 'count' }, num(count)) : null)));
}

/** Filter chips (single select): options = [[value, label, count?]]. */
export function chipGroup(options, value, onChange, label) {
  const group = h('div', { class: 'chips', role: 'group', 'aria-label': label });
  for (const [val, text, count] of options) {
    group.append(h('button', {
      class: 'chip', type: 'button', 'aria-pressed': val === value ? 'true' : 'false',
      onclick: () => onChange(val),
    }, text, count !== undefined ? h('span', { class: 'count' }, num(count)) : null));
  }
  return group;
}

export function toggle(labelText, checked, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, labelText);
}

export function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ------------------------------------------------------------------ tooltip

const tip = () => document.getElementById('tooltip');

export function showTip(clientX, clientY, ...content) {
  const el = tip();
  el.replaceChildren(...content.flat().filter(Boolean));
  el.hidden = false;
  moveTip(clientX, clientY);
}

export function moveTip(clientX, clientY) {
  const el = tip();
  if (el.hidden) return;
  const pad = 14;
  const { width, height } = el.getBoundingClientRect();
  let x = clientX + pad;
  let y = clientY + pad;
  if (x + width > window.innerWidth - 8) x = clientX - width - pad;
  if (y + height > window.innerHeight - 8) y = clientY - height - pad;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  tip().hidden = true;
}

// ------------------------------------------------------------------ bills & votes

export function sponsorLine(bill, senators) {
  if (!bill.spn) return null;
  const s = bill.sp && senators?.get(bill.sp);
  const name = s ? h('a', { href: senatorHref(s.id) }, s.name) : bill.spn;
  return h('span', null, 'Sponsor: ', name, ' ', partyTag(bill.spp, bill.sps));
}

export function billRow(bill, senators, { showSponsor = true, extraMeta = null } = {}) {
  const meta = [];
  if (showSponsor && bill.spn) meta.push(sponsorLine(bill, senators));
  meta.push(`Introduced ${fmtDate(bill.intro)}`);
  if (bill.cc) meta.push(`${plural(bill.cc, 'cosponsor')} (${partyCountsText(bill.cp)})`);
  if (extraMeta) meta.push(extraMeta);
  if (bill.tp) meta.push(topicTag(bill.tp, { title: bill.pa ? `Policy area: ${bill.pa}` : null }));
  return h('article', { class: 'row bill-row' },
    h('div', { class: 'row-main' },
      h('a', { class: 'row-title', href: `#/senate/bill/${bill.id}` },
        h('span', { class: 'bill-label' }, bill.label), ' ', bill.title),
      h('div', { class: 'row-meta' }, meta.flatMap((m, i) => (i ? [' · ', m] : [m]))),
      bill.lt ? h('div', { class: 'row-action' }, h('span', { class: 'muted' }, `Latest action ${fmtDate(bill.la)}: `), bill.lt) : null),
    h('div', { class: 'row-side' }, statusPill(bill.st, bill.law)));
}

const OUTCOME_RE = /(Not Agreed to|Agreed to|Rejected|Passed|Confirmed|Defeated|Not Sustained|Sustained|Not Well Taken|Well Taken|Failed|Not Invoked|Invoked|Overridden)\s*$/i;

export function shortResult(result) {
  const m = OUTCOME_RE.exec(result || '');
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : result || '';
}

/** Headline for a roll call: the nominee, the amendment, or the bill it concerns. */
export function voteTitle(v, bills) {
  const bill = v.bill ? bills?.[v.bill] : null;
  const billName = bill ? `${bill.label} — ${bill.title}` : null;
  if (v.cat === 'nomination') return v.desc || v.doc;
  if (v.cat === 'amendment') return `Amendment to ${bill ? bill.label : v.doc}: ${v.desc}`;
  if (billName) return billName;
  return v.desc || v.doc || v.q;
}

export function resultBadge(v) {
  const icon = v.ok === 1 ? '✓ ' : v.ok === 0 ? '✕ ' : '';
  return h('span', { class: 'result' }, icon, shortResult(v.r), h('span', { class: 'tally' }, `${v.t[0]}–${v.t[1]}`));
}

export function positionBadge(code) {
  return h('span', { class: `pos pos-${code}` }, POSITION_LABEL[code] || code);
}

export function partySplit(v) {
  return h('span', { class: 'party-split', 'aria-label': 'Yea–Nay by party' },
    PARTY_ORDER.filter((p) => v.p[p] && v.p[p][0] + v.p[p][1] + v.p[p][2] + v.p[p][3] > 0)
      .map((p) => h('span', null, partyDot(p), `${p} ${v.p[p][0]}–${v.p[p][1]}`)));
}

export function keyFlag(v) {
  if (!v.key) return null;
  return h('span', { class: 'flag key-flag', title: `Key vote: ${v.key.map((k) => KEY_REASON[k] || k).join(', ')}` },
    `★ ${KEY_REASON[v.key[0]] || 'Key vote'}`);
}

export function voteRow(v, bills, { position = null, flags = [] } = {}) {
  const bill = v.bill ? bills?.[v.bill] : null;
  const guide = explainVote(v, bill);
  return h('article', { class: 'row vote-row' },
    h('div', { class: 'row-main' },
      h('a', { class: 'row-title', href: `#/senate/vote/${v.id}` }, voteTitle(v, bills)),
      h('div', { class: 'row-meta' }, `${fmtDate(v.d)} · Roll call ${v.n} · `,
        h('span', { title: `Official question: ${v.q}` }, guide.title)),
      h('div', { class: 'row-viz' }, tallyBar(v), v.tp && v.tp !== 'nominations' ? topicTag(v.tp) : null)),
    h('div', { class: 'row-side' },
      resultBadge(v),
      position ? positionBadge(position) : null,
      position ? h('span', { class: 'meaning' }, positionMeaning(v, position, bill)) : null,
      keyFlag(v),
      flags.map((f) => h('span', { class: 'flag' }, f))));
}
