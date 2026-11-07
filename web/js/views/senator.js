// One senator: who they are, how they vote (and how that changes over time), what they propose.

import { senate, senatorsById, votePositionIndex } from '../data.js';
import {
  h, avatar, partyTag, PARTY_NAME, PARTY_PLURAL, STATE_NAMES, CATEGORY, STATUS, fmtDate, fmtMonth, num,
  pctText, plural, statTile, billRow, voteRow, pagedList, tabBar, chipGroup, debounce, senatorHref,
  senateClass, partyDot, partySegBar, topicSelect, topicLabel, topicHref, countBy, voteTitle, resultBadge,
  positionBadge,
} from '../ui.js';
import { lineChart, columnChart, ideologyStrip, rankedBars, legend, tableView, sparkline } from '../charts.js';
import { KEY_REASON, explainVote, positionMeaning } from '../voteguide.js';
import { termText } from './home.js';

const MIN_PARTY_LINE_VOTES = 3; // months with fewer party-line votes are left as gaps

function pct(a, b) {
  return b ? Math.round((1000 * a) / b) / 10 : null;
}

function header(m, meta) {
  const facts = [
    `${m.how === 'appointment' ? 'Appointed' : 'In the Senate since'} ${fmtDate(m.since)}`,
    m.current ? termText(m)[0].toUpperCase() + termText(m).slice(1) : `Left office ${fmtDate(m.left)}`,
    m.phone ? `Phone ${m.phone}` : null,
    m.office,
  ].filter(Boolean);
  const earlier = m.career.filter((c) => !(c.chamber === 'senate' && c.start <= m.since && (!c.end || c.end > m.since)));
  const rank = m.rank ? `${m.rank[0].toUpperCase()}${m.rank.slice(1)} senator` : null;
  const external = (label, url, cls = 'btn') => h('a', { class: cls, href: url, target: '_blank', rel: 'noopener' }, label, ' ↗');
  return h('section', { class: `stage profile-stage tint-${m.party}` },
    m.current ? null : h('div', { class: 'banner' }, `${m.name} left the Senate on ${fmtDate(m.left)}. Their record below covers the time they served in this Congress.`),
    h('div', { class: 'profile-head' },
      avatar(m, 'xl'),
      h('div', null,
        h('div', { class: 'eyebrow' }, `U.S. Senator · ${STATE_NAMES[m.state]}`),
        h('h1', null, m.name),
        h('div', { class: 'profile-tags' },
          h('span', { class: 'party-chip' }, partyDot(m.party),
            PARTY_NAME[m.party] + (m.party === 'I' && m.caucus === 'D' ? ' · caucuses with Democrats' : '')),
          rank ? h('span', { class: 'meta-chip' }, rank) : null,
          m.cls ? h('span', { class: 'meta-chip' }, senateClass(m.cls)) : null),
        h('div', { class: 'facts' }, facts.map((f) => h('span', null, f))),
        earlier.length ? h('div', { class: 'facts' }, h('span', null, 'Earlier: ',
          earlier.map((c, i) => `${i ? '; ' : ''}${c.chamber === 'house' ? `U.S. House (${c.state} ${c.district ? `district ${c.district}` : 'at-large'})` : `U.S. Senate (${c.state})`} ${c.start.slice(0, 4)}–${c.end ? c.end.slice(0, 4) : 'now'}`).join(''))) : null,
        h('div', { class: 'profile-actions' },
          m.url ? external('Official website', m.url, 'btn btn-primary') : null,
          m.contact ? external('Contact their office', m.contact) : null,
          h('a', { class: 'btn', href: `#/senate/compare?a=${m.id}` }, 'Compare with another senator →')),
        h('div', { class: 'profile-links' }, Object.entries(m.links).map(([label, url]) =>
          h('a', { href: url, target: '_blank', rel: 'noopener' }, label))))),
    kpiRow(m, meta));
}

