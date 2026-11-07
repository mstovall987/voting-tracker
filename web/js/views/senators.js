// All senators: a sortable comparison table.

import { senate } from '../data.js';
import { h, avatar, partyTag, STATE_NAMES, num, pctText, year, chipGroup, toggle, senatorHref, PARTY_PLURAL } from '../ui.js';

const view = { q: '', party: 'all', former: false, sort: 'state', dir: 1 };

const COLUMNS = [
  { key: 'name', label: 'Senator', get: (x) => `${x.last} ${x.name}` },
  { key: 'state', label: 'State', get: (x) => `${STATE_NAMES[x.state] || x.state} ${x.rank === 'senior' ? 0 : 1}` },
  { key: 'since', label: 'Since', get: (x) => x.since, num: true, fmt: (x) => year(x.since) },
  { key: 'missedPct', label: 'Missed votes', get: (x) => x.stats.missedPct, num: true, fmt: (x) => pctText(x.stats.missedPct), dir: -1 },
  { key: 'unity', label: 'Party unity', get: (x) => x.stats.unity, num: true, fmt: (x) => pctText(x.stats.unity), dir: -1 },
  { key: 'sponsored', label: 'Sponsored', get: (x) => x.stats.sponsored, num: true, fmt: (x) => num(x.stats.sponsored), dir: -1 },
  { key: 'cosponsored', label: 'Cosponsored', get: (x) => x.stats.cosponsored, num: true, fmt: (x) => num(x.stats.cosponsored), dir: -1 },
  { key: 'enacted', label: 'Became law', get: (x) => x.stats.enacted, num: true, fmt: (x) => num(x.stats.enacted), dir: -1 },
  { key: 'bipartisanPct', label: 'Bipartisan bills', get: (x) => x.stats.bipartisanPct, num: true, fmt: (x) => pctText(x.stats.bipartisanPct), dir: -1 },
];

export async function renderSenators() {
  const [senators, meta] = await Promise.all([senate.senators(), senate.meta()]);
  document.title = 'All senators · Voting Tracker';
  const root = h('div');
  const tableBox = h('div', { class: 'table-wrap' });
  const countLine = h('p', { class: 'result-count' });

  function rows() {
    const q = view.q.trim().toLowerCase();
    const col = COLUMNS.find((c) => c.key === view.sort) || COLUMNS[1];
    return senators
      .filter((x) => (view.former || x.current)
        && (view.party === 'all' || x.party === view.party)
        && (!q || `${x.name} ${x.state} ${STATE_NAMES[x.state]}`.toLowerCase().includes(q)))
      .sort((a, b) => {
        const va = col.get(a);
        const vb = col.get(b);
        if (va === vb) return a.last.localeCompare(b.last);
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (va < vb ? -1 : 1) * view.dir;
      });
  }

  function draw() {
    const list = rows();
    countLine.textContent = `${list.length} senator${list.length === 1 ? '' : 's'}`;
    const head = h('tr', null, COLUMNS.map((c) => {
      const active = c.key === view.sort;
      return h('th', { class: c.num ? 'num' : null, 'aria-sort': active ? (view.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', {
          type: 'button',
          onclick: () => {
            if (view.sort === c.key) view.dir *= -1;
            else { view.sort = c.key; view.dir = c.dir || 1; }
            draw();
          },
        }, c.label, h('span', { class: 'arrow', 'aria-hidden': 'true' }, active ? (view.dir > 0 ? '▲' : '▼') : '')));
    }));
    const body = h('tbody', null, list.map((x) => h('tr', { onclick: (e) => { if (!e.target.closest('a')) location.hash = senatorHref(x.id); } },
      h('td', null, h('div', { class: 'cell-senator' }, avatar(x, 'sm'),
        h('div', null,
          h('a', { href: senatorHref(x.id) }, x.name),
          h('div', { class: 'muted', style: { fontSize: '12.5px' } }, partyTag(x.party, x.state),
            x.current ? null : h('span', { class: 'former-tag' }, `left ${year(x.left)}`))))),
      h('td', null, STATE_NAMES[x.state] || x.state),
      COLUMNS.slice(2).map((c) => h('td', { class: 'num' }, c.fmt(x))))));
    tableBox.replaceChildren(h('table', { class: 'data' }, h('thead', null, head), body));
  }

  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name or state', 'aria-label': 'Search senators', value: view.q });
  search.addEventListener('input', () => { view.q = search.value; draw(); });
  const partyChips = () => chipGroup(
    [['all', 'All'], ['D', PARTY_PLURAL.D], ['R', PARTY_PLURAL.R], ['I', PARTY_PLURAL.I]],
    view.party, (p) => { view.party = p; chipsBox.replaceChildren(partyChips()); draw(); }, 'Party');
  const chipsBox = h('div', null, partyChips());

  const med = meta.medians;
  root.append(
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, `U.S. Senate · ${meta.congressLabel}`),
        h('h1', null, 'All ', h('em', null, 'senators')),
        h('p', { class: 'lede' }, `Compare attendance, party loyalty and lawmaking. Senate medians: ${pctText(med.missedPct)} of votes missed, ${pctText(med.unity)} party unity, ${num(med.sponsored)} bills and resolutions sponsored.`))),
    h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('div', { class: 'grow' }, search),
        chipsBox,
        toggle('Include senators who left this Congress', view.former, (on) => { view.former = on; draw(); })),
      countLine,
      tableBox),
    h('section', { class: 'card' },
      h('h2', null, 'What these numbers mean'),
      h('div', { class: 'grid-2-even', style: { marginTop: '12px' } },
        h('div', { class: 'stack note' },
          h('p', null, h('strong', null, 'Missed votes: '), 'share of roll-call votes held while the senator was in office that they did not vote on.'),
          h('p', null, h('strong', null, 'Party unity: '), 'on party-line votes (most Democrats and most Republicans on opposite sides), how often the senator sided with their own party. Independents are compared with the party they caucus with.')),
        h('div', { class: 'stack note' },
          h('p', null, h('strong', null, 'Sponsored / cosponsored: '), 'Senate bills and resolutions the senator introduced, or formally signed on to, this Congress.'),
          h('p', null, h('strong', null, 'Bipartisan bills: '), 'share of the senator’s sponsored measures with at least one cosponsor from the other party.')))));
  draw();
  return root;
}
