// App shell: hash router, navigation state and the data-sources footer.

import { h, loading, errorBox, timeAgo, fmtDate, hideTip, setTopics } from './ui.js';
import { senate } from './data.js';
import * as home from './views/home.js';
import { renderSenators } from './views/senators.js';
import { renderSenator } from './views/senator.js';
import { renderLegislation } from './views/legislation.js';
import { renderVotes } from './views/votes.js';
import { renderBill } from './views/bill.js';
import { renderVote } from './views/vote.js';
import { renderTopics, renderTopic } from './views/topics.js';
import { renderCompare } from './views/compare.js';
import { renderSoon } from './views/soon.js';

const main = document.getElementById('main');

// Views get (match, query); query comes from "#/path?key=value", e.g. #/senate/votes?topic=health
const ROUTES = [
  { re: /^\/senate\/?$/, section: 'home', view: () => home.render(null) },
  { re: /^\/senate\/state\/([A-Z]{2})$/, section: 'home', view: (m) => home.render(m[1]) },
  { re: /^\/senate\/senators$/, section: 'senators', view: () => renderSenators() },
  { re: /^\/senate\/senator\/([A-Z]\d{6})$/, section: 'senators', view: (m) => renderSenator(m[1]) },
  { re: /^\/senate\/compare$/, section: 'compare', view: (m, q) => renderCompare(q) },
  { re: /^\/senate\/topics$/, section: 'topics', view: () => renderTopics() },
  { re: /^\/senate\/topic\/([a-z]+)$/, section: 'topics', view: (m) => renderTopic(m[1]) },
  { re: /^\/senate\/legislation(?:\/([a-z]+))?$/, section: 'legislation', view: (m, q) => renderLegislation(m[1], q) },
  { re: /^\/senate\/votes$/, section: 'votes', view: (m, q) => renderVotes(q) },
  { re: /^\/senate\/bill\/([a-z]+\d+-\d+)$/, section: 'legislation', view: (m) => renderBill(m[1]) },
  { re: /^\/senate\/vote\/(s\d+-\d+-\d+)$/, section: 'votes', view: (m) => renderVote(m[1]) },
  { re: /^\/(house|president|states)$/, branch: (m) => m[1], view: (m) => renderSoon(m[1]) },
];

let navToken = 0;
let firstLoad = true;

const BRANCH_LABEL = { senate: 'Senate', house: 'House', president: 'President', states: 'States' };