/** Each senator's position on the votes flagged as key, newest first. */
function keyVoteRows(m, votesData, idx) {
  const rows = [];
  for (let k = votesData.votes.length - 1; k >= 0; k--) {
    const v = votesData.votes[k];
    const p = v.pos[idx];
    if (!v.key || !p || p === '.') continue;
    const majority = m.caucus === 'D' ? v.dm : m.caucus === 'R' ? v.rm : null;
    rows.push({ v, p, broke: (p === 'Y' || p === 'N') && Boolean(majority) && p !== majority });
  }
  return rows;
}

function keyVotesCard(m, votesData, idx, onShowAll) {
  const rows = keyVoteRows(m, votesData, idx);
  if (!rows.length) return null;
  const broke = rows.filter((r) => r.broke).length;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'How they voted on key votes'),
        h('p', null, `${plural(rows.length, 'key vote')} while in office: laws, budget fights, cabinet confirmations, close calls and war powers. ${broke ? `Voted against most of their party on ${broke}.` : 'Voted with their party on all of them.'}`)),
      rows.length > 8 ? h('button', { class: 'btn', type: 'button', onclick: onShowAll }, `See all ${rows.length} →`) : null),
    h('div', { class: 'rows' }, rows.slice(0, 8).map(({ v, p, broke: crossed }) => {
      const bill = v.bill ? votesData.bills[v.bill] : null;
      return h('article', { class: 'row key-row' },
        h('div', { class: 'row-main' },
          h('a', { class: 'row-title', href: `#/senate/vote/${v.id}` }, voteTitle(v, votesData.bills)),
          h('div', { class: 'row-meta' }, `${fmtDate(v.d)} · ${explainVote(v, bill).title} · `, resultBadge(v),
            ` · ★ ${v.key.map((k) => KEY_REASON[k] || k).join(', ')}`)),
        h('div', { class: 'row-side' },
          h('span', { class: 'meaning strong' }, positionMeaning(v, p, bill)),
          positionBadge(p),
          crossed ? h('span', { class: 'flag' }, 'Broke with party') : null));
    })));
}

function kpiRow(m, meta) {
  const st = m.stats;
  const med = meta.medians;
  const months = m.monthly.map((x) => x.m);
  const series = (fn) => m.monthly.map(fn);
  const spark = (fn, opts) => sparkline(series(fn), months, opts);
  return h('div', { class: 'kpis' },
    statTile('Votes cast', num(st.eligible - st.missed), `of ${num(st.eligible)} roll calls while in office`,
      { spark: spark((x) => x.e - x.mv) }),
    statTile('Missed votes', pctText(st.missedPct), `${num(st.missed)} missed · Senate median ${pctText(med.missedPct)}`,
      { spark: spark((x) => x.mv) }),
    statTile('Party unity', pctText(st.unity), `on ${num(st.partyLineVotes)} party-line votes · median ${pctText(med.unity)}`,
      { spark: spark((x) => (x.uv >= MIN_PARTY_LINE_VOTES ? pct(x.uw, x.uv) : null), { kind: 'line', format: (v) => pctText(v) }) }),
    statTile('Bills & resolutions sponsored', num(st.sponsored), `${num(st.sponsoredBills)} bills · ${num(st.sponsoredRes)} resolutions · median ${num(med.sponsored)}`,
      { spark: spark((x) => x.sp) }),
    statTile('Cosponsored', num(st.cosponsored), st.crossCosponsorPct === null ? 'none yet' : `${pctText(st.crossCosponsorPct, 0)} written by the other party`,
      { spark: spark((x) => x.co) }),
    statTile('Became law', num(st.enacted), `${num(st.passedSenate)} of their bills passed the Senate`));
}

let spy = null; // highlights the on-this-page button for the section being read

function pageNav(sections) {
  const nav = h('nav', { class: 'page-nav', 'aria-label': 'On this page' }, sections.map(([id, label, el]) =>
    h('button', { type: 'button', 'data-target': id, onclick: () => el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, label)));
  spy?.disconnect();
  spy = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.target === entry.target.id);
    }
  }, { rootMargin: '-30% 0px -65% 0px' });
  for (const [id, , el] of sections) {
    el.id = id;
    el.classList.add('anchor-section');
    spy.observe(el);
  }
  return nav;
}

