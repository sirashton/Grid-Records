// Rolling envelopes of a series, for the "measure over time" chart. For each
// point, a centred window of `w` points gives a 100% band (the minimum and
// maximum, so the line never leaves it) and a 99% band (the 0.5th and 99.5th
// percentiles, which ignores the rare spikes).

/** Index of the first element of sorted `arr` that is >= v. */
function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linearly interpolated quantile q of a sorted array. */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const a = Math.floor(pos);
  const b = Math.min(sorted.length - 1, a + 1);
  return sorted[a] + (sorted[b] - sorted[a]) * (pos - a);
}

/**
 * { min, max, lo, hi }: Float64Arrays the same length as values. Missing
 * values (NaN) are skipped; a window with none left gives NaN.
 */
export function envelopes(values, w, q = 0.005) {
  const n = values.length;
  const half = Math.floor(w / 2);
  const out = { min: new Float64Array(n), max: new Float64Array(n), lo: new Float64Array(n), hi: new Float64Array(n) };
  // The window's values kept sorted as it slides.
  const win = [];
  const ok = (j) => j >= 0 && j < n && !Number.isNaN(values[j]);
  for (let j = 0; j < Math.min(n, half); j++) if (ok(j)) win.splice(lowerBound(win, values[j]), 0, values[j]);
  for (let i = 0; i < n; i++) {
    const enter = i + half;
    if (ok(enter)) win.splice(lowerBound(win, values[enter]), 0, values[enter]);
    const leave = i - half - 1;
    if (ok(leave)) win.splice(lowerBound(win, values[leave]), 1);
    if (!win.length) {
      out.min[i] = out.max[i] = out.lo[i] = out.hi[i] = NaN;
      continue;
    }
    out.min[i] = win[0];
    out.max[i] = win[win.length - 1];
    out.lo[i] = quantile(win, q);
    out.hi[i] = quantile(win, 1 - q);
  }
  return out;
}

/**
 * Envelopes of the underlying half hours for a chart that plots coarser
 * points (such as daily means): for each centre index into `values`, the
 * window centre ± half. Values are counted into `bins` buckets as the window
 * slides, so long windows stay fast. min and lo round down to their bucket's
 * lower edge and max and hi up to its upper edge, so the 100% band always
 * contains every value. Same { min, max, lo, hi } as envelopes, one per centre.
 */
export function windowEnvelopes(values, centres, half, q = 0.005, bins = 4000) {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
  const m = centres.length;
  const out = { min: new Float64Array(m).fill(NaN), max: new Float64Array(m).fill(NaN), lo: new Float64Array(m).fill(NaN), hi: new Float64Array(m).fill(NaN) };
  if (!(vmax >= vmin)) return out;
  const width = (vmax - vmin) / bins || 1;
  const bin = (v) => Math.min(bins - 1, Math.floor((v - vmin) / width));
  const hist = new Int32Array(bins);
  let count = 0;
  const add = (j, d) => {
    const v = values[j];
    if (Number.isFinite(v)) { hist[bin(v)] += d; count += d; }
  };
  let a = 0;
  let b = 0; // window is [a, b)
  for (let k = 0; k < m; k++) {
    const from = Math.max(0, centres[k] - half);
    const to = Math.min(values.length, centres[k] + half + 1);
    while (b < to) add(b++, 1);
    while (a < from) add(a++, -1);
    if (!count) continue;
    const need = Math.max(1, Math.ceil(count * q));
    let seen = 0;
    for (let i = 0; i < bins; i++) {
      if (!hist[i]) continue;
      if (seen === 0) out.min[k] = vmin + i * width;
      seen += hist[i];
      if (seen >= need) { out.lo[k] = vmin + i * width; break; }
    }
    seen = 0;
    for (let i = bins - 1; i >= 0; i--) {
      if (!hist[i]) continue;
      if (seen === 0) out.max[k] = vmin + (i + 1) * width;
      seen += hist[i];
      if (seen >= need) { out.hi[k] = vmin + (i + 1) * width; break; }
    }
  }
  return out;
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/** The line, its two envelope bands and their edges, as lineChart series and bands. */
export function envelopeLayers(raw, env, name) {
  const edge = (arr) => raw.map(([t], i) => [t, arr[i]]);
  const [min, max, lo, hi] = ['min', 'max', 'lo', 'hi'].map((k) => edge(env[k]));
  const color = css('--s2');
  const ink = css('--fossil-ink');
  return {
    series: [
      { name, color, points: raw, width: 1.2, opacity: 0.35 },
      { name: '100% band, high', color: ink, points: max, width: 1, opacity: 0.55 },
      { name: '99% band, high', color: ink, points: hi, width: 2 },
      { name: '99% band, low', color: ink, points: lo, width: 2 },
      { name: '100% band, low', color: ink, points: min, width: 1, opacity: 0.55 },
    ],
    bands: [
      { lower: min, upper: max, color, opacity: 0.12 },
      { lower: lo, upper: hi, color, opacity: 0.2 },
    ],
  };
}
