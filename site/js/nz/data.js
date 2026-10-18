// New Zealand fuels, metric series and the yearly figures behind the NZ story.
// Pure functions, shared by the browser and the Node tests.

export const FUELS = {
  hydro: { label: 'Hydro', color: '--f-hydro', renewable: true },
  geothermal: { label: 'Geothermal', color: '--f-geo', renewable: true },
  wind: { label: 'Wind', color: '--f-wind', renewable: true },
  solar: { label: 'Solar', color: '--f-solar', renewable: true },
  bioenergy: { label: 'Wood and biogas', color: '--f-biomass', renewable: true },
  gas: { label: 'Gas', color: '--f-gas', fossil: true },
  coal: { label: 'Coal', color: '--f-coal', fossil: true },
  diesel: { label: 'Diesel', color: '--f-diesel', fossil: true },
  battery: { label: 'Battery discharge', color: '--f-battery' },
  other: { label: 'Other', color: '--f-other' },
};

export const FOSSIL = Object.keys(FUELS).filter((k) => FUELS[k].fossil);
export const RENEWABLE = Object.keys(FUELS).filter((k) => FUELS[k].renewable);
// Batteries only move energy in time, so they are left out of the total.
const GENERATION = Object.keys(FUELS).filter((k) => k !== 'battery');

const SLOT_H = 0.5;
const YEAR_SLOTS = 365 * 48;
// New Year in New Zealand always falls in daylight saving time, UTC+13.
const nzNewYear = (y) => Date.UTC(y, 0, 1) - 13 * 3600000;
const nzYear = (ms) => new Date(ms + 13 * 3600000).getUTCFullYear();

/** Sum of the listed columns at slot i, or NaN if any is missing. */
function sumAt(columns, names, i) {
  let v = 0;
  for (const n of names) {
    const c = columns[n];
    if (!c) continue;
    if (Number.isNaN(c[i])) return NaN;
    if (c[i] > 0) v += c[i];
  }
  return v;
}

let cachedTotal = null;
export function generationTotal(data) {
  if (cachedTotal?.data === data) return cachedTotal.total;
  const total = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(data.columns, GENERATION, i);
    total[i] = v > 0 ? v : NaN;
  }
  cachedTotal = { data, total };
  return total;
}

/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export function metricSeries(data, members, { unit = 'gw' } = {}) {
  const total = unit === 'pct' ? generationTotal(data) : null;
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(data.columns, members, i);
    out[i] = total ? (v / total[i]) * 100 : v / 1000;
  }
  return out;
}

/**
 * Groups slots by calendar year in NZ time, keeping only years the data
 * fully covers, plus a final "past365" bucket for the latest 365 days.
 */
function byYear(data, init, add) {
  const { length, startMs, columns } = data;
  const years = new Map();
  const rolling = { year: 'past365', ...init() };
  // The latest slot with data, so the rolling year ends where the data does.
  let end = length;
  while (end > 0 && Number.isNaN(columns.hydro[end - 1])) end--;
  // A year counts only if the data starts on or before its New Year.
  const firstYear = startMs <= nzNewYear(nzYear(startMs)) ? nzYear(startMs) : nzYear(startMs) + 1;
  const lastYear = nzYear(startMs + end * 18e5) - 1;
  let y = firstYear - 1;
  let nextYear = nzNewYear(y + 1);
  for (let i = 0; i < end; i++) {
    const t = startMs + i * 18e5;
    while (t >= nextYear) nextYear = nzNewYear(++y + 1);
    if (y >= firstYear && y <= lastYear) {
      let row = years.get(y);
      if (!row) years.set(y, (row = { year: y, ...init() }));
      add(row, i);
    }
    if (i >= end - YEAR_SLOTS) add(rolling, i);
  }
  const rows = [...years.values()];
  if (end >= YEAR_SLOTS) rows.push(rolling);
  return rows;
}

/** TWh by fuel for each year, with the renewable share. */
export function yearlyEnergy(data) {
  return byYear(data, () => ({ twh: Object.fromEntries(Object.keys(FUELS).map((k) => [k, 0])), slots: 0, gaps: 0 }), (row, i) => {
    const t = sumAt(data.columns, GENERATION, i);
    if (!(t > 0)) { row.gaps++; return; }
    row.slots++;
    for (const k of Object.keys(FUELS)) {
      const v = data.columns[k]?.[i];
      if (v > 0) row.twh[k] += (v * SLOT_H) / 1e6;
    }
  }).map((r) => {
    const total = GENERATION.reduce((s, k) => s + r.twh[k], 0);
    const renewable = RENEWABLE.reduce((s, k) => s + r.twh[k], 0);
    const fossil = FOSSIL.reduce((s, k) => s + r.twh[k], 0);
    return { year: r.year, twh: r.twh, total, renewable, fossil, renewablePct: total ? (renewable / total) * 100 : NaN, coverage: r.slots / (r.slots + r.gaps) };
  });
}

/** Hours in each year with fossil generation below each threshold (MW). */
export function yearlyHoursBelow(data, names, thresholdsMw) {
  return byYear(data, () => ({ hours: thresholdsMw.map(() => 0) }), (row, i) => {
    const v = sumAt(data.columns, names, i);
    if (Number.isNaN(v)) return;
    thresholdsMw.forEach((t, k) => { if (v < t) row.hours[k] += SLOT_H; });
  });
}

/** Mean MW per fuel over the last n slots that have data, and the slot range used. */
export function recentMix(data, n) {
  let end = data.length;
  while (end > 0 && Number.isNaN(data.columns.hydro[end - 1])) end--;
  const start = Math.max(0, end - n);
  const means = {};
  for (const k of Object.keys(FUELS)) {
    const c = data.columns[k];
    let s = 0;
    let m = 0;
    for (let i = start; i < end; i++) if (c && !Number.isNaN(c[i])) { s += Math.max(0, c[i]); m++; }
    means[k] = m ? s / m : 0;
  }
  const total = GENERATION.reduce((s, k) => s + means[k], 0);
  const renewable = RENEWABLE.reduce((s, k) => s + means[k], 0);
  return { start, end, means, total, renewablePct: total ? (renewable / total) * 100 : NaN };
}

/** The greenest and least-fossil half hours, and the last half hour with no fossil output at all. */
export function highlights(data) {
  const total = generationTotal(data);
  let green = { v: -1, i: -1 };
  let lastZero = -1;
  let wind = { v: -1, i: -1 };
  let solar = { v: -1, i: -1 };
  for (let i = 0; i < data.length; i++) {
    if (!(total[i] > 0)) continue;
    const r = (sumAt(data.columns, RENEWABLE, i) / total[i]) * 100;
    if (r > green.v) green = { v: r, i };
    if (sumAt(data.columns, FOSSIL, i) === 0) lastZero = i;
    if (data.columns.wind[i] > wind.v) wind = { v: data.columns.wind[i], i };
    if (data.columns.solar[i] > solar.v) solar = { v: data.columns.solar[i], i };
  }
  return { green, lastZero, wind, solar };
}
