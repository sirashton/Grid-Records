// Rolling envelope of a half-hourly series: the typical daily low and high.
// Each slot's low (high) is the minimum (maximum) over the 24 hours centred on
// it; those are then averaged over a centred window of `smoothDays` days.

const DAY = 48;

/** Centred rolling minimum or maximum over `w` slots, skipping NaN. */
function rollingExtreme(values, w, isMin) {
  const n = values.length;
  const out = new Float64Array(n).fill(NaN);
  const half = Math.floor(w / 2);
  const dq = [];
  let head = 0;
  const better = (a, b) => (isMin ? a <= b : a >= b);
  for (let j = 0; j < n + half; j++) {
    if (j < n && !Number.isNaN(values[j])) {
      while (dq.length > head && better(values[j], values[dq[dq.length - 1]])) dq.pop();
      dq.push(j);
    }
    const i = j - half;
    if (i < 0) continue;
    while (dq.length > head && dq[head] < i - half) head++;
    if (dq.length > head) out[i] = values[dq[head]];
  }
  return out;
}

/** Centred rolling mean over `w` slots, skipping NaN. */
function rollingMean(values, w) {
  const n = values.length;
  const sum = new Float64Array(n + 1);
  const cnt = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = !Number.isNaN(values[i]);
    sum[i + 1] = sum[i] + (ok ? values[i] : 0);
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0);
  }
  const half = Math.floor(w / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const c = cnt[b] - cnt[a];
    out[i] = c ? (sum[b] - sum[a]) / c : NaN;
  }
  return out;
}

/** { low, high }: Float64Arrays the same length as values. */
export function envelope(values, smoothDays = 0) {
  let low = rollingExtreme(values, DAY, true);
  let high = rollingExtreme(values, DAY, false);
  if (smoothDays > 1) {
    low = rollingMean(low, smoothDays * DAY);
    high = rollingMean(high, smoothDays * DAY);
  }
  return { low, high };
}
