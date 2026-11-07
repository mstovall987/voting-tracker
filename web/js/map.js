// U.S. map for the Senate: every state is split into its two seats, each filled with the
// party of the senator holding it. Shapes come from the public-domain us-atlas TopoJSON
// (Census boundaries, pre-projected to a 975x610 Albers USA layout), decoded here directly.

import { s, h, showTip, moveTip, hideTip, PARTY_NAME, STATE_NAMES, partyDot } from './ui.js';

const ATLAS_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json';
const NAME_TO_ABBR = Object.fromEntries(Object.entries(STATE_NAMES).map(([abbr, name]) => [name, abbr]));

// Small states also get a clickable box offshore; their shapes are hard to hit and label.
const CHICLETS = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD'];
const CHICLET = { x: 906, y0: 246, step: 26, w: 30, h: 19 };
// Nudge a few labels off awkward centroids (in map units).
const LABEL_NUDGE = { FL: [12, 6], LA: [-8, 2], MI: [10, 18], KY: [4, 2], ID: [0, 16], HI: [-10, 8], AK: [0, 0], WV: [-3, 3], VA: [6, 2], NY: [4, 0], CA: [-6, 0] };

let atlasPromise = null;
function loadAtlas() {
  if (!atlasPromise) {
    atlasPromise = fetch(ATLAS_URL).then((r) => {
      if (!r.ok) throw new Error(`Map shapes unavailable (HTTP ${r.status})`);
      return r.json();
    });
    atlasPromise.catch(() => { atlasPromise = null; });
  }
  return atlasPromise;
}

/** Minimal TopoJSON decoder for the states object -> [{name, rings: [[x,y]...][]}]. */
function decodeStates(topo) {
  const t = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([a, b]) => {
      if (!t) return [a, b];
      x += a;
      y += b;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
  const arcPoints = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (indexes) => {
    const pts = [];
    indexes.forEach((i, k) => pts.push(...(k ? arcPoints(i).slice(1) : arcPoints(i))));
    return pts;
  };
  return topo.objects.states.geometries.map((g) => {
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    return { name: g.properties?.name, rings: polygons.flatMap((p) => p.map(ring)) };
  });
}

function pathFor(rings) {
  return rings.map((r) => `M${r.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`).join('');
}

function ringStats(r) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    const f = x1 * y2 - x2 * y1;
    area += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  area /= 2;
  return { area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area) };
}

function bbox(rings) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function tooltipFor(abbr, seats) {
  return [
    h('div', { class: 'tt-title' }, STATE_NAMES[abbr]),
    seats.map((x) => h('div', { class: 'tt-row' }, partyDot(x.party), h('span', null, x.name),
      h('span', { class: 'n' }, PARTY_NAME[x.party]))),
    h('div', { class: 'tt-note' }, 'Click to see what they have been up to'),
  ];
}

/** Two seat rectangles covering [x0..x1], split at the middle, clipped by the caller. */
function seatRects(seats, x0, y0, x1, y1) {
  const [a, b = a] = seats;
  const mid = (x0 + x1) / 2;
  const out = [
    s('rect', { x: x0 - 1, y: y0 - 1, width: mid - x0 + 1, height: y1 - y0 + 2, class: `fill-${a.party}` }),
    s('rect', { x: mid, y: y0 - 1, width: x1 - mid + 1, height: y1 - y0 + 2, class: `fill-${b.party}` }),
  ];
  if (a.party !== b.party) out.push(s('line', { x1: mid, x2: mid, y1: y0 - 1, y2: y1 + 1, class: 'seat-gap' }));
  return out;
}

/**
 * Draw the map into `container`. seatsByState: Map(abbr -> [senior, junior]).
 * Returns { select(abbr|null) }.
 */
