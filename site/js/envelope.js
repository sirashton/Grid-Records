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
