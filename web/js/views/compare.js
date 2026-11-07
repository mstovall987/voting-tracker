// Compare two senators: how often they vote together (overall and by topic), their key votes side
// by side, every vote where they split, and the bills they worked on together.

import { senate, senatorsById, votePositionIndex } from '../data.js';
import {
  h, avatar, partyTag, PARTY_NAME, STATE_NAMES, num, pctText, plural, fmtDate, billRow, voteTitle,
  resultBadge, positionBadge, pagedList, topicLabel, topicSelect, countBy, senatorHref, toggle,
} from '../ui.js';
import { KEY_REASON, explainVote, positionMeaning } from '../voteguide.js';

const isVote = (p) => p === 'Y' || p === 'N';
let baselines = null; // typical same-party / cross-party agreement, computed once

function picker(list, value, other, onChange, label) {
  const byLast = (x, y) => x.last.localeCompare(y.last) || x.name.localeCompare(y.name);
  const option = (s) => h('option', { value: s.id, disabled: s.id === other ? true : null }, `${s.name} (${s.party}-${s.state})`);
  const sel = h('select', { class: 'select', 'aria-label': label },
    h('option', { value: '' }, 'Choose a senator…'),
    h('optgroup', { label: 'Current senators' }, list.filter((s) => s.current).sort(byLast).map(option)),
    h('optgroup', { label: 'Left during this Congress' }, list.filter((s) => !s.current).sort(byLast).map(option)));
  sel.value = value || '';
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function typicalAgreement(votesData, senators, posIndex) {
  if (baselines) return baselines;
  const cur = senators.filter((s) => s.current && (s.caucus === 'D' || s.caucus === 'R'));
  const codes = cur.map((s) => {
    const i = posIndex.get(s.id);
    return Uint8Array.from(votesData.votes, (v) => (v.pos[i] === 'Y' ? 1 : v.pos[i] === 'N' ? 2 : 0));
  });
  const same = [];
  const cross = [];
  for (let x = 0; x < cur.length; x++) {
    for (let y = x + 1; y < cur.length; y++) {
      let both = 0;
      let agree = 0;
      const cx = codes[x];
      const cy = codes[y];
      for (let k = 0; k < cx.length; k++) {
        if (cx[k] && cy[k]) {
          both++;
          if (cx[k] === cy[k]) agree++;
        }
      }
      if (both >= 25) (cur[x].caucus === cur[y].caucus ? same : cross).push((100 * agree) / both);
    }
  }
  const median = (arr) => (arr.length ? arr.sort((p, q) => p - q)[Math.floor(arr.length / 2)] : null);
  baselines = { same: median(same), cross: median(cross) };
  return baselines;
}

function personCard(s) {
  return h('a', { class: 'compare-person', href: senatorHref(s.id) },
    avatar(s, 'md'),
    h('div', null,
      h('div', { class: 'name' }, s.name, ' ', partyTag(s.party, s.state)),
      h('div', { class: 'meta' }, `${PARTY_NAME[s.party]} · ${STATE_NAMES[s.state] || s.state}${s.current ? '' : ` · left ${fmtDate(s.left)}`}`)));
}

function meter(pct) {
  return h('div', { class: 'meter-row' },
    h('div', { class: 'agree-meter', 'aria-hidden': 'true' }, h('span', { style: { width: `${pct}%` } })),
    h('span', { class: 'pct' }, pctText(pct, 0)));
}

function sideBySide(rows, A, B, bills, { emptyText }) {
  return pagedList(rows, ({ v, pa, pb }) => {
    const bill = v.bill ? bills[v.bill] : null;
    const split = isVote(pa) && isVote(pb) && pa !== pb;
    const cell = (p) => h('div', { class: 'cmp-cell' }, positionBadge(p), h('span', { class: 'meaning' }, positionMeaning(v, p, bill)));
    return h('article', { class: `row cmp-row${split ? ' split' : ''}` },
      h('div', { class: 'row-main' },
        h('a', { class: 'row-title', href: `#/senate/vote/${v.id}` }, voteTitle(v, bills)),
        h('div', { class: 'row-meta' }, `${fmtDate(v.d)} · ${explainVote(v, bill).title} · `, resultBadge(v),
          v.key ? ` · ★ ${v.key.map((k) => KEY_REASON[k] || k).join(', ')}` : '')),
      h('div', { class: 'cmp-sides' },
        h('div', null, h('div', { class: 'cmp-who' }, A.last), cell(pa)),
        h('div', null, h('div', { class: 'cmp-who' }, B.last), cell(pb))));
  }, { pageSize: 15, empty: emptyText });
}

async function suggestions(aId, byId, go) {
  const m = await senate.member(aId);
  const A = byId.get(aId);
  const picks = [];
  for (const s of byId.values()) {
    if (s.current && s.state === A.state && s.id !== aId) picks.push([s, `Home-state colleague`]);
  }
  const ally = m.agreement.cross[0] && byId.get(m.agreement.cross[0].id);
  if (ally) picks.push([ally, `Agrees with most often across the aisle (${pctText(m.agreement.cross[0].pct, 0)})`]);
  const rival = m.agreement.ownLow[0] && byId.get(m.agreement.ownLow[0].id);
  if (rival) picks.push([rival, `Least in step within their own side (${pctText(m.agreement.ownLow[0].pct, 0)})`]);
  if (!picks.length) return null;
  return h('div', { class: 'stack', style: { marginTop: '14px' } },
    h('div', { class: 'chart-title' }, `Suggestions for ${A.name}`),
    h('div', { class: 'rank-list' }, picks.map(([s, why]) => h('div', { class: 'item' },
      h('button', { class: 'chip', type: 'button', onclick: () => go(aId, s.id) }, `Compare with ${s.name} (${s.party}-${s.state})`),
      h('span', { class: 'muted' }, why)))));
}

export async function renderCompare(query = {}) {
  const [senators, votesData, byId, posIndex, meta] = await Promise.all([
    senate.senators(), senate.votes(), senatorsById(), votePositionIndex(), senate.meta(),
  ]);
  const a = byId.has(query.a) ? query.a : '';
  const b = byId.has(query.b) && query.b !== a ? query.b : '';
  const go = (na, nb) => {
    const params = new URLSearchParams();
    if (na) params.set('a', na);
    if (nb) params.set('b', nb);
    location.hash = `#/senate/compare?${params}`;
  };
  const pickers = h('div', { class: 'compare-pickers' },
    picker(senators, a, b, (id) => go(id, b), 'First senator'),
    h('span', { class: 'vs' }, 'vs.'),
    picker(senators, b, a, (id) => go(a, id), 'Second senator'),
    a && b ? h('button', { class: 'btn', type: 'button', onclick: () => go(b, a) }, '⇄ Swap') : null);
  const head = h('div', { class: 'page-head' },
    h('div', null,
      h('div', { class: 'eyebrow' }, `U.S. Senate · ${meta.congressLabel}`),
      h('h1', null, 'Compare ', h('em', null, 'senators')),
      h('p', { class: 'lede' }, 'Pick any two senators to see how often they vote together, where they split, and the bills they have worked on together.')));

  if (!a || !b) {
    document.title = 'Compare senators · Voting Tracker';
    const card = h('section', { class: 'card' }, pickers,
      h('p', { class: 'muted', style: { marginTop: '12px' } }, a ? 'Now choose a second senator.' : 'Choose two senators to compare.'));
    if (a) suggestions(a, byId, go).then((node) => node && card.append(node));
    return h('div', null, head, card);
  }

  const A = byId.get(a);
  const B = byId.get(b);
  document.title = `${A.name} vs. ${B.name} · Voting Tracker`;
  const [ma, mb] = await Promise.all([senate.member(a), senate.member(b)]);
  const ia = posIndex.get(a);
  const ib = posIndex.get(b);

  let both = 0;
  let same = 0;
  const topicTally = new Map();
  const splits = [];
  const keyRows = [];
  for (let k = votesData.votes.length - 1; k >= 0; k--) {
    const v = votesData.votes[k];
    const pa = v.pos[ia];
    const pb = v.pos[ib];
    if (v.key && pa && pa !== '.' && pb && pb !== '.') keyRows.push({ v, pa, pb });
    if (!isVote(pa) || !isVote(pb)) continue;
    both++;
    const t = topicTally.get(v.tp) || { n: 0, same: 0 };
    t.n++;
    if (pa === pb) {
      same++;
      t.same++;
    } else {
      splits.push({ v, pa, pb });
    }
    topicTally.set(v.tp, t);
  }
  const agree = both ? (100 * same) / both : null;
  const base = typicalAgreement(votesData, senators, posIndex);

  // ---- headline
  const hero = h('section', { class: 'card compare-hero' },
    personCard(A),
    h('div', { class: 'hero-center' },
      h('div', { class: 'hero-figure' }, agree === null ? '—' : pctText(agree, 0)),
      h('div', { class: 'hero-caption' }, both ? `voted the same way on ${num(same)} of ${num(both)} shared votes` : 'no votes in common')),
    personCard(B));
  const context = both ? h('p', { class: 'note', style: { marginTop: '-4px' } },
    `For context, two senators of the same party typically agree ${pctText(base.same, 0)} of the time, and a Democrat and a Republican ${pctText(base.cross, 0)}. Counted on roll calls where both voted Yea or Nay.`) : null;

  // ---- numbers side by side
  const stat = (label, fa, fb) => h('tr', null, h('td', null, label), h('td', { class: 'num' }, fa), h('td', { class: 'num' }, fb));
  const statsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Side by side')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data static' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'num' }, A.last), h('th', { class: 'num' }, B.last))),
      h('tbody', null,
        stat('Votes missed', pctText(A.stats.missedPct), pctText(B.stats.missedPct)),
        stat('Party unity', pctText(A.stats.unity), pctText(B.stats.unity)),
        stat('Ideology score (−1 liberal, +1 conservative)', A.ideo?.toFixed(2) ?? '—', B.ideo?.toFixed(2) ?? '—'),
        stat('Bills & resolutions sponsored', num(A.stats.sponsored), num(B.stats.sponsored)),
        stat('Cosponsored', num(A.stats.cosponsored), num(B.stats.cosponsored)),
        stat('Became law', num(A.stats.enacted), num(B.stats.enacted)),
        stat('Their bills with a cosponsor from the other party', pctText(A.stats.bipartisanPct, 0), pctText(B.stats.bipartisanPct, 0))))));

  // ---- agreement by topic
  const topicRows = [...topicTally.entries()].filter(([, t]) => t.n >= 3).sort((x, y) => y[1].n - x[1].n);
  const topicsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Agreement by topic'), h('p', null, 'Share of shared votes on each topic where they voted the same way'))),
    topicRows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data static' },
      h('thead', null, h('tr', null, h('th', null, 'Topic'), h('th', { class: 'num' }, 'Shared votes'), h('th', null, 'Agreed'))),
      h('tbody', null, topicRows.map(([tp, t]) => h('tr', null,
        h('td', null, h('a', { href: `#/senate/topic/${tp}` }, topicLabel(tp))),
        h('td', { class: 'num' }, num(t.n)),
        h('td', null, meter((100 * t.same) / t.n)))))))
      : h('p', { class: 'empty' }, 'Not enough shared votes yet.'));

  // ---- key votes side by side
  const keyBox = h('div');
  const keyState = { splitOnly: false };
  const drawKey = () => keyBox.replaceChildren(sideBySide(
    keyState.splitOnly ? keyRows.filter((r) => isVote(r.pa) && isVote(r.pb) && r.pa !== r.pb) : keyRows,
    A, B, votesData.bills, { emptyText: keyState.splitOnly ? 'They voted the same way on every key vote.' : 'No key votes while both served.' }));
  drawKey();
  const keySplits = keyRows.filter((r) => isVote(r.pa) && isVote(r.pb) && r.pa !== r.pb).length;
  const keyCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, '★ Key votes, side by side'),
        h('p', null, `${plural(keyRows.length, 'key vote')} while both served; they split on ${num(keySplits)}.`)),
      toggle('Only where they split', false, (on) => { keyState.splitOnly = on; drawKey(); })),
    keyBox);

  // ---- every split
  const splitBox = h('div');
  const splitState = { topic: '' };
  const drawSplits = () => splitBox.replaceChildren(sideBySide(
    splits.filter((r) => !splitState.topic || r.v.tp === splitState.topic), A, B, votesData.bills,
    { emptyText: 'They never split on a vote with this filter.' }));
  drawSplits();
  const splitsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Every vote where they split'), h('p', null, `${plural(splits.length, 'roll call')}, newest first`)),
      topicSelect('', (tp) => { splitState.topic = tp; drawSplits(); }, { counts: countBy(splits, (r) => r.v.tp) })),
    splitBox);

  // ---- bills they worked on together
  const roleA = new Map();
  ma.sponsored.forEach((x) => roleA.set(x.id, 'sponsor'));
  ma.cosponsored.forEach((x) => { if (!roleA.has(x.id)) roleA.set(x.id, 'cosponsor'); });
  const together = [];
  const seen = new Set();
  for (const [x, role] of [...mb.sponsored.map((x) => [x, 'sponsor']), ...mb.cosponsored.map((x) => [x, 'cosponsor'])]) {
    if (!roleA.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    together.push({ bill: x, ra: roleA.get(x.id), rb: role });
  }
  together.sort((p, q) => (q.bill.intro || '').localeCompare(p.bill.intro || ''));
  const wrote = together.filter((t) => t.ra === 'sponsor' || t.rb === 'sponsor').length;
  const billsCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Bills they worked on together'),
        h('p', null, together.length ? `${plural(together.length, 'bill or resolution', 'bills and resolutions')} both signed, ${num(wrote)} of them written by one of the two` : 'None so far this Congress.'))),
    together.length ? pagedList(together, (t) => billRow(t.bill, byId, { extraMeta: `${A.last}: ${t.ra} · ${B.last}: ${t.rb}` }), { pageSize: 10 }) : null);

  return h('div', { class: 'stack' },
    head,
    h('section', { class: 'card' }, pickers),
    hero,
    context,
    h('div', { class: 'grid-2-even' }, statsCard, topicsCard),
    keyCard,
    splitsCard,
    billsCard);
}