function standByTopic(m, onPick) {
  const caucus = m.caucus === 'D' || m.caucus === 'R' ? m.caucus : null;
  const other = caucus === 'R' ? 'D' : 'R';
  const rows = m.topics.filter((t) => t.pl > 0 || t.sp > 0 || t.co > 0);
  const ownName = m.party === 'I' ? 'the Democratic caucus' : PARTY_PLURAL[caucus];
  const sideText = (t) => {
    if (!caucus) return `${t.withD} with Democrats, ${t.withR} with Republicans`;
    const cross = caucus === 'D' ? t.withR : t.withD;
    return cross ? `${cross} of ${t.pl} with ${PARTY_PLURAL[other]}` : `All ${t.pl} with ${ownName}`;
  };
  const table = h('div', { class: 'table-wrap' }, h('table', { class: 'data stance-table' },
    h('thead', null, h('tr', null,
      h('th', null, 'Topic'),
      h('th', null, 'Side taken on party-line votes'),
      h('th', { class: 'num' }, 'Their bills'))),
    h('tbody', null, rows.map((t) => h('tr', { onclick: () => onPick(t.id), title: `Show ${m.name}'s ${topicLabel(t.id)} votes below` },
      h('td', null,
        h('button', { type: 'button', class: 'topic-btn' }, topicLabel(t.id)),
        h('div', { class: 'cell-sub' }, t.pl ? plural(t.pl, 'party-line vote')
          : t.votes ? `${plural(t.votes, 'vote')}, none party-line` : 'No roll-call votes')),
      h('td', null, t.pl
        ? h('div', { class: 'side-cell' }, partySegBar([t.withD, t.withR, 0], { thin: true }), h('span', null, sideText(t)))
        : h('span', { class: 'muted' }, '—')),
      h('td', { class: 'num' },
        h('div', null, `${num(t.sp)} sponsored`),
        h('div', { class: 'cell-sub' }, `${num(t.co)} cosponsored`)))))));
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Where they stand, topic by topic'),
      h('p', null, 'A summary written from the numbers on this page, then the detail for each topic.'))),
    h('div', { class: 'summary-lines' }, m.summary.map((line) => h('p', null, line))),
    rows.length ? h('div', { style: { marginTop: '14px' } },
      h('div', { class: 'toolbar', style: { justifyContent: 'space-between', marginBottom: '6px' } },
        legend([['bg-D', 'Sided with most Democrats'], ['bg-R', 'Sided with most Republicans']]),
        h('span', { class: 'note' }, 'Click a topic to see those votes in the full record')),
      table) : null,
    h('p', { class: 'note', style: { marginTop: '12px' } },
      'Why not simply "for" or "against" each topic? Bills on the same topic often pull in opposite directions: one expands a program, the next cuts it. So a Yea vote is not support for a subject. Instead this shows which side the senator took when the two parties split, and what they choose to write and sign on to.'));
}

