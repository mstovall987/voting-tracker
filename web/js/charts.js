// Small hand-rolled SVG charts (no chart library). Conventions follow the dataviz guide:
// 2px lines, thin columns with 4px rounded data-ends, hairline solid grid, a hover layer on
// every chart, a legend for 2+ series, and a "view as table" twin for every chart.

import { s, h, showTip, moveTip, hideTip, fmtMonth, num, pctText, PARTY_NAME, PARTY_PLURAL, PARTY_ORDER, partyDot } from './ui.js';

function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f >= 7.5 ? 10 : f >= 3.5 ? 5 : f >= 1.5 ? 2 : 1) * mag;
}

function niceTicks(min, max, count = 4) {
  const step = niceStep(max - min || 1, count);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

export function niceMax(value, count = 3) {
  if (!value || value <= 0) return 1;
  const step = niceStep(value, count);
  return Math.ceil(value / step) * step;
}

function pointerX(svg, evt, width) {
  const r = svg.getBoundingClientRect();
  return ((evt.clientX - r.left) / r.width) * width;
}

function pointer(svg, evt, width, height) {
  const r = svg.getBoundingClientRect();
  return [((evt.clientX - r.left) / r.width) * width, ((evt.clientY - r.top) / r.height) * height];
}

const monthTick = (label, i) => (i === 0 || label.endsWith('-01') ? fmtMonth(label) : fmtMonth(label, { short: true }));

/** Path through points; null breaks the line (months with no data). */
function linePath(points) {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Top-rounded column (square at the baseline). */
function columnPath(x, y, w, hgt, r = 4) {
  if (hgt <= 0) return '';
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt}Z`;
}

/** Bar segment with an optional rounded right (data) end. */
function segmentPath(x, y, w, hgt, roundRight) {
  if (w <= 0) return '';
  if (!roundRight) return `M${x},${y}H${x + w}V${y + hgt}H${x}Z`;
  const rr = Math.min(4, w, hgt / 2);
  return `M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + hgt - rr}Q${x + w},${y + hgt} ${x + w - rr},${y + hgt}H${x}Z`;
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(([cls, label, kind = 'swatch']) =>
    h('span', null, h('span', { class: `${kind} ${cls}`, 'aria-hidden': 'true' }), label)));
}

export function tableView(headers, rows, summary = 'View as table') {
  return h('details', { class: 'table-view' },
    h('summary', null, summary),
    h('div', { class: 'table-wrap' },
      h('table', { class: 'data' },
        h('thead', null, h('tr', null, headers.map((x, i) => h('th', { class: i ? 'num' : null }, x)))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i ? 'num' : null }, c))))))));
}

// ------------------------------------------------------------------ line chart

/**
 * series: [{ name, values: (number|null)[], stroke: 'stroke-D', fill: 'fill-D', emphasis }]
 * The emphasized series gets a direct end label; others are context.
 */
export function lineChart({ labels, series, yMin = 0, yMax = 100, yFormat = (v) => `${v}%`,
  valueFormat = (v) => pctText(v), height = 230, ariaLabel = '', noteFor = null }) {
  const W = 640;
  const H = height;
  const m = { t: 14, r: 70, b: 30, l: 42 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = labels.length;
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  for (const t of niceTicks(yMin, yMax, 4)) {
    svg.append(
      s('line', { class: t === yMin ? 'baseline' : 'grid', x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t) }),
      s('text', { class: 'tick', x: m.l - 8, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' }, yFormat(t)));
  }
  const every = n > 15 ? 3 : n > 8 ? 2 : 1;
  labels.forEach((lab, i) => {
    if (i % every === 0) svg.append(s('text', { class: 'tick', x: x(i), y: H - 8, 'text-anchor': 'middle' }, monthTick(lab, i)));
  });

  for (const ser of series) {
    const pts = ser.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
    svg.append(s('path', { class: `line ${ser.stroke}`, d: linePath(pts) }));
    pts.forEach((p, i) => { // isolated points would otherwise be invisible
      if (p && !pts[i - 1] && !pts[i + 1]) svg.append(s('circle', { class: `marker ${ser.fill}`, cx: p[0], cy: p[1], r: 3.5 }));
    });
    if (ser.emphasis) {
      const last = pts.reduce((acc, p, i) => (p ? i : acc), -1);
      if (last >= 0) {
        svg.append(
          s('circle', { class: `marker ${ser.fill}`, cx: pts[last][0], cy: pts[last][1], r: 4.5 }),
          s('text', { class: 'end-label', x: pts[last][0] + 10, y: pts[last][1], 'dominant-baseline': 'central' }, valueFormat(ser.values[last])));
      }
    }
  }

  const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
  const markers = series.map((ser) => s('circle', { class: `marker ${ser.fill}`, r: 4.5, visibility: 'hidden' }));
  const overlay = s('rect', { x: m.l - 6, y: m.t, width: iw + 12, height: ih, fill: 'transparent' });
  overlay.addEventListener('pointermove', (e) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(((pointerX(svg, e, W) - m.l) / iw) * (n - 1))));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    series.forEach((ser, k) => {
      const v = ser.values[i];
      const mk = markers[k];
      if (v === null || v === undefined) { mk.setAttribute('visibility', 'hidden'); return; }
      mk.setAttribute('cx', x(i));
      mk.setAttribute('cy', y(v));
      mk.setAttribute('visibility', 'visible');
    });
    showTip(e.clientX, e.clientY,
      h('div', { class: 'tt-title' }, fmtMonth(labels[i])),
      series.map((ser) => h('div', { class: 'tt-row' },
        h('span', { class: `line-key-tt`, style: { width: '14px', height: '2px', background: `var(--${ser.cssVar})`, display: 'inline-block' } }),
        h('span', { class: 'v' }, ser.values[i] === null || ser.values[i] === undefined ? '—' : valueFormat(ser.values[i])),
        h('span', { class: 'n' }, ser.name))),
      noteFor ? h('div', { class: 'tt-note' }, noteFor(i)) : null);
  });
  overlay.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    markers.forEach((mk) => mk.setAttribute('visibility', 'hidden'));
    hideTip();
  });
  svg.append(cross, ...markers, overlay);
  return svg;
}

// ------------------------------------------------------------------ column chart (one series)

export function columnChart({ labels, values, fill = 'fill-D', height = 140, ariaLabel = '', tipFor }) {
  const W = 320;
  const H = height;
  const m = { t: 12, r: 6, b: 24, l: 30 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = labels.length;
  const maxVal = Math.max(0, ...values);
  const step = Math.max(1, Math.round(niceStep(maxVal || 1, 2))); // counts: whole-number ticks
  const top = Math.max(step, Math.ceil(maxVal / step) * step);
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  const band = iw / n;
  const bw = Math.min(24, Math.max(3, band * 0.62));
  const y = (v) => m.t + ih - (v / top) * ih;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel });

  for (const t of ticks) {
    svg.append(
      s('line', { class: t === 0 ? 'baseline' : 'grid', x1: m.l, x2: m.l + iw, y1: y(t), y2: y(t) }),
      s('text', { class: 'tick', x: m.l - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'central' }, num(Math.round(t * 10) / 10)));
  }
  labels.forEach((lab, i) => {
    if (i === 0 || lab.endsWith('-01')) {
      svg.append(s('text', { class: 'tick', x: m.l + band * i + band / 2, y: H - 7, 'text-anchor': i === 0 ? 'start' : 'middle' }, lab.slice(0, 4)));
    }
  });
  values.forEach((v, i) => {
    const bx = m.l + band * i + (band - bw) / 2;
    const bar = s('path', { class: `bar ${fill}`, d: columnPath(bx, y(v), bw, y(0) - y(v)) });
    const hit = s('rect', { class: 'bar-hit', x: m.l + band * i, y: m.t, width: band, height: ih });
    hit.addEventListener('pointerenter', (e) => { bar.classList.add('hover'); showTip(e.clientX, e.clientY, tipFor(i)); });
    hit.addEventListener('pointermove', (e) => moveTip(e.clientX, e.clientY));
    hit.addEventListener('pointerleave', () => { bar.classList.remove('hover'); hideTip(); });
    svg.append(bar, hit);
  });
  return svg;
}

// ------------------------------------------------------------------ ideology strip (beeswarm)

/** points: [{id, name, party, state, x}] with x = DW-NOMINATE dimension 1 (-1 liberal .. +1 conservative). */
export function ideologyStrip(points, highlightId, { onPick } = {}) {
  const W = 640;
  const m = { l: 18, r: 18 };
  const iw = W - m.l - m.r;
  const r = 4.5;
  const rowStep = 2 * r + 1.5;
  const x = (v) => m.l + ((v + 1) / 2) * iw;

  // Beeswarm: each dot takes the row nearest the center line where it doesn't overlap.
  const placed = [];
  for (const p of [...points].sort((a, b) => a.x - b.x)) {
    const px = x(p.x);
    let row = 0;
    for (let k = 0; k < 60; k++) {
      row = k === 0 ? 0 : (k % 2 ? -Math.ceil(k / 2) : Math.ceil(k / 2));
      if (!placed.some((q) => Math.hypot(q.px - px, (q.row - row) * rowStep) < 2 * r + 1.2)) break;
    }
    placed.push({ ...p, px, row });
  }
  const rows = placed.map((p) => p.row);
  const labelBand = 30; // room above the swarm for the highlighted senator's name
  const cy = labelBand + r + 6 - Math.min(0, ...rows) * rowStep;
  placed.forEach((p) => { p.py = cy + p.row * rowStep; });
  const axisY = cy + Math.max(0, ...rows) * rowStep + r + 12;
  const H = axisY + 34;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': 'Every senator placed on a liberal-to-conservative scale based on their voting record' });

  svg.append(s('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: axisY, y2: axisY }));
  for (const t of [-1, -0.5, 0, 0.5, 1]) {
    svg.append(
      s('line', { class: 'baseline', x1: x(t), x2: x(t), y1: axisY, y2: axisY + 4 }),
      s('text', { class: 'tick', x: x(t), y: axisY + 15, 'text-anchor': t === -1 ? 'start' : t === 1 ? 'end' : 'middle' }, t === 0 ? '0' : t.toFixed(1)));
  }
  svg.append(
    s('text', { class: 'axis-title', x: m.l, y: H - 4 }, '← More liberal'),
    s('text', { class: 'axis-title', x: W - m.r, y: H - 4, 'text-anchor': 'end' }, 'More conservative →'));

  const hi = placed.find((p) => p.id === highlightId);
  for (const p of placed) {
    if (p === hi) continue;
    svg.append(s('circle', { class: `dot-mark fill-${p.party}`, cx: p.px, cy: p.py, r }));
  }
  if (hi) {
    const lx = Math.max(m.l + 90, Math.min(W - m.r - 90, hi.px));
    svg.append(
      s('line', { class: 'crosshair', x1: hi.px, x2: hi.px, y1: labelBand - 4, y2: hi.py - 8 }),
      s('circle', { class: `dot-mark highlight fill-${hi.party}`, cx: hi.px, cy: hi.py, r: 7 }),
      s('text', { class: 'end-label', x: lx, y: labelBand - 10, 'text-anchor': 'middle' }, `${hi.name} (${hi.x.toFixed(2)})`));
  }

  const overlay = s('rect', { x: 0, y: 0, width: W, height: axisY, fill: 'transparent', style: { cursor: onPick ? 'pointer' : 'default' } });
  let current = null;
  const nearest = (e) => {
    const [px, py] = pointer(svg, e, W, H);
    let best = null;
    let bestD = 18;
    for (const p of placed) {
      const d = Math.hypot(p.px - px, p.py - py);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  };
  overlay.addEventListener('pointermove', (e) => {
    current = nearest(e);
    if (!current) { hideTip(); return; }
    showTip(e.clientX, e.clientY,
      h('div', { class: 'tt-title' }, current.name),
      h('div', { class: 'tt-row' }, partyDot(current.party), h('span', { class: 'n' }, `${PARTY_NAME[current.party]}, ${current.state}`)),
      h('div', { class: 'tt-row' }, h('span', { class: 'v' }, current.x.toFixed(3)), h('span', { class: 'n' }, 'DW-NOMINATE score')));
  });
  overlay.addEventListener('pointerleave', () => { current = null; hideTip(); });
  if (onPick) overlay.addEventListener('click', (e) => { const p = nearest(e); if (p) { hideTip(); onPick(p.id); } });
  svg.append(overlay);
  return svg;
}

// ------------------------------------------------------------------ vote tally by party

/** Horizontal bars for Yea / Nay / Present / Not voting, each split by party (vote.p). */
export function tallyChart(v) {
  const rows = [['Yea', 0], ['Nay', 1], ['Present', 2], ['Not voting', 3]]
    .filter(([, k]) => k < 2 || PARTY_ORDER.some((p) => v.p[p]?.[k]));
  const W = 640;
  const rowH = 38;
  const barH = 24;
  const labelW = 92;
  const totalW = 40;
  const H = rows.length * rowH + 4;
  const scale = (W - labelW - totalW) / 100;
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Vote tally by party: ${rows.map(([label, k]) => `${label} ${PARTY_ORDER.reduce((a, p) => a + (v.p[p]?.[k] || 0), 0)}`).join(', ')}` });
  rows.forEach(([label, k], ri) => {
    const y0 = ri * rowH + (rowH - barH) / 2;
    const counts = PARTY_ORDER.map((p) => [p, v.p[p]?.[k] || 0]).filter(([, c]) => c > 0);
    const total = counts.reduce((a, [, c]) => a + c, 0);
    svg.append(s('text', { class: 'row-label', x: 0, y: y0 + barH / 2, 'dominant-baseline': 'central' }, label));
    let cx = labelW;
    counts.forEach(([p, c], i) => {
      const w = c * scale - (i < counts.length - 1 ? 2 : 0);
      const seg = s('path', { class: `fill-${p}`, d: segmentPath(cx, y0, Math.max(w, 1), barH, i === counts.length - 1) });
      seg.addEventListener('pointerenter', (e) => showTip(e.clientX, e.clientY,
        h('div', { class: 'tt-row' }, partyDot(p), h('span', { class: 'v' }, num(c)), h('span', { class: 'n' }, `${PARTY_PLURAL[p]} voted ${label}`))));
      seg.addEventListener('pointermove', (e) => moveTip(e.clientX, e.clientY));
      seg.addEventListener('pointerleave', hideTip);
      svg.append(seg);
      if (w >= 26) {
        svg.append(s('text', { class: `seg-label on-${p}`, x: cx + 8, y: y0 + barH / 2, 'dominant-baseline': 'central' }, String(c)));
      }
      cx += c * scale;
    });
    svg.append(s('text', { class: 'row-total', x: W, y: y0 + barH / 2, 'text-anchor': 'end', 'dominant-baseline': 'central' }, String(total)));
  });
  return svg;
}

