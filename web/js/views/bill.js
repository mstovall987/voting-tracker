// One bill or resolution: progress, summary, sponsor and cosponsors, Senate votes, every action.

import { senate, senatorsById } from '../data.js';
import {
  h, partyTag, partyDot, fmtDate, num, plural, statusPill, partySegBar, partyCountsText, senatorChip,
  senatorHref, resultBadge, keyFlag, PARTY_ORDER,
} from '../ui.js';
import { explainVote } from '../voteguide.js';

const CONGRESS_GOV = {
  s: 'senate-bill', sres: 'senate-resolution', sjres: 'senate-joint-resolution', sconres: 'senate-concurrent-resolution',
  hr: 'house-bill', hres: 'house-resolution', hjres: 'house-joint-resolution', hconres: 'house-concurrent-resolution',
};
const LABEL = { s: 'S.', sres: 'S.Res.', sjres: 'S.J.Res.', sconres: 'S.Con.Res.', hr: 'H.R.', hres: 'H.Res.', hjres: 'H.J.Res.', hconres: 'H.Con.Res.' };

function parseId(id) {
  const m = /^([a-z]+)(\d+)-(\d+)$/.exec(id || '');
  return m ? { type: m[1], number: Number(m[2]), congress: Number(m[3]) } : null;
}

function ordinal(n) {
  const v = n % 100;
  return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
}

export function congressGovUrl(id) {
  const p = parseId(id);
  return p && CONGRESS_GOV[p.type] ? `https://www.congress.gov/bill/${ordinal(p.congress)}-congress/${CONGRESS_GOV[p.type]}/${p.number}` : null;
}

function labelFor(id) {
  const p = parseId(id);
  return p ? `${LABEL[p.type] || p.type.toUpperCase()} ${p.number}` : id;
}

function stepper(bill) {
  const { type } = parseId(bill.id);
  const st = bill.stages || {};
  const senateFirst = type.startsWith('s');
  const pass = (chamber) => [chamber === 'senate' ? 'passed_senate' : 'passed_house', chamber === 'senate' ? 'Passed Senate' : 'Passed House'];
  const [first, second] = senateFirst ? [pass('senate'), pass('house')] : [pass('house'), pass('senate')];
  let steps;
  if (type === 'sres' || type === 'hres') {
    steps = [['introduced', 'Introduced'], ['reported', 'Committee / calendar'], [first[0], 'Agreed to']];
  } else if (type === 'sconres' || type === 'hconres') {
    steps = [['introduced', 'Introduced'], ['reported', 'Committee / calendar'], first, [second[0], `${second[1]} (agreed to)`]];
  } else {
    steps = [['introduced', 'Introduced'], ['reported', 'Committee / calendar'], first, second, ['to_president', 'To the President'],
      st.vetoed && bill.st !== 'law' ? ['vetoed', 'Vetoed'] : ['law', 'Became law']];
  }
  let reached = -1;
  steps.forEach(([key], i) => { if (st[key]) reached = i; });
  if (bill.st === 'law' || bill.st === 'agreed_to') reached = steps.length - 1;
  return h('div', { class: 'stepper', role: 'list', 'aria-label': 'Progress' }, steps.map(([key, label], i) => {
    const stop = (key === 'vetoed' && st.vetoed) || (bill.st === 'failed' && i === reached + 1);
    return h('div', { class: `step${i <= reached ? ' done' : ''}${stop ? ' stop' : ''}`, role: 'listitem' },
      stop && bill.st === 'failed' ? 'Failed' : label,
      st[key] ? h('span', { class: 'date' }, fmtDate(st[key])) : null);
  }));
}

function summaryBlock(bill) {
  if (!bill.summary) {
    return h('p', { class: 'muted' }, 'The Library of Congress has not published a summary yet. Summaries usually follow a bill by days to weeks.');
  }
  const paras = bill.summary.split('\n').filter(Boolean);
  const text = h('div', { class: 'summary-text' }, paras.map((p) => h('p', null, p)));
  if (bill.summary.length < 1400) return text;
  text.classList.add('clamped');
  const btn = h('button', { class: 'btn', type: 'button', style: { marginTop: '10px' } }, 'Show the full summary');
  btn.addEventListener('click', () => { text.classList.remove('clamped'); btn.remove(); });
  return h('div', null, text, btn);
}

function cosponsorsBlock(bill, byId) {
  const active = bill.cosponsors.filter((c) => !c.wd);
  const withdrawn = bill.cosponsors.filter((c) => c.wd);
  if (!bill.cosponsors.length) return h('p', { class: 'muted' }, 'No cosponsors.');
  const counts = PARTY_ORDER.map((p) => active.filter((c) => c.party === p).length);
  const person = (c) => {
    const s = byId.get(c.id);
    return h('div', null,
      partyDot(c.party), ' ',
      s ? h('a', { href: senatorHref(c.id) }, s.name) : c.name, ' ', partyTag(c.party, c.state),
      h('span', { class: 'muted' }, ` · ${fmtDate(c.d, { short: false })}${c.orig ? ' · original' : ''}${c.wd ? ` · withdrew ${fmtDate(c.wd)}` : ''}`));
  };
  return h('div', null,
    h('p', { class: 'ink-2', style: { marginBottom: '8px' } }, `${plural(active.length, 'cosponsor')}: ${partyCountsText(counts)}`),
    h('div', { style: { maxWidth: '420px', marginBottom: '14px' } }, partySegBar(counts)),
    h('div', { class: 'cosponsor-grid' }, active.map(person)),
    withdrawn.length ? h('div', { style: { marginTop: '12px' } }, h('div', { class: 'chart-sub' }, 'Withdrew'), h('div', { class: 'cosponsor-grid' }, withdrawn.map(person))) : null);
}