function votingOverTime(m, meta) {
  const months = m.monthly.map((x) => x.m);
  const unity = m.monthly.map((x) => (x.uv >= MIN_PARTY_LINE_VOTES ? pct(x.uw, x.uv) : null));
  const caucus = m.caucus === 'R' ? 'R' : 'D';
  const caucusLine = meta.months.map((mo, i) => ({ mo, v: meta.caucusUnity[caucus][i] }));
  const caucusValues = months.map((mo) => caucusLine.find((c) => c.mo === mo)?.v ?? null);
  const shown = [...unity, ...caucusValues].filter((v) => v !== null);
  const yMin = shown.length ? Math.max(0, Math.min(80, Math.floor(Math.min(...shown) / 10) * 10)) : 50;
  const partyName = PARTY_PLURAL[caucus];

  const unityChart = lineChart({
    labels: months,
    series: [
      { name: `All ${partyName}`, values: caucusValues, stroke: 'stroke-context', fill: 'fill-context', cssVar: 'context' },
      { name: m.name, values: unity, stroke: `stroke-${m.party}`, fill: `fill-${m.party}`, cssVar: `party-${m.party}`, emphasis: true },
    ],
    yMin, yMax: 100,
    ariaLabel: `${m.name}'s party unity by month compared with all ${partyName}`,
    noteFor: (i) => `${plural(m.monthly[i].uv, 'party-line vote')} this month`,
  });

  const missed = m.monthly.map((x) => x.mv);
  const missedChart = columnChart({
    labels: months, values: missed, fill: `fill-${m.party}`,
    ariaLabel: `Votes missed per month by ${m.name}`,
    tipFor: (i) => [
      h('div', { class: 'tt-title' }, fmtMonth(months[i])),
      h('div', { class: 'tt-row' }, h('span', { class: 'v' }, num(missed[i])), h('span', { class: 'n' }, `missed of ${num(m.monthly[i].e)} votes`))],
  });

  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'How they vote, over time'),
        h('p', null, 'Party-line votes are roll calls where most Democrats and most Republicans took opposite sides.'))),
    h('div', { class: 'grid-2' },
      h('div', null,
        h('div', { class: 'chart-title' }, 'Party unity by month'),
        h('div', { class: 'chart-sub' }, `Share of party-line votes where ${m.name} sided with ${m.party === 'I' ? `the ${partyName}` : 'their party'}`),
        legend([[`bg-${m.party}`, m.name, 'line-key'], ['bg-context', `All ${partyName}`, 'line-key']]),
        unityChart,
        tableView(['Month', m.name, `All ${partyName}`, 'Party-line votes'],
          months.map((mo, i) => [fmtMonth(mo), pctText(unity[i]), pctText(caucusValues[i]), num(m.monthly[i].uv)]))),
      h('div', null,
        h('div', { class: 'chart-title' }, 'Votes missed per month'),
        h('div', { class: 'chart-sub' }, `${pctText(m.stats.missedPct)} of all votes this Congress`),
        missedChart,
        tableView(['Month', 'Missed', 'Roll calls'], months.map((mo, i) => [fmtMonth(mo), num(missed[i]), num(m.monthly[i].e)])))));
}

function whereTheyFit(m, senators) {
  const byId = new Map(senators.map((x) => [x.id, x]));
  const points = senators.filter((x) => x.current && x.ideo !== null && x.ideo !== undefined)
    .map((x) => ({ id: x.id, name: x.name, party: x.party, state: x.state, x: x.ideo }));
  if (!m.current && m.ideo !== null && m.ideo !== undefined) points.push({ id: m.id, name: m.name, party: m.party, state: m.state, x: m.ideo });

  const agreeList = (rows) => (rows.length ? h('div', { class: 'agree-list' }, rows.map((r) => {
    const o = byId.get(r.id);
    if (!o) return null;
    return h('div', { class: 'agree-item' },
      avatar(o, 'xs'),
      h('div', null,
        h('a', { href: senatorHref(o.id) }, o.name), ' ', partyTag(o.party, o.state),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, h('span', { class: `bg-${o.party}`, style: { width: `${r.pct}%` } }))),
      h('span', { class: 'pct', title: `Agreed on ${r.pct}% of ${num(r.n)} shared votes` }, pctText(r.pct, 0)));
  })) : h('p', { class: 'empty' }, 'Not enough shared votes yet.'));

  const otherSide = m.caucus === 'R' ? PARTY_PLURAL.D : PARTY_PLURAL.R;
  const ownSide = m.caucus === 'R' ? PARTY_PLURAL.R : PARTY_PLURAL.D;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Where they fit in the Senate'),
        h('p', null, 'Ideology scores (DW-NOMINATE, from Voteview) place every senator on one scale using all of their roll-call votes.'))),
    m.ideo === null || m.ideo === undefined ? h('p', { class: 'empty' }, 'Not enough votes yet for an ideology score.') :
      h('div', null,
        legend([['bg-D', 'Democrat'], ['bg-R', 'Republican'], ['bg-I', 'Independent']]),
        ideologyStrip(points, m.id, { onPick: (id) => { location.hash = senatorHref(id); } }),
        tableView(['Senator', 'Score'], [...points].sort((a, b) => a.x - b.x).map((p) => [`${p.name} (${p.party}-${p.state})`, p.x.toFixed(3)]), 'View scores as table')),
    h('div', { class: 'grid-2-even', style: { marginTop: '18px' } },
      h('div', null,
        h('div', { class: 'chart-title' }, `Votes most often with ${otherSide}`),
        h('div', { class: 'chart-sub' }, 'Share of votes where both took the same side'),
        agreeList(m.agreement.cross)),
      h('div', null,
        h('div', { class: 'chart-title' }, 'Least in step with their own side'),
        h('div', { class: 'chart-sub' }, `Lowest agreement among senators who caucus with the ${ownSide}`),
        agreeList(m.agreement.ownLow))));
}