// ------------------------------------------------------------------ sparkline (stat tiles)

/**
 * Tiny trend for a stat tile, no axes: muted monthly bars with the current month in the accent,
 * or a thin line (kind: 'line'; gaps where a value is null). The full numbers live elsewhere.
 */
export function sparkline(values, labels, { kind = 'bars', format = (v) => num(v) } = {}) {
  const W = 120;
  const H = 32;
  const n = values.length;
  const svg = s('svg', { class: `spark spark-${kind}`, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const present = values.filter((v) => v !== null && v !== undefined);
  if (!n || !present.length) return svg;
  if (kind === 'line') {
    const lo = Math.min(...present);
    const span = Math.max(...present) - lo || 1;
    const x = (i) => (n === 1 ? W / 2 : (i * W) / (n - 1));
    const y = (v) => H - 3 - ((v - lo) / span) * (H - 6);
    svg.append(s('path', { class: 'spark-line', d: linePath(values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]))) }));
    return svg;
  }
  const max = Math.max(1, ...present);
  const band = W / n;
  const bw = Math.max(1.2, band * 0.62);
  values.forEach((v, i) => {
    const val = v || 0;
    const hgt = Math.max(1, (val / max) * (H - 1)); // zero months keep a 1px baseline stub
    svg.append(s('rect', {
      class: `spark-bar${i === n - 1 ? ' now' : ''}`,
      x: (i * band + (band - bw) / 2).toFixed(2), y: (H - hgt).toFixed(2), width: bw.toFixed(2), height: hgt.toFixed(2),
    }, s('title', null, `${fmtMonth(labels[i])}: ${format(val)}`)));
  });
  return svg;
}

