// Topics: every bill and roll call is tagged with one plain-language topic (built from the
// Library of Congress policy areas). Overview page + one page per topic.

import { senate, senatorsById } from '../data.js';
import {
  h, num, plural, statTile, billRow, voteRow, senatorChip, topicHref, PARTY_PLURAL,
} from '../ui.js';

const NOMINATIONS_BLURB = 'Senate votes to confirm judges, cabinet members, ambassadors and other officials the President nominates.';

function areasText(t) {
  if (t.id === 'nominations') return NOMINATIONS_BLURB;
  return t.areas.length ? `Library of Congress policy areas: ${t.areas.join('; ')}.` : '';
}

export async function renderTopics() {
  const [topics, meta] = await Promise.all([senate.topics(), senate.meta()]);
  document.title = 'Topics · Voting Tracker';
  const shown = topics.filter((t) => t.counts.bills || t.counts.votes)
    .sort((a, b) => (b.counts.bills + b.counts.votes * 5) - (a.counts.bills + a.counts.votes * 5));
  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, `U.S. Senate · ${meta.congressLabel}`),
        h('h1', null, 'Browse by ', h('em', null, 'topic')),
        h('p', { class: 'lede' }, 'Every bill is assigned a policy area by the Congressional Research Service; we group those into the topics below. Roll-call votes take the topic of the bill they are about, and amendments to budget bills are sorted by what the amendment itself does.'))),
    h('div', { class: 'topic-grid' }, shown.map((t) => {
      const c = t.counts;
      const stat = (v, l) => h('div', null, h('div', { class: 'v' }, num(v)), h('div', { class: 'l' }, l));
      const partyLine = c.votes ? Math.round((100 * c.partyLine) / c.votes) : null;
      return h('a', { class: 'topic-card', href: topicHref(t.id) },
        h('h3', null, t.label),
        h('div', { class: 'topic-stats' },
          t.id === 'nominations' ? [stat(c.votes, 'Roll-call votes'), stat(c.partyLine, 'Party-line')]
            : [stat(c.bills, 'Bills'), stat(c.laws, 'Became law'), stat(c.votes, 'Floor votes')]),
        partyLine === null ? null : h('div', { class: 'topic-partisan', title: `${c.partyLine} of ${c.votes} roll calls split the parties` },
          h('div', { class: 'agree-meter', 'aria-hidden': 'true' }, h('span', { style: { width: `${partyLine}%` } })),
          h('span', null, `${partyLine}% party-line`)),
        h('div', { class: 'areas' }, t.id === 'nominations' ? 'Judges, cabinet members and other officials' : t.areas.join(' · ')));
    })));
}

export async function renderTopic(id) {
  const [topics, votesData, byId] = await Promise.all([senate.topics(), senate.votes(), senatorsById()]);
  const t = topics.find((x) => x.id === id);
  if (!t) {
    return h('div', { class: 'error-box' }, h('h2', null, 'Topic not found'),
      h('p', { style: { marginTop: '8px' } }, h('a', { href: '#/senate/topics' }, 'See all topics →')));
  }
  document.title = `${t.label} · Voting Tracker`;
  const voteById = new Map(votesData.votes.map((v) => [v.id, v]));
  const recent = t.recentVotes.map((vid) => voteById.get(vid)).filter(Boolean);
  const c = t.counts;

  const kpis = h('div', { class: 'kpis' },
    t.id === 'nominations' ? null : statTile('Senate bills & resolutions', num(c.bills), 'introduced this Congress'),
    t.id === 'nominations' ? null : statTile('Passed the Senate', num(c.passed), 'or agreed to, for resolutions'),
    t.id === 'nominations' ? null : statTile('Became law', num(c.laws), 'including House bills the Senate voted on'),
    statTile('Roll-call votes', num(c.votes), c.votes ? `${num(c.partyLine)} were party-line votes` : 'none yet'));

  const votesCard = h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Latest floor votes'), h('p', null, `${plural(c.votes, 'roll-call vote')} on this topic`)),
      c.votes ? h('a', { class: 'more-link', href: `#/senate/votes?topic=${t.id}` }, 'All votes on this topic →') : null),
    recent.length ? h('div', { class: 'rows compact' }, recent.map((v) => voteRow(v, votesData.bills)))
      : h('p', { class: 'empty' }, 'No roll-call votes on this topic yet. Most bills never reach a recorded floor vote.'));

  const billsCard = t.id === 'nominations' ? null : h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'Newest bills'), h('p', null, 'Senate bills and resolutions')),
      h('a', { class: 'more-link', href: `#/senate/legislation/search?topic=${t.id}` }, `Search all ${num(c.bills)} →`)),
    t.newest.length ? h('div', { class: 'rows compact' }, t.newest.map((b) => billRow(b, byId))) : h('p', { class: 'empty' }, 'None yet.'));

  const movingCard = t.moving.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Moving'), h('p', null, 'Advanced past introduction, by latest action'))),
    h('div', { class: 'rows compact' }, t.moving.map((b) => billRow(b, byId)))) : null;

  const lawsCard = t.laws.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Became law')),
    h('div', { class: 'rows compact' }, t.laws.map((b) => billRow(b, byId)))) : null;

  const sponsorsCard = t.topSponsors.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Most active senators'), h('p', null, 'Most bills and resolutions introduced on this topic'))),
    h('div', { class: 'rank-list' }, t.topSponsors.map((x) => {
      const s = byId.get(x.id);
      return s ? h('div', { class: 'item' }, senatorChip(s), h('span', { class: 'num' }, plural(x.n, 'measure'))) : null;
    }))) : null;

  const crossersCard = t.crossers.length ? h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', null, h('h2', null, 'Most likely to cross party lines'),
      h('p', null, 'On party-line votes about this topic, how often they sided with the other party'))),
    h('div', { class: 'rank-list' }, t.crossers.map((x) => {
      const s = byId.get(x.id);
      if (!s) return null;
      const other = s.caucus === 'D' ? PARTY_PLURAL.R : PARTY_PLURAL.D;
      return h('div', { class: 'item' }, senatorChip(s),
        h('span', { class: 'muted num', title: `Sided with ${other} on ${x.cross} of ${x.n} party-line votes` }, `${x.cross} of ${x.n}`));
    }))) : null;

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, h('a', { href: '#/senate/topics' }, 'Topics'), ' · U.S. Senate'),
        h('h1', null, t.label),
        h('p', { class: 'lede' }, areasText(t)))),
    kpis,
    h('div', { class: 'grid-2' },
      h('div', { class: 'stack' }, votesCard, billsCard, movingCard, lawsCard),
      h('div', { class: 'stack' }, sponsorsCard, crossersCard)));
}
