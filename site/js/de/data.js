// Germany's fuels, metric series and the yearly figures behind the story.
// Pure functions, shared by the browser and the Node tests.

export const FUELS = {
  lignite: { label: 'Lignite', color: '--f-lignite', fossil: true, coal: true },
  hardcoal: { label: 'Hard coal', color: '--f-coal', fossil: true, coal: true },
  gas: { label: 'Gas', color: '--f-gas', fossil: true },
  oil: { label: 'Oil and other', color: '--f-diesel', fossil: true },
  nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
  wind_on: { label: 'Onshore wind', color: '--f-wind', renewable: true, wind: true },
  wind_off: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, wind: true },
  solar: { label: 'Solar', color: '--f-solar', renewable: true },
  hydro: { label: 'Hydro', color: '--f-hydro', renewable: true },
  biomass: { label: 'Biomass', color: '--f-biomass', renewable: true },
  other: { label: 'Waste and other', color: '--f-other' },
  pumped: { label: 'Pumped storage', color: '--f-hydro-2', storage: true },
  imports: { label: 'Net imports', color: '--f-imports', notGeneration: true },
  // Taking power off the grid: measures on their own, never in a group total.
  pumped_chg: { label: 'Pumping', color: '--f-hydro-2', notGeneration: true },
  exports: { label: 'Net exports', color: '--f-imports', notGeneration: true },
};

export const FOSSIL = Object.keys(FUELS).filter((k) => FUELS[k].fossil);
export const RENEWABLE = Object.keys(FUELS).filter((k) => FUELS[k].renewable);
export const LOW_CARBON = [...RENEWABLE, 'nuclear'];
export const COAL = ['lignite', 'hardcoal'];
export const WIND = ['wind_on', 'wind_off'];
// German generation: everything made in Germany, pumped storage included,
// imports not.
export const GENERATION = Object.keys(FUELS).filter((k) => !FUELS[k].notGeneration);

const SLOT_H = 0.5;
const YEAR_SLOTS = 365 * 48;
// New Year in Germany always falls in winter time, UTC+1.
const deNewYear = (y) => Date.UTC(y, 0, 1) - 3600000;
const deYear = (ms) => new Date(ms + 3600000).getUTCFullYear();

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
 * Groups slots by calendar year in German time, keeping only years the data
 * fully covers, plus a final "past365" bucket for the latest 365 days.
 */
function byYear(data, init, add) {
  const { length, startMs, columns } = data;
  const years = new Map();
  const rolling = { year: 'past365', ...init() };
  // The latest slot with data, so the rolling year ends where the data does.
  let end = length;
  while (end > 0 && Number.isNaN(columns.lignite[end - 1])) end--;
  // A year counts only if the data starts on or before its New Year.
  // Energy-Charts starts at midnight UTC on 1 January 2015, an hour after
  // New Year in Germany, so a year missing only its first hour still counts.
  const firstYear = startMs <= deNewYear(deYear(startMs)) + 3600000 ? deYear(startMs) : deYear(startMs) + 1;
  const lastYear = deYear(startMs + end * 18e5) - 1;
  let y = firstYear - 1;
  let nextYear = deNewYear(y + 1);
  for (let i = 0; i < end; i++) {
    const t = startMs + i * 18e5;
    while (t >= nextYear) nextYear = deNewYear(++y + 1);
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
    const w = data.columns.wind_on[i] + data.columns.wind_off[i];
    if (w > wind.v) wind = { v: w, i };
    if (data.columns.solar[i] > solar.v) solar = { v: data.columns.solar[i], i };
  }
  return { green, lastZero, wind, solar };
}

/**
 * GWh by fuel for each German calendar day of the latest n whole days before
 * slot end, with the generation total: { date: 'YYYY-MM-DD', total, [fuel] }.
 */
export function dailyEnergy(data, end, n = 365) {
  const { startMs, columns } = data;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Map();
  let hour = -1;
  let date = '';
  for (let i = Math.max(0, end - (n + 2) * 48); i < end; i++) {
    const t = startMs + i * 18e5;
    if (Math.floor(t / 36e5) !== hour) { hour = Math.floor(t / 36e5); date = fmt.format(t); }
    const row = days.get(date) ?? days.set(date, { date, total: 0, slots: 0 }).get(date);
    row.slots++;
    for (const k of GENERATION) {
      const v = columns[k]?.[i];
      if (v > 0) { row[k] = (row[k] ?? 0) + (v * SLOT_H) / 1000; row.total += (v * SLOT_H) / 1000; }
    }
  }
  // Whole days only: 46 to 50 half hours, as daylight saving changes allow.
  return [...days.values()].filter((d) => d.slots >= 46).slice(-n);
}
