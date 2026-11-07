// Placeholders for the next phases, with the data sources already lined up for each.

import { h } from '../ui.js';

const PAGES = {
  house: {
    title: 'House of Representatives',
    lede: 'Next up. The same views as the Senate (map by district, member profiles, legislation, floor votes) for all 435 members.',
    cards: [
      ['Votes', ['Clerk of the House roll-call XML, posted within minutes of each vote (clerk.house.gov)', 'Congress.gov API House vote endpoints', 'Voteview, for history and ideology scores']],
      ['Bills', ['The same Congress.gov bill-status records already used for the Senate (H.R., H.Res., H.J.Res., H.Con.Res.)']],
      ['Members', ['The same congress-legislators dataset, plus congressional-district maps from the Census Bureau']],
    ],
  },
  president: {
    title: 'The President',
    lede: 'Presidents do not vote, so this view will track what they act on: bills signed or vetoed, executive orders, and nominations sent to the Senate.',
    cards: [
      ['Executive actions', ['Federal Register API: executive orders, proclamations and memoranda, published daily (no key required)']],
      ['Bills', ['Signed and vetoed bills, from the Congress.gov records the tracker already loads']],
      ['Nominations', ['Congress.gov nominations data, tied to the Senate confirmation votes already shown here']],
    ],
  },
  states: {
    title: 'State legislatures',
    lede: 'Later phase: lawmakers in all 50 state legislatures, their bills and their recorded votes.',
    cards: [
      ['Sources', ['Open States (Plural Policy) API: legislators, bills and votes for all 50 states', 'LegiScan API: bill text, status and roll calls for all 50 states (free tier)']],
      ['Caveats', ['Coverage varies by state: some legislatures publish few recorded votes, and update speed ranges from hours to days']],
    ],
  },
};

export async function renderSoon(branch) {
  const page = PAGES[branch];
  document.title = `${page.title} · Voting Tracker`;
  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, 'Coming later'),
        h('h1', null, page.title),
        h('p', { class: 'lede' }, page.lede))),
    h('div', { class: 'soon-grid' }, page.cards.map(([title, items]) => h('section', { class: 'card' },
      h('h2', null, title), h('ul', null, items.map((x) => h('li', null, x)))))),
    h('p', { class: 'note', style: { marginTop: '16px' } }, h('a', { href: '#/senate' }, '← Back to the Senate')));
}