function actionsBlock(bill, knownVotes) {
  const items = [...bill.actions].reverse();
  return h('ol', { class: 'timeline' }, items.map((a) => h('li', null,
    h('span', { class: 'd' }, fmtDate(a.d)),
    h('span', null,
      a.ch ? h('span', { class: 'ch' }, a.ch) : null,
      a.t,
      a.v && knownVotes.has(a.v) ? [' ', h('a', { href: `#/senate/vote/${a.v}` }, 'See how each senator voted →')] : null))));
}

function relatedLink(r) {
  const p = parseId(r.id);
  const internal = p && p.type.startsWith('s');
  return h('li', null,
    h('a', internal ? { href: `#/senate/bill/${r.id}` } : { href: congressGovUrl(r.id), target: '_blank', rel: 'noopener' }, labelFor(r.id)),
    r.title ? ` — ${r.title}` : '',
    r.rel ? h('span', { class: 'muted' }, ` (${r.rel})`) : null);
}

export async function renderBill(id) {
  const [bill, byId, votesData] = await Promise.all([senate.bill(id), senatorsById(), senate.votes()]);
  if (!bill) {
    const url = congressGovUrl(id);
    return h('div', { class: 'error-box' },
      h('h2', null, `${labelFor(id)} isn’t in this dataset yet`),
      h('p', { class: 'ink-2', style: { marginTop: '8px' } }, 'The tracker currently loads every Senate bill and resolution, plus House bills the Senate voted on.'),
      url ? h('p', { style: { marginTop: '8px' } }, h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Open it on Congress.gov →')) : null);
  }
  document.title = `${bill.label}: ${bill.title} · Voting Tracker`;
  const knownVotes = new Set(votesData.votes.map((v) => v.id));
  const sponsor = bill.sp ? byId.get(bill.sp) : null;
  const links = [
    bill.url ? ['Congress.gov page', bill.url] : null,
    bill.textUrl ? ['Full text', bill.textUrl] : null,
    ...bill.cbo.slice(0, 2).map((c) => [`CBO cost estimate (${fmtDate(c.date)})`, c.url]),
  ].filter(Boolean);

  const head = h('section', { class: 'stage detail-stage' },
    h('div', { class: 'eyebrow' }, `${bill.label} · Introduced in the ${bill.origin || 'Senate'} · ${fmtDate(bill.intro)}`),
    h('h1', { class: bill.title.length > 90 ? 'title-long' : null }, bill.title),
    bill.officialTitle && bill.officialTitle !== bill.title ? h('p', { class: 'ink-2', style: { marginTop: '8px', maxWidth: '900px' } }, bill.officialTitle) : null,
    h('div', { class: 'toolbar', style: { marginTop: '14px', marginBottom: 0 } },
      statusPill(bill.st, bill.law),
      sponsor ? senatorChip(sponsor) : bill.spn ? h('span', null, `Sponsor: ${bill.spn} `, partyTag(bill.spp, bill.sps)) : null,
      bill.pa ? h('span', { class: 'tag' }, bill.pa) : null),
    stepper(bill),
    h('div', { class: 'profile-links' }, links.map(([label, url]) => h('a', { href: url, target: '_blank', rel: 'noopener' }, label))));

  const votesCard = bill.votes.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Senate roll-call votes'), h('p', null, 'Procedural, amendment and final votes on this measure.'))),
    h('div', { class: 'rows' }, [...bill.votes].reverse().map((v) => h('article', { class: 'row' },
      h('div', { class: 'row-main' },
        h('a', { class: 'row-title', href: `#/senate/vote/${v.id}` },
          v.cat === 'amendment' ? `Amendment: ${v.desc}` : explainVote(v, bill).title),
        h('div', { class: 'row-meta' }, `${fmtDate(v.d)} · ${v.q}`)),
      h('div', { class: 'row-side' }, resultBadge(v), keyFlag(v)))))) : null;

  return h('div', { class: 'stack' },
    head,
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Summary'), bill.summaryVersion ? h('p', null, `Congressional Research Service · ${bill.summaryVersion}`) : null)),
          summaryBlock(bill)),
        votesCard,
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Every action'), h('p', null, 'Newest first, as recorded by the Senate, the House and the Library of Congress.'))),
          actionsBlock(bill, knownVotes))),
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Cosponsors')), cosponsorsBlock(bill, byId)),
        bill.committees.length ? h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Committees')),
          h('ul', { class: 'name-list' }, bill.committees.map((c) => h('li', null, `${c.name}${c.chamber ? ` (${c.chamber})` : ''}`)))) : null,
        bill.subjects.length ? h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Subjects')),
          h('div', { class: 'tag-list' }, bill.subjects.map((x) => h('span', { class: 'tag' }, x)))) : null,
        bill.related.length ? h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Related bills')),
          h('ul', { class: 'name-list' }, bill.related.map(relatedLink))) : null,
        h('p', { class: 'note' }, `Record last updated ${fmtDate(bill.updated)} by Congress.gov.`))));
}
