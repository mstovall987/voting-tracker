// One roll-call vote: result, the split by party, and how every senator voted.

import { senate, senatorsById } from '../data.js';
import {
  h, partyTag, partyDot, fmtDate, num, voteTitle, shortResult, CATEGORY, PARTY_NAME, PARTY_PLURAL,
  PARTY_ORDER, POSITION_LABEL, senatorHref,
} from '../ui.js';
import { tallyChart, legend, tableView } from '../charts.js';
import { explainVote, thresholdText, KEY_REASON } from '../voteguide.js';

const REQUIRED = { '1/2': 'Simple majority', '3/5': 'Three-fifths (60 votes)', '2/3': 'Two-thirds' };

export async function renderVote(id) {
  const [votesData, byId, meta] = await Promise.all([senate.votes(), senatorsById(), senate.meta()]);
  const v = votesData.votes.find((x) => x.id === id);
  if (!v) {
    return h('div', { class: 'error-box' }, h('h2', null, 'Vote not found'),
      h('p', { class: 'ink-2', style: { marginTop: '8px' } }, 'It may be from a different Congress. ', h('a', { href: '#/senate/votes' }, 'See all floor votes →')));
  }
  const [, congress, session, number] = /^s(\d+)-(\d+)-(\d+)$/.exec(id).map(Number);
  const year = Number(meta.congressStart.slice(0, 4)) + session - 1;
  const bill = v.bill ? votesData.bills[v.bill] : null;
  const title = voteTitle(v, votesData.bills);
  document.title = `Roll call ${v.n} (${year}): ${shortResult(v.r)} · Voting Tracker`;
  const official = `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(number).padStart(5, '0')}.htm`;

  // Everyone's position, grouped by how they voted.
  const groups = { Y: [], N: [], P: [], '-': [] };
  votesData.members.forEach((mid, i) => {
    const p = v.pos[i];
    if (!p || p === '.') return;
    const s = byId.get(mid);
    if (!s) return;
    const majority = s.caucus === 'D' ? v.dm : s.caucus === 'R' ? v.rm : null;
    groups[p].push({ s, broke: (p === 'Y' || p === 'N') && majority && p !== majority });
  });
  for (const list of Object.values(groups)) {
    list.sort((a, b) => PARTY_ORDER.indexOf(a.s.party) - PARTY_ORDER.indexOf(b.s.party) || a.s.last.localeCompare(b.s.last));
  }
  const crossers = [...groups.Y, ...groups.N].filter((x) => x.broke);

  const majorityText = (side) => (side === 'Y' ? 'Yea' : side === 'N' ? 'Nay' : 'split evenly');
  let partyLine;
  if (v.pl) partyLine = `Party-line vote: most Democrats voted ${majorityText(v.dm)}, most Republicans voted ${majorityText(v.rm)}.`;
  else if (v.dm && v.dm === v.rm) partyLine = `Bipartisan: most Democrats and most Republicans both voted ${majorityText(v.dm)}.`;
  else partyLine = 'At least one party split evenly.';

  const guide = explainVote(v, bill);
  const facts = [
    ['Result', `${v.r} (${v.t[0]}–${v.t[1]})`],
    ['Needed to pass', REQUIRED[v.req] || v.req || '—'],
    ['Kind of vote', guide.title],
    ['Official question', v.q],
    ['Date', fmtDate(v.d)],
    ['Session', `${year} (session ${session}), roll call ${v.n}`],
  ];
  const guideBox = h('div', { class: 'guide-box' },
    h('div', { class: 'guide-title' }, `What this vote was: ${guide.title}`),
    guide.what ? h('p', null, guide.what) : null,
    guide.yea ? h('p', { class: 'guide-sides' },
      h('span', null, h('strong', null, 'Yea'), ` = voted to ${guide.yea}`),
      h('span', null, h('strong', null, 'Nay'), ` = voted to ${guide.nay}`)) : null,
    h('p', { class: 'note' }, `To win, it needed ${thresholdText(v.req)}.`));
  const sideMeaning = { Y: guide.yea, N: guide.nay };

  const column = (code) => {
    const list = groups[code];
    if (!list.length && (code === 'P' || code === '-')) return null;
    return h('div', null,
      h('h3', null, h('span', null, POSITION_LABEL[code]), h('span', { class: 'muted' }, num(list.length))),
      sideMeaning[code] ? h('div', { class: 'chart-sub' }, `Voted to ${sideMeaning[code]}`) : null,
      h('ul', { class: 'name-list' }, list.map(({ s, broke }) => h('li', null,
        partyDot(s.party), h('a', { href: senatorHref(s.id) }, s.name), partyTag(s.party, s.state),
        broke ? h('span', { class: 'flag', title: 'Voted against most of their party' }, 'crossed party') : null))));
  };

  return h('div', { class: 'stack' },
    h('section', { class: 'stage detail-stage' },
      h('div', { class: 'eyebrow' }, `Senate roll call ${v.n} · ${fmtDate(v.d)}`),
      h('h1', { class: title.length > 90 ? 'title-long' : null }, title),
      h('p', { class: 'ink-2', style: { marginTop: '8px' } }, `${v.q}: `, h('strong', null, v.r), ` (${v.t[0]}–${v.t[1]})`),
      v.key ? h('div', { class: 'tag-list', style: { marginTop: '10px' } },
        v.key.map((k) => h('span', { class: 'flag key-flag' }, `★ Key vote: ${KEY_REASON[k] || k}`))) : null,
      guideBox,
      h('div', { class: 'facts-grid' }, facts.map(([l, val]) => h('div', null, h('div', { class: 'l' }, l), h('div', { class: 'v' }, val)))),
      h('div', { class: 'profile-links' },
        bill ? h('a', { href: `#/senate/bill/${v.bill}` }, `${bill.label}: bill details →`) : null,
        h('a', { href: official, target: '_blank', rel: 'noopener' }, 'Official record on senate.gov'))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'How each party voted'), h('p', null, partyLine))),
      legend([['bg-D', PARTY_PLURAL.D], ['bg-R', PARTY_PLURAL.R], ['bg-I', PARTY_PLURAL.I]]),
      h('div', { style: { marginTop: '10px', maxWidth: '660px' } }, tallyChart(v)),
      tableView(['Party', 'Yea', 'Nay', 'Present', 'Not voting'],
        PARTY_ORDER.filter((p) => v.p[p] && v.p[p].some((n) => n > 0)).map((p) => [PARTY_PLURAL[p], ...v.p[p].map(num)]), 'View as table'),
      crossers.length ? h('p', { class: 'note', style: { marginTop: '10px' } },
        `${crossers.length} senator${crossers.length === 1 ? '' : 's'} voted against most of their party: `,
        crossers.map((x, i) => [i ? ', ' : '', h('a', { href: senatorHref(x.s.id) }, x.s.name), ` (${x.s.party})`])) : null),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'How every senator voted')),
      h('div', { class: 'position-columns' }, ['Y', 'N', 'P', '-'].map(column))));
}