function legislationActivity(m) {
  const months = m.monthly.map((x) => x.m);
  const sp = m.monthly.map((x) => x.sp);
  const co = m.monthly.map((x) => x.co);
  const tip = (values, noun) => (i) => [
    h('div', { class: 'tt-title' }, fmtMonth(months[i])),
    h('div', { class: 'tt-row' }, h('span', { class: 'v' }, num(values[i])), h('span', { class: 'n' }, noun))];
  const areas = m.topics.filter((t) => t.sp > 0).sort((a, b) => b.sp - a.sp).slice(0, 8).map((t) => [topicLabel(t.id), t.sp]);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'What they propose'),
        h('p', null, 'Bills and resolutions introduced (sponsored) or formally backed (cosponsored), by month.'))),
    h('div', { class: 'multiples' },
      h('div', null,
        h('div', { class: 'chart-title' }, 'Sponsored per month'),
        h('div', { class: 'chart-sub' }, `${num(m.stats.sponsored)} total`),
        columnChart({ labels: months, values: sp, fill: `fill-${m.party}`, ariaLabel: 'Measures sponsored per month', tipFor: tip(sp, 'sponsored') })),
      h('div', null,
        h('div', { class: 'chart-title' }, 'Cosponsored per month'),
        h('div', { class: 'chart-sub' }, `${num(m.stats.cosponsored)} total`),
        columnChart({ labels: months, values: co, fill: `fill-${m.party}`, ariaLabel: 'Measures cosponsored per month', tipFor: tip(co, 'cosponsored') })),
      h('div', null,
        h('div', { class: 'chart-title' }, 'Top topics they sponsor'),
        h('div', { class: 'chart-sub' }, 'Based on the policy area the Library of Congress assigns each bill'),
        areas.length ? rankedBars(areas, { fill: `bg-${m.party}` }) : h('p', { class: 'empty' }, 'No sponsored measures yet.'))),
    tableView(['Month', 'Sponsored', 'Cosponsored'], months.map((mo, i) => [fmtMonth(mo), num(sp[i]), num(co[i])])));
}

function committeesCard(m) {
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Committees')),
    m.committees.length ? h('div', { class: 'committees' }, m.committees.map((c) => h('div', { class: 'committee' },
      h('div', null, h('span', { class: 'name' }, c.name), c.title ? h('span', { class: 'title' }, c.title) : null),
      c.subs.length ? h('div', { class: 'subs' }, `Subcommittees: ${c.subs.map((x) => (x.title ? `${x.name} (${x.title})` : x.name)).join('; ')}`) : null)))
      : h('p', { class: 'empty' }, m.current ? 'No committee assignments listed yet.' : 'Committee assignments are shown for current senators only.'));
}

// ------------------------------------------------------------------ record tabs

