// Legislation: what was just introduced, what is moving, what became law, and a full search.

import { senate, senatorsById } from '../data.js';
import {
  h, billRow, pagedList, tabBar, chipGroup, debounce, loading, num, plural, STATUS, PARTY_PLURAL,
  topicSelect, topicList, countBy,
} from '../ui.js';

const TABS = [
  ['introduced', 'Newly introduced'],
  ['moving', 'Recent action'],
  ['laws', 'Became law'],
  ['search', 'Search all'],
];
const search = { q: '', topic: '', area: '', status: '', party: 'all' }; // remembered between visits

export async function renderLegislation(tab, query = {}) {
  const active = TABS.some(([k]) => k === tab) ? tab : 'introduced';
  if (query.topic !== undefined) { search.topic = query.topic; search.area = ''; }
  if (query.q !== undefined) search.q = query.q; // from the home page search box
  const [recent, byId, meta] = await Promise.all([senate.recent(), senatorsById(), senate.meta()]);
  document.title = 'Legislation · Voting Tracker';

  const body = h('section', { class: 'card' });
  const tabs = tabBar(TABS.map(([k, label]) => [k, label]), active,
    (k) => { location.hash = `#/senate/legislation/${k}`; }, 'Legislation views');

  if (active === 'introduced') {
    body.append(
      h('p', { class: 'note', style: { marginBottom: '8px' } }, 'The newest Senate bills and resolutions, by date introduced. Most are referred to a committee and go no further; the status shows how far each has gotten.'),
      pagedList(recent.introduced, (b) => billRow(b, byId), { pageSize: 30 }));
  } else if (active === 'moving') {
    body.append(
      h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Measures that have advanced past introduction, ordered by their latest action. Includes House bills the Senate voted on.'),
      pagedList(recent.moving, (b) => billRow(b, byId), { pageSize: 30 }));
  } else if (active === 'laws') {
    body.append(
      h('p', { class: 'note', style: { marginBottom: '8px' } }, `${plural(recent.laws.length, 'measure')} signed into law this Congress that started in the Senate or got a Senate roll-call vote. House bills passed without a Senate roll call will appear once the House is added.`),
      pagedList(recent.laws, (b) => billRow(b, byId), { pageSize: 30 }));
  } else {
    body.append(loading('Loading every bill…'));
    senate.billIndex().then((index) => body.replaceChildren(searchPanel(index, byId))).catch((err) => {
      body.replaceChildren(h('p', { class: 'empty' }, `Could not load the bill index: ${err.message}`));
    });
  }

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, `U.S. Senate · ${meta.congressLabel}`),
        h('h1', null, 'Bills & ', h('em', null, 'resolutions')),
        h('p', { class: 'lede' }, `${num(meta.counts.measures)} Senate bills and resolutions introduced so far this Congress. Data comes from Congress.gov's bill-status records, refreshed several times a day.`))),
    tabs, body);
}

function searchPanel(index, byId) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search by title, number (e.g. S. 5) or sponsor', 'aria-label': 'Search bills', value: search.q });
  const topicPick = topicSelect(search.topic, (t) => { search.topic = t; search.area = ''; fillAreas(); draw(); },
    { counts: countBy(index, 'tp') });
  // Policy areas are the finer-grained official categories inside each topic.
  const areaSel = h('select', { class: 'select', 'aria-label': 'Policy area' });
  function fillAreas() {
    const allowed = search.topic ? new Set(topicList().find((t) => t.id === search.topic)?.areas || []) : null;
    const areas = [...new Set(index.map((b) => b.pa).filter((a) => a && (!allowed || allowed.has(a))))].sort();
    areaSel.replaceChildren(h('option', { value: '' }, search.topic ? 'All policy areas in this topic' : 'All policy areas'),
      ...areas.map((a) => h('option', { value: a }, a)));
    areaSel.value = search.area;
    areaSel.hidden = search.topic && areas.length < 2;
  }
  fillAreas();
  const statusSel = h('select', { class: 'select', 'aria-label': 'Status' },
    h('option', { value: '' }, 'Any status'), Object.entries(STATUS).map(([k, v]) => h('option', { value: k }, v.label)));
  statusSel.value = search.status;
  const partyBox = h('div');
  const count = h('p', { class: 'result-count' });
  const results = h('div');

  function draw() {
    partyBox.replaceChildren(chipGroup([['all', 'Any sponsor'], ['D', PARTY_PLURAL.D], ['R', PARTY_PLURAL.R], ['I', PARTY_PLURAL.I]],
      search.party, (p) => { search.party = p; draw(); }, 'Sponsor party'));
    const q = search.q.trim().toLowerCase();
    const compact = q.replace(/[.\s]/g, '');
    const list = index.filter((b) => (!search.topic || b.tp === search.topic)
      && (!search.area || b.pa === search.area)
      && (!search.status || b.st === search.status)
      && (search.party === 'all' || b.spp === search.party)
      && (!q || b.title.toLowerCase().includes(q) || (b.spn || '').toLowerCase().includes(q)
        || b.label.replace(/[.\s]/g, '').toLowerCase() === compact));
    count.textContent = `${plural(list.length, 'measure')} found`;
    results.replaceChildren(pagedList(list, (b) => billRow(b, byId), { pageSize: 30, empty: 'No bills match. Try fewer words.' }));
  }
  input.addEventListener('input', debounce(() => { search.q = input.value; draw(); }, 200));
  areaSel.addEventListener('change', () => { search.area = areaSel.value; draw(); });
  statusSel.addEventListener('change', () => { search.status = statusSel.value; draw(); });
  draw();
  return h('div', null,
    h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, input), topicPick, areaSel, statusSel),
    h('div', { class: 'toolbar' }, partyBox),
    count, results);
}
