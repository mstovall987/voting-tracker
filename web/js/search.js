// Quick search: senators, states, topics, a bill by number (e.g. "S. 5"), or full-text bill search.
// Arrow keys move through results, Enter opens one, Escape closes. "/" focuses it from anywhere.

import { h, avatar, partyTag, senatorHref, topicHref, topicList, STATE_NAMES } from './ui.js';

const BILL_RE = /^(sconres|sjres|sres|s|hconres|hjres|hres|hr)(\d+)$/;
const BILL_LABEL = { s: 'S.', sres: 'S.Res.', sjres: 'S.J.Res.', sconres: 'S.Con.Res.', hr: 'H.R.', hres: 'H.Res.', hjres: 'H.J.Res.', hconres: 'H.Con.Res.' };

const ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

export function searchBox(senators, congress) {
  const placeholder = 'Search a senator, state, topic or bill';
  const input = h('input', {
    class: 'search-input', type: 'search', placeholder, autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-label': placeholder, 'aria-expanded': 'false', 'aria-controls': 'search-results', 'aria-autocomplete': 'list',
  });
  const icon = h('span', { class: 'search-icon', 'aria-hidden': 'true' });
  icon.innerHTML = ICON; // static markup, no data
  const results = h('div', { class: 'search-results', id: 'search-results', role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'search' }, icon, input, results);
  const ordered = [...senators].sort((a, b) => Number(b.current) - Number(a.current) || a.last.localeCompare(b.last));
  let items = [];
  let active = -1;

  function close() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  }

  function setActive(i) {
    items.forEach((el, k) => {
      el.classList.toggle('active', k === i);
      el.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    active = i;
    if (i >= 0) items[i].scrollIntoView({ block: 'nearest' });
  }

  function render() {
    const raw = input.value.trim();
    const q = raw.toLowerCase();
    if (!q) { close(); return; }
    const groups = [];
    const bill = BILL_RE.exec(q.replace(/[.\s]/g, ''));
    if (bill) {
      const label = `${BILL_LABEL[bill[1]]} ${Number(bill[2])}`;
      groups.push(['Bill', [{ href: `#/senate/bill/${bill[1]}${Number(bill[2])}-${congress}`, glyph: '§', label: `Open ${label}`, sub: `${congress}th Congress` }]]);
    }
    const people = ordered.filter((s) => `${s.name} ${s.last} ${s.state} ${STATE_NAMES[s.state] || ''}`.toLowerCase().includes(q)).slice(0, 6);
    if (people.length) {
      groups.push(['Senators', people.map((s) => ({ href: senatorHref(s.id), person: s, label: s.name, sub: s.current ? `${s.party}-${s.state}` : `${s.party}-${s.state} · former` }))]);
    }
    const states = Object.entries(STATE_NAMES).filter(([abbr, name]) => name.toLowerCase().startsWith(q) || abbr.toLowerCase() === q).slice(0, 3);
    if (states.length) {
      groups.push(['States', states.map(([abbr, name]) => ({ href: `#/senate/state/${abbr}`, glyph: abbr, label: name, sub: 'Both senators' }))]);
    }
    const topics = topicList().filter((t) => t.label.toLowerCase().includes(q)).slice(0, 3);
    if (topics.length) groups.push(['Topics', topics.map((t) => ({ href: topicHref(t.id), glyph: '#', label: t.label, sub: 'Topic' }))]);
    groups.push(['Legislation', [{ href: `#/senate/legislation/search?q=${encodeURIComponent(raw)}`, glyph: '¶', label: `Search every bill for “${raw}”`, sub: '' }]]);

    results.replaceChildren(...groups.flatMap(([title, list]) => [
      h('div', { class: 'search-group', role: 'presentation' }, title),
      ...list.map((it) => h('a', { class: 'search-item', role: 'option', href: it.href, onmousedown: (e) => e.preventDefault() },
        it.person ? avatar(it.person, 'xs') : h('span', { class: 'search-glyph', 'aria-hidden': 'true' }, it.glyph),
        h('span', null, it.label),
        it.sub ? h('span', { class: 'sub' }, it.sub) : null)),
    ]));
    items = [...results.querySelectorAll('.search-item')];
    items.forEach((el) => el.addEventListener('click', close));
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(0);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); location.hash = items[active].getAttribute('href'); close(); input.blur(); }
    else if (e.key === 'Escape') { close(); }
  });
  return wrap;
}