function votesTab(m, votesData, idx) {
  const caucus = m.caucus;
  const rows = [];
  for (let k = votesData.votes.length - 1; k >= 0; k--) {
    const v = votesData.votes[k];
    const p = v.pos[idx];
    if (!p || p === '.') continue;
    const majority = caucus === 'D' ? v.dm : caucus === 'R' ? v.rm : null;
    rows.push({ v, p, broke: (p === 'Y' || p === 'N') && Boolean(majority) && p !== majority });
  }
  const state = { cat: 'all', show: 'all', q: '', topic: '' };
  const box = h('div');
  const listBox = h('div');
  const count = h('p', { class: 'result-count' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search votes (bill, nominee, words)', 'aria-label': 'Search votes' });
  search.addEventListener('input', debounce(() => { state.q = search.value.trim().toLowerCase(); draw(); }));
  const catBox = h('div');
  const showBox = h('div');
  const topicBox = h('div');
  const topicCounts = countBy(rows, (r) => r.v.tp);
  const cats = Object.keys(CATEGORY).filter((c) => rows.some((r) => r.v.cat === c));

  function draw() {
    topicBox.replaceChildren(topicSelect(state.topic, (t) => { state.topic = t; draw(); }, { counts: topicCounts }));
    catBox.replaceChildren(chipGroup([['all', 'All', rows.length], ...cats.map((c) => [c, CATEGORY[c], rows.filter((r) => r.v.cat === c).length])],
      state.cat, (c) => { state.cat = c; draw(); }, 'Vote type'));
    showBox.replaceChildren(chipGroup([
      ['all', 'Every vote'],
      ['key', '★ Key votes', rows.filter((r) => r.v.key).length],
      ['broke', 'Broke with party', rows.filter((r) => r.broke).length],
      ['missed', 'Missed', rows.filter((r) => r.p === '-').length]],
    state.show, (x) => { state.show = x; draw(); }, 'Show'));
    const list = rows.filter((r) => (state.cat === 'all' || r.v.cat === state.cat)
      && (!state.topic || r.v.tp === state.topic)
      && (state.show === 'all' || (state.show === 'key' ? Boolean(r.v.key) : state.show === 'broke' ? r.broke : r.p === '-'))
      && (!state.q || `${r.v.desc} ${r.v.q} ${r.v.doc} ${votesData.bills[r.v.bill]?.title || ''}`.toLowerCase().includes(state.q)));
    count.textContent = `${plural(list.length, 'vote')}${state.topic ? ` on ${topicLabel(state.topic).toLowerCase()}` : ''}${state.show === 'broke' ? ' where they voted against most of their party' : ''}`;
    listBox.replaceChildren(pagedList(list, (r) => voteRow(r.v, votesData.bills, { position: r.p, flags: r.broke ? ['Broke with party'] : [] }),
      { empty: 'No votes match these filters.' }));
  }
  box.append(h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search), topicBox, showBox), h('div', { class: 'toolbar' }, catBox), count, listBox);
  draw();
  box.setTopic = (topic) => { state.topic = topic; state.cat = 'all'; state.show = 'all'; draw(); };
  box.setShow = (show) => { state.show = show; state.topic = ''; state.cat = 'all'; draw(); };
  return box;
}

const STATUS_FILTERS = [
  ['all', 'All'],
  ['law', 'Became law', (b) => b.st === 'law'],
  ['passed', 'Passed the Senate', (b) => ['passed_senate', 'passed_both', 'to_president', 'vetoed', 'agreed_to'].includes(b.st)],
  ['reported', 'Out of committee', (b) => b.st === 'reported'],
  ['introduced', 'Introduced only', (b) => b.st === 'introduced'],
];

