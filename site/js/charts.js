// Small dependency-free SVG charts with hover tooltips.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (ms) => dateFmt.format(ms);
export const fmtDateTime = (ms) => dateTimeFmt.format(ms);

/** Picks "nice" tick values for a linear range. */
function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

function timeTicks(lo, hi) {
  const span = hi - lo;
  const day = 864e5;
  const out = [];
  if (span > 3 * 365 * day) {
    const y0 = new Date(lo).getUTCFullYear();
    const y1 = new Date(hi).getUTCFullYear();
    const every = Math.max(1, Math.ceil((y1 - y0) / 8));
    for (let y = y0 + 1; y <= y1; y++) if (y % every === 0) out.push({ t: Date.UTC(y, 0, 1), label: String(y) });
  } else if (span > 60 * day) {
    const d = new Date(lo);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const months = span / (30 * day);
    const every = months > 18 ? 3 : months > 8 ? 2 : 1;
    while (t <= hi) {
      const m = new Date(t);
      if (m.getUTCMonth() % every === 0) out.push({ t, label: m.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + (m.getUTCMonth() === 0 ? ` ${m.getUTCFullYear()}` : '') });
      t = Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1);
    }
  } else {
    const every = span > 20 * day ? 7 : span > 8 * day ? 2 : 1;
    let t = Math.ceil(lo / day) * day;
    for (let i = 0; t <= hi; t += day, i++) {
      if (i % every === 0) out.push({ t, label: new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
    }
  }
  return out;
}

/**
 * Line chart over time.
 * @param {HTMLElement} host
 * @param {{
 *   series: {name: string, color: string, points: [number, number][], step?: boolean, dash?: string}[],
 *   yLog?: boolean, yMin?: number, yFormat: (v:number)=>string, yTickFormat?: (v:number)=>string,
 *   refLines?: {value: number, color: string, label: string}[],
 *   tooltip?: (t: number, values: {series, value, point}[]) => string,
 *   height?: number, xMin?: number, xMax?: number, yTicks?: number[], zeroLine?: boolean,
 * }} opts
 */
export function lineChart(host, opts) {
  host.innerHTML = '';
  const width = Math.max(320, host.clientWidth || 640);
  const height = opts.height ?? 280;
  const m = { top: 12, right: 16, bottom: 28, left: 56 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;
  const all = opts.series.flatMap((s) => s.points);
  if (!all.length) {
    host.innerHTML = '<p class="empty">No data for this selection yet.</p>';
    return;
  }
  const xMin = opts.xMin ?? Math.min(...all.map((p) => p[0]));
  const xMax = opts.xMax ?? Math.max(...all.map((p) => p[0]));
  const ys = all.map((p) => p[1]).filter(Number.isFinite).concat((opts.refLines ?? []).map((r) => r.value));
  let yMin = opts.yMin ?? Math.min(0, ...ys);
  let yMax = Math.max(...ys);
  if (opts.yLog) {
    yMin = Math.max(opts.yMin ?? 1e-9, Math.min(...ys.filter((v) => v > 0)));
    yMax = Math.max(yMax, yMin * 10);
  } else if (yMax === yMin) yMax = yMin + 1;
  const ly = (v) => Math.log10(v);
  const x = (t) => m.left + ((t - xMin) / (xMax - xMin || 1)) * w;
  const y = opts.yLog
    ? (v) => m.top + h - ((ly(Math.max(v, yMin)) - ly(yMin)) / (ly(yMax) - ly(yMin))) * h
    : (v) => m.top + h - ((v - yMin) / (yMax - yMin)) * h;

  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', class: 'chart' }, host);
  const grid = el('g', { class: 'grid' }, svg);
  const yTicks = opts.yTicks ?? (opts.yLog ? logTicks(yMin, yMax) : niceTicks(yMin, yMax));
  for (const v of yTicks) {
    if (v < yMin - 1e-9 || v > yMax + 1e-9) continue;
    el('line', { x1: m.left, x2: m.left + w, y1: y(v), y2: y(v) }, grid);
    const t = el('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, grid);
    t.textContent = (opts.yTickFormat ?? opts.yFormat)(v);
  }
  for (const { t, label } of timeTicks(xMin, xMax)) {
    const tx = el('text', { x: x(t), y: height - 8, 'text-anchor': 'middle', class: 'tick' }, grid);
    tx.textContent = label;
  }
  if (opts.zeroLine && yMin < 0) el('line', { x1: m.left, x2: m.left + w, y1: y(0), y2: y(0), class: 'zero' }, svg);

  for (const r of opts.refLines ?? []) {
    el('line', { x1: m.left, x2: m.left + w, y1: y(r.value), y2: y(r.value), stroke: r.color, class: 'ref' }, svg);
  }

  for (const s of opts.series) {
    let d = '';
    let pen = false;
    for (let i = 0; i < s.points.length; i++) {
      const [t, v] = s.points[i];
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      if (!pen) d += `M${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      else if (s.step) d += `H${x(t).toFixed(1)}V${y(v).toFixed(1)}`;
      else d += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    if (s.step && pen && s.extendTo) d += `H${x(s.extendTo).toFixed(1)}`;
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-dasharray': s.dash ?? '', 'stroke-linejoin': 'round', class: 'line' }, svg);
    for (const p of s.markers ?? []) {
      el('circle', { cx: x(p[0]), cy: y(p[1]), r: 4, fill: s.color, class: 'marker' }, svg);
    }
  }

  // Hover layer: a vertical crosshair and a tooltip with each series' value.
  const cross = el('line', { y1: m.top, y2: m.top + h, class: 'crosshair', visibility: 'hidden' }, svg);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  host.appendChild(tip);
  const overlay = el('rect', { x: m.left, y: m.top, width: w, height: h, fill: 'transparent' }, svg);
  const nearest = (pts, t) => {
    if (!pts.length) return null;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    return opts.stepLookup ? (pts[hi][0] <= t ? pts[hi] : pts[lo][0] <= t ? pts[lo] : null)
      : (Math.abs(pts[lo][0] - t) <= Math.abs(pts[hi][0] - t) ? pts[lo] : pts[hi]);
  };
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const t = xMin + ((px - m.left) / w) * (xMax - xMin);
    const vals = opts.series.map((s) => ({ series: s, point: nearest(s.points, t) }))
      .map((v) => ({ ...v, value: v.point?.[1] }));
    const snapT = opts.stepLookup ? t : vals.find((v) => v.point)?.point[0] ?? t;
    cross.setAttribute('x1', x(snapT));
    cross.setAttribute('x2', x(snapT));
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = opts.tooltip ? opts.tooltip(snapT, vals)
      : `<strong>${fmtDateTime(snapT)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? opts.yFormat(v.value) : '—'}</b></div>`).join('')}`;
    tip.hidden = false;
    const left = Math.min(Math.max(x(snapT) + 12, 0), width - tip.offsetWidth - 4);
    tip.style.left = `${left > x(snapT) ? left : x(snapT) - tip.offsetWidth - 12}px`;
    tip.style.top = `${m.top}px`;
  };
  overlay.addEventListener('pointermove', move);
  overlay.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });
}

function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    for (const mlt of [1, 2, 5]) {
      const v = mlt * 10 ** e;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return out.length > 7 ? out.filter((v) => Number(v.toPrecision(1)).toString().startsWith('1')) : out;
}

/**
 * Heatmap: rows x columns of values, coloured on a sequential ramp.
 * @param {{rows: string[], cols: string[], values: (number|null)[][], ramp: string[], format: (v)=>string, title: (r, c, v)=>string, max?: number, log?: boolean}} opts
 */
export function heatmap(host, opts) {
  host.innerHTML = '';
  const width = Math.max(320, host.clientWidth || 640);
  const m = { top: 8, right: 8, bottom: 26, left: 64 };
  const cw = (width - m.left - m.right) / opts.cols.length;
  const ch = 28;
  const height = m.top + m.bottom + ch * opts.rows.length;
  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', class: 'chart heatmap' }, host);
  const flat = opts.values.flat().filter((v) => v > 0);
  const max = opts.max ?? Math.max(1, ...flat);
  const scale = (v) => (opts.log ? Math.log(v) / Math.log(max) : v / max);
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  host.appendChild(tip);
  opts.rows.forEach((r, ri) => {
    const lbl = el('text', { x: m.left - 8, y: m.top + ri * ch + ch / 2 + 4, 'text-anchor': 'end', class: 'tick' }, svg);
    lbl.textContent = r;
    opts.cols.forEach((c, ci) => {
      const v = opts.values[ri][ci];
      const fill = v > 0 ? opts.ramp[Math.min(opts.ramp.length - 1, Math.max(0, Math.round(scale(v) * (opts.ramp.length - 1))))] : 'var(--cell-empty)';
      const cell = el('rect', { x: m.left + ci * cw + 1, y: m.top + ri * ch + 1, width: Math.max(1, cw - 2), height: ch - 2, rx: 3, fill, class: 'cell' }, svg);
      cell.addEventListener('pointerenter', () => {
        tip.innerHTML = opts.title(r, c, v);
        tip.hidden = false;
        const cx = m.left + ci * cw + cw / 2;
        tip.style.left = `${Math.min(Math.max(cx - tip.offsetWidth / 2, 0), width - tip.offsetWidth)}px`;
        tip.style.top = `${m.top + (ri + 1) * ch + 4}px`;
      });
      cell.addEventListener('pointerleave', () => { tip.hidden = true; });
    });
  });
  const every = Math.ceil(opts.cols.length / Math.floor((width - m.left) / 44));
  opts.cols.forEach((c, ci) => {
    if (ci % every) return;
    const t = el('text', { x: m.left + ci * cw + cw / 2, y: height - 8, 'text-anchor': 'middle', class: 'tick' }, svg);
    t.textContent = c;
  });
}