export async function drawSenateMap(container, { seatsByState, onSelect }) {
  const topo = await loadAtlas();
  const states = decodeStates(topo);
  const svg = s('svg', {
    class: 'us-map', viewBox: '0 0 975 610', role: 'group',
    'aria-label': 'Map of the United States. Each state is split into its two Senate seats, colored by party.',
  });
  const defs = s('defs');
  const shapesLayer = s('g');
  const labelLayer = s('g', { 'aria-hidden': 'true' });
  const hoverOutline = s('path', { class: 'hover-outline', d: '' });
  const selectOutline = s('path', { class: 'sel-outline', d: '' });
  svg.append(defs, shapesLayer, labelLayer, selectOutline, hoverOutline);

  const outlines = new Map(); // abbr -> path data used for hover/selection outlines
  const groups = new Map();

  function wire(g, abbr, seats, outlineD) {
    outlines.set(abbr, (outlines.get(abbr) || '') + outlineD); // small states: shape + offshore box
    groups.set(abbr, [...(groups.get(abbr) || []), g]);
    const enter = (e) => {
      hoverOutline.setAttribute('d', outlineD);
      if (e && e.clientX !== undefined) showTip(e.clientX, e.clientY, tooltipFor(abbr, seats));
    };
    g.addEventListener('pointerenter', enter);
    g.addEventListener('pointermove', (e) => moveTip(e.clientX, e.clientY));
    g.addEventListener('pointerleave', () => { hoverOutline.setAttribute('d', ''); hideTip(); });
    g.addEventListener('focus', () => hoverOutline.setAttribute('d', outlineD));
    g.addEventListener('blur', () => hoverOutline.setAttribute('d', ''));
    g.addEventListener('click', () => { hideTip(); onSelect(abbr); });
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(abbr);
      }
    });
  }

  for (const st of states) {
    const abbr = NAME_TO_ABBR[st.name];
    const d = pathFor(st.rings);
    const seats = abbr ? seatsByState.get(abbr) || [] : [];
    if (!seats.length) {
      shapesLayer.append(s('path', { d, class: 'no-senators', 'aria-hidden': 'true' }));
      continue;
    }
    const [x0, y0, x1, y1] = bbox(st.rings);
    const clipId = `clip-${abbr}`;
    defs.append(s('clipPath', { id: clipId }, s('path', { d })));
    const g = s('g', {
      class: 'state', tabindex: '0', role: 'button', 'data-state': abbr,
      'aria-label': `${STATE_NAMES[abbr]}: ${seats.map((x) => `${x.name}, ${PARTY_NAME[x.party]}`).join('; ')}`,
    },
    s('g', { 'clip-path': `url(#${clipId})` }, seatRects(seats, x0, y0, x1, y1)),
    s('path', { d, class: 'state-outline' }));
    shapesLayer.append(g);
    wire(g, abbr, seats, d);

    if (!CHICLETS.includes(abbr)) {
      const biggest = st.rings.map(ringStats).sort((a, b) => b.area - a.area)[0];
      const [nx, ny] = LABEL_NUDGE[abbr] || [0, 0];
      labelLayer.append(s('text', {
        class: 'label', x: (biggest.cx + nx).toFixed(1), y: (biggest.cy + ny).toFixed(1),
        'text-anchor': 'middle', 'dominant-baseline': 'central',
      }, abbr));
    }
  }

  CHICLETS.forEach((abbr, i) => {
    const seats = seatsByState.get(abbr) || [];
    if (!seats.length) return;
    const x = CHICLET.x;
    const y = CHICLET.y0 + i * CHICLET.step;
    const clipId = `clip-box-${abbr}`;
    const box = `M${x},${y}h${CHICLET.w}v${CHICLET.h}h${-CHICLET.w}Z`;
    defs.append(s('clipPath', { id: clipId }, s('rect', { x, y, width: CHICLET.w, height: CHICLET.h, rx: 3 })));
    const g = s('g', {
      class: 'state chiclet', tabindex: '0', role: 'button', 'data-state': abbr,
      'aria-label': `${STATE_NAMES[abbr]}: ${seats.map((x2) => `${x2.name}, ${PARTY_NAME[x2.party]}`).join('; ')}`,
    },
    s('g', { 'clip-path': `url(#${clipId})` }, seatRects(seats, x, y, x + CHICLET.w, y + CHICLET.h)),
    s('rect', { x: x - 4, y: y - 3, width: CHICLET.w + 34, height: CHICLET.h + 6, fill: 'transparent' }));
    shapesLayer.append(g);
    labelLayer.append(s('text', { class: 'chiclet-label', x: x + CHICLET.w + 6, y: y + CHICLET.h / 2, 'dominant-baseline': 'central' }, abbr));
    wire(g, abbr, seats, box);
  });

  container.replaceChildren(svg);

  return {
    select(abbr) {
      svg.classList.toggle('has-selection', Boolean(abbr));
      for (const [code, gs] of groups) gs.forEach((g) => g.classList.toggle('selected', code === abbr));
      selectOutline.setAttribute('d', (abbr && outlines.get(abbr)) || '');
    },
  };
}