function billsTab(bills, byId, { cosponsored = false } = {}) {
  const state = { status: 'all', q: '', topic: '' };
  const box = h('div');
  const listBox = h('div');
  const chipsBox = h('div');
  const topicBox = h('div');
  const topicCounts = countBy(bills, 'tp');
  const count = h('p', { class: 'result-count' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search titles', 'aria-label': 'Search bills' });
  search.addEventListener('input', debounce(() => { state.q = search.value.trim().toLowerCase(); draw(); }));
  function draw() {
    topicBox.replaceChildren(topicSelect(state.topic, (t) => { state.topic = t; draw(); }, { counts: topicCounts }));
    const opts = STATUS_FILTERS.map(([key, label, test]) => [key, label, test ? bills.filter(test).length : bills.length])
      .filter(([key, , n]) => key === 'all' || n > 0);
    chipsBox.replaceChildren(chipGroup(opts, state.status, (x) => { state.status = x; draw(); }, 'Status'));
    const test = STATUS_FILTERS.find(([key]) => key === state.status)?.[2];
    const list = bills.filter((b) => (!test || test(b)) && (!state.topic || b.tp === state.topic)
      && (!state.q || `${b.label} ${b.title} ${b.pa || ''}`.toLowerCase().includes(state.q)));
    count.textContent = plural(list.length, 'measure');
    listBox.replaceChildren(pagedList(list, (b) => billRow(b, byId, {
      showSponsor: cosponsored,
      extraMeta: cosponsored ? `Cosponsored ${fmtDate(b.cd)}${b.orig ? ' (original cosponsor)' : ''}` : null,
    }), { empty: 'Nothing matches.' }));
  }
  box.append(h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, search), topicBox), h('div', { class: 'toolbar' }, chipsBox), count, listBox);
  draw();
  return box;
}

// ------------------------------------------------------------------ page

export async function renderSenator(id) {
  const [m, meta, votesData, byId, posIndex, senators] = await Promise.all([
    senate.member(id), senate.meta(), senate.votes(), senatorsById(), votePositionIndex(), senate.senators(),
  ]);
  document.title = `${m.name} (${m.party}-${m.state}) · Voting Tracker`;
  const idx = posIndex.get(id);

  const tabsBox = h('div');
  const tabBody = h('div');
  let active = 'votes';
  const TABS = [
    ['votes', 'Voting record', m.stats.eligible],
    ['sponsored', 'Sponsored', m.sponsored.length],
    ['cosponsored', 'Cosponsored', m.cosponsored.length],
  ];
  const built = {};
  function showTab(key) {
    active = key;
    tabsBox.replaceChildren(tabBar(TABS, active, showTab, 'Record'));
    if (!built[key]) {
      built[key] = key === 'votes' ? votesTab(m, votesData, idx)
        : key === 'sponsored' ? billsTab(m.sponsored, byId)
          : billsTab(m.cosponsored, byId, { cosponsored: true });
    }
    tabBody.replaceChildren(built[key]);
  }
  showTab(active);

  const recordCard = h('section', { class: 'card', id: 'record' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Full record'),
      h('p', null, 'Every roll-call vote and every bill, newest first. Filter by topic, or to votes against their party or missed votes.'))),
    tabsBox, tabBody);
  const pickTopic = (topic) => { // from the topic table: show that topic's votes in the record
    showTab('votes');
    built.votes.setTopic(topic);
    recordCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const showKeyVotes = () => {
    showTab('votes');
    built.votes.setShow('key');
    recordCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const keyCard = keyVotesCard(m, votesData, idx, showKeyVotes);
  const standCard = standByTopic(m, pickTopic);
  const timeCard = votingOverTime(m, meta);
  const fitRow = h('div', { class: 'grid-2' }, whereTheyFit(m, senators), committeesCard(m));
  const proposeCard = legislationActivity(m);
  const nav = pageNav([
    keyCard ? ['key-votes', 'Key votes', keyCard] : null,
    ['where-they-stand', 'Where they stand', standCard],
    ['over-time', 'Over time', timeCard],
    ['in-the-senate', 'In the Senate', fitRow],
    ['bills', 'Bills', proposeCard],
    ['record', 'Full record', recordCard],
  ].filter(Boolean));

  return h('div', null,
    h('div', { class: 'stack' },
      header(m, meta),
      nav,
      keyCard,
      standCard,
      timeCard,
      fitRow,
      proposeCard,
      recordCard));
}