// ------------------------------------------------------------------ Senate seat chart (hemicycle)

let hemiCount = 0;

/**
 * One dot per senator in a half-circle, filled left to right in the order given (we pass them
 * sorted by voting record, most liberal to most conservative), with a soft glow layer and faint
 * amphitheater rings. center = {small, big} labels the middle. Hovering a seat shows card(seat)
 * floating above it (or, without a card, names the senator in the middle); clicking opens them.
 * Returns a wrapper element holding the SVG and the floating card.
 */
export function hemicycle(seats, { center, onPick, card = null } = {}) {
  const n = seats.length;
  const W = 600;
  const H = 312;
  const cx = W / 2;
  const cy = H - 8;
  const rows = 6;
  const inner = 138; // leaves room in the middle for the label
  const outer = 292;
  const radii = Array.from({ length: rows }, (_, i) => inner + (i * (outer - inner)) / (rows - 1));
  const total = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.floor((n * r) / total));
  for (let rest = n - counts.reduce((a, b) => a + b, 0), i = rows - 1; rest > 0; rest--, i = (i - 1 + rows) % rows) counts[i]++;
  const slots = [];
  radii.forEach((r, ri) => {
    const k = counts[ri];
    for (let j = 0; j < k; j++) {
      const a = Math.PI * (1 - (k === 1 ? 0.5 : j / (k - 1)));
      slots.push({ a, x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) });
    }
  });
  slots.sort((p, q) => q.a - p.a); // left to right across all rows
  const spacing = Math.min(...radii.map((r, i) => (Math.PI * r) / Math.max(1, counts[i] - 1)), (outer - inner) / (rows - 1));
  const radius = spacing * 0.4;

  const uid = `hemi-${++hemiCount}`;
  const svg = s('svg', { class: 'hemi', viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': 'Senate seats, one dot per senator, colored by party and ordered from most liberal on the left to most conservative on the right' });
  const arc = (r) => `M${(cx - r).toFixed(1)},${cy} A${r},${r} 0 0 1 ${(cx + r).toFixed(1)},${cy}`;
  const defs = s('defs', null,
    s('filter', { id: `${uid}-glow`, x: '-50%', y: '-50%', width: '200%', height: '200%' }, s('feGaussianBlur', { stdDeviation: '7' })));
  const rings = s('g', { class: 'rings', 'aria-hidden': 'true' }, [inner - 24, inner - 50, outer + 22].map((r) => s('path', { d: arc(r) })));
  const place = (seat, i, cls, r) => s('circle', {
    class: `${cls} fill-${seat.party}`, cx: slots[i].x.toFixed(1), cy: slots[i].y.toFixed(1), r: r.toFixed(1),
    style: { '--i': String(i) }, // staggers the left-to-right entrance animation
  });
  const glow = s('g', { class: 'glow', filter: `url(#${uid}-glow)`, 'aria-hidden': 'true' }, seats.map((seat, i) => place(seat, i, 'seat-glow', radius * 1.1)));
  const dots = seats.map((seat, i) => place(seat, i, 'seat', radius));
  const small = s('text', { class: 'center-small', x: cx, y: cy - 64, 'text-anchor': 'middle' }, center?.small || '');
  const big = s('text', { class: 'center-big', x: cx, y: cy - 18, 'text-anchor': 'middle' }, center?.big || '');
  svg.append(defs, rings, glow, ...dots, small, big);
  const wrap = h('div', { class: 'hemi-wrap' }, svg);
  const tip = card ? h('div', { class: 'hemi-card', hidden: true }) : null;
  if (tip) wrap.append(tip);

  let current = -1;
  const show = (i) => {
    if (i === current) return;
    if (current >= 0) dots[current].classList.remove('on');
    current = i;
    svg.classList.toggle('hovering', i >= 0);
    if (i < 0) {
      if (tip) tip.hidden = true;
      small.textContent = center?.small || '';
      big.textContent = center?.big || '';
      big.setAttribute('class', 'center-big');
      return;
    }
    const seat = seats[i];
    dots[i].classList.add('on');
    if (tip) { // float the card just above the seat, nudged inward near the edges
      const xp = (100 * slots[i].x) / W;
      tip.replaceChildren(card(seat));
      tip.style.left = `${xp}%`;
      tip.style.top = `${(100 * slots[i].y) / H}%`;
      tip.style.setProperty('--tx', xp < 24 ? '-16%' : xp > 76 ? '-84%' : '-50%');
      tip.hidden = false;
      return;
    }
    small.textContent = `${PARTY_NAME[seat.party]} · ${seat.state}`;
    big.textContent = seat.name;
    big.setAttribute('class', 'center-name');
  };
  const overlay = s('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent', style: { cursor: onPick ? 'pointer' : 'default' } });
  const nearest = (e) => {
    const [px, py] = pointer(svg, e, W, H);
    let best = -1;
    let bestD = radius * 2.4;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(slots[i].x - px, slots[i].y - py);
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  };
  const touch = matchMedia('(hover: none)');
  overlay.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || !touch.matches) show(nearest(e)); });
  overlay.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') show(-1); });
  overlay.addEventListener('click', (e) => {
    const i = nearest(e);
    // On touch screens the first tap names the senator; tapping the same seat again opens them.
    if (touch.matches && i !== current) { show(i); return; }
    if (i >= 0 && onPick) onPick(seats[i].id);
  });
  svg.append(overlay);
  return wrap;
}

// ------------------------------------------------------------------ ranked horizontal bars (HTML)

export function rankedBars(items, { fill = 'bg-D', max = null, valueFmt = num } = {}) {
  const top = max || Math.max(1, ...items.map(([, v]) => v));
  return h('div', { class: 'hbars' }, items.map(([label, value]) =>
    h('div', { class: 'hbar' },
      h('span', { class: 'name' }, label),
      h('span', { class: 'track' },
        h('span', { class: `fill ${fill}`, style: { width: `calc((100% - 48px) * ${value / top})` } }),
        h('span', { class: 'val' }, valueFmt(value))))));
}