function setNav(branch, section) {
  for (const a of document.querySelectorAll('.branch-nav a')) {
    const on = a.dataset.branch === branch;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.getElementById('branch-current').textContent = BRANCH_LABEL[branch] || 'Senate';
  document.getElementById('branch-switch').open = false;
  const sectionNav = document.getElementById('section-nav');
  sectionNav.hidden = branch !== 'senate';
  for (const a of sectionNav.querySelectorAll('a')) {
    const on = a.dataset.section === section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

async function route() {
  const raw = (location.hash || '#/senate').replace(/^#/, '') || '/senate';
  const [path, queryString = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  let route = null;
  let match = null;
  for (const r of ROUTES) {
    match = r.re.exec(path);
    if (match) { route = r; break; }
  }
  if (!route) {
    location.replace('#/senate');
    return;
  }
  hideTip();
  setNav(route.branch ? route.branch(match) : 'senate', route.section || null);

  // Picking another state on the map updates the open page instead of rebuilding it.
  if (route.section === 'home' && home.isMounted()) {
    home.selectState(match[1] || null);
    return;
  }

  const token = ++navToken;
  main.replaceChildren(loading());
  if (!firstLoad) window.scrollTo(0, 0);
  try {
    const node = await route.view(match, query);
    if (token !== navToken) return; // a newer navigation won
    main.replaceChildren(node);
    enhance(main);
    if (!firstLoad) main.focus({ preventScroll: true });
  } catch (err) {
    console.error(err);
    if (token === navToken) main.replaceChildren(errorBox(err));
  }
  firstLoad = false;
}

async function renderFooter() {
  const footer = document.getElementById('footer');
  try {
    const meta = await senate.meta();
    footer.replaceChildren(h('div', { class: 'footer-grid' },
      h('div', { class: 'footer-about' },
        h('div', { class: 'footer-brand' }, 'Voting Tracker'),
        h('p', null, 'Every Senate vote and bill, rebuilt from free public records. Independent: not affiliated with Congress, any party or any campaign.'),
        h('p', { class: 'muted' }, `Data rebuilt ${timeAgo(meta.generatedAt)} · latest roll call ${fmtDate(meta.latestVote)}`)),
      h('div', { class: 'sources' }, meta.sources.map((src) =>
        h('div', null,
          h('div', null, h('a', { class: 'src-name', href: src.url, target: '_blank', rel: 'noopener' }, src.name)),
          h('div', null, src.what),
          h('div', { class: 'muted' }, `Checked ${timeAgo(src.checkedAt)}${src.changedAt ? ` · last changed ${timeAgo(src.changedAt)}` : ''}`))))));
  } catch {
    footer.replaceChildren(h('div', null, 'Data has not been built yet. Run ', h('code', null, 'python -m pipeline update'), '.'));
  }
}

// ------------------------------------------------------------------ page polish

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** The header goes dark and translucent while it sits over a page's dark opening band. */
function updateHeaderTone() {
  if (main.querySelector(':scope > .loading')) return; // keep the current tone while loading
  const header = document.querySelector('.site-header');
  const stage = main.querySelector('.stage, .page-head');
  const onStage = Boolean(stage) && stage.getBoundingClientRect().bottom > header.offsetHeight + 4;
  header.classList.toggle('on-stage', onStage);
}

let revealer = null;
/** Cards and section titles drift up as they scroll into view. */
function setupReveal(root) {
  revealer?.disconnect();
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const targets = [...root.querySelectorAll('.card, .section-head, .topic-grid, .kpis')].filter((el) => !el.closest('.stage'));
  let fired = false;
  revealer = new IntersectionObserver((entries) => {
    fired = true;
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '0px 0px -6% 0px' });
  targets.forEach((el) => { el.classList.add('reveal'); revealer.observe(el); });
  // Safety net: if the browser never reports visibility (e.g. a throttled background tab), show everything.
  setTimeout(() => { if (!fired) targets.forEach((el) => el.classList.add('in')); }, 1200);
}

function enhance(root) {
  setupReveal(root);
  requestAnimationFrame(updateHeaderTone);
  updateHeaderTone();
}

/** A soft light follows the cursor across cards (fine pointers only). */
function setupSpotlight() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.card, .senator-card, .topic-card, .stage .kpi');
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });
}

// ------------------------------------------------------------------ light / dark theme

function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function setupTheme() {
  const button = document.getElementById('theme-toggle');
  const label = () => button.setAttribute('aria-label', `Switch to ${currentTheme() === 'dark' ? 'light' : 'dark'} mode`);
  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
    label();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', label);
  label();
}

function setupHeader() {
  // Sticky elements sit just below the header, whose height changes with screen width.
  const header = document.querySelector('.site-header');
  const syncHeight = () => document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  new ResizeObserver(syncHeight).observe(header);
  syncHeight();
  const branch = document.getElementById('branch-switch');
  document.addEventListener('click', (e) => { // close the branch menu when clicking elsewhere
    if (branch.open && !branch.contains(e.target)) branch.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') branch.open = false;
    // "/" jumps to the search box when one is on the page (and you're not already typing)
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    const search = document.querySelector('.search-input');
    if (e.key === '/' && !typing && search) {
      e.preventDefault();
      search.focus();
    }
  });
}

async function start() {
  setupTheme();
  setupHeader();
  setupSpotlight();
  window.addEventListener('scroll', updateHeaderTone, { passive: true });
  try {
    setTopics((await senate.meta()).topics); // topic labels are needed by every list
  } catch {
    // No data yet: the page itself shows how to build it.
  }
  window.addEventListener('hashchange', route);
  route();
  renderFooter();
}

start();
