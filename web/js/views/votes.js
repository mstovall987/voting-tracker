// Floor votes: every Senate roll call this Congress, newest first, with filters.

import { senate } from '../data.js';
import { h, voteRow, pagedList, chipGroup, toggle, debounce, plural, CATEGORY, fmtDate, topicSelect, topicLabel, countBy } from '../ui.js';

const view = { cat: 'all', session: 'all', partyLine: false, keyOnly: false, q: '', topic: '' };

export async function renderVotes(query = {}) {
  const [votesData, meta] = await Promise.all([senate.votes(), senate.meta()]);
  view.topic = query.topic || ''; // topic comes from the link (e.g. a topic page), not memory
  if (query.key) view.keyOnly = true;
  document.title = `${view.topic ? `${topicLabel(view.topic)} votes` : 'Floor votes'} · Voting Tracker`;
  const all = [...votesData.votes].reverse();
  const topicPick = topicSelect(view.topic, (t) => { view.topic = t; draw(); }, { counts: countBy(all, 'tp') });
  const startYear = Number(meta.congressStart.slice(0, 4));
  const sessions = [...new Set(all.map((v) => v.s))].sort();

  const catBox = h('div');
  const count = h('p', { class: 'result-count' });
  const listBox = h('div');
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Search by bill, nominee or topic', 'aria-label': 'Search votes', value: view.q });
  input.addEventListener('input', debounce(() => { view.q = input.value.trim().toLowerCase(); draw(); }));
  const sessionSel = h('select', { class: 'select', 'aria-label': 'Session' },
    h('option', { value: 'all' }, 'Both sessions'),
    sessions.map((s) => h('option', { value: String(s) }, `${startYear + s - 1} (session ${s})`)));
  sessionSel.value = view.session;
  sessionSel.addEventListener('change', () => { view.session = sessionSel.value; draw(); });

  function draw() {
    const base = all.filter((v) => (view.session === 'all' || String(v.s) === view.session)
      && (!view.partyLine || v.pl) && (!view.keyOnly || v.key) && (!view.topic || v.tp === view.topic));
    const cats = Object.keys(CATEGORY).filter((c) => base.some((v) => v.cat === c));
    catBox.replaceChildren(chipGroup([['all', 'All', base.length], ...cats.map((c) => [c, CATEGORY[c], base.filter((v) => v.cat === c).length])],
      view.cat, (c) => { view.cat = c; draw(); }, 'Vote type'));
    const list = base.filter((v) => (view.cat === 'all' || v.cat === view.cat)
      && (!view.q || `${v.desc} ${v.q} ${v.r} ${v.doc} ${votesData.bills[v.bill]?.title || ''}`.toLowerCase().includes(view.q)));
    count.textContent = `${plural(list.length, 'roll-call vote')}${list.length ? `, ${fmtDate(list.at(-1).d)} to ${fmtDate(list[0].d)}` : ''}`;
    listBox.replaceChildren(pagedList(list, (v) => voteRow(v, votesData.bills), { empty: 'No votes match these filters.' }));
  }
  draw();

  return h('div', null,
    h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'eyebrow' }, `U.S. Senate · ${meta.congressLabel}`),
        h('h1', null, 'Floor ', h('em', null, 'votes')),
        h('p', { class: 'lede' }, 'Every recorded (roll-call) vote in the Senate. About half are on nominations: the Senate confirms judges and executive officials. Votes usually appear here the morning after they happen.'))),
    h('section', { class: 'card' },
      h('div', { class: 'toolbar' }, h('div', { class: 'grow' }, input), topicPick, sessionSel),
      h('div', { class: 'toolbar' },
        toggle('★ Key votes only', view.keyOnly, (on) => { view.keyOnly = on; draw(); }),
        toggle('Party-line votes only', view.partyLine, (on) => { view.partyLine = on; draw(); })),
      h('div', { class: 'toolbar' }, catBox),
      count, listBox));
}
