// Aggregates the half-hourly data into the yearly and monthly figures behind
// the story charts. Pure functions so they can be tested in Node.

// Stack order for the mix chart, dirtiest at the bottom.
export const MIX = [
  { key: 'coal', label: 'Coal', columns: ['coal'] },
  { key: 'gas', label: 'Gas', columns: ['gas'] },
  { key: 'other', label: 'Other', columns: ['other'] },
  { key: 'imports', label: 'Imports', columns: ['imports'] },
  { key: 'biomass', label: 'Biomass', columns: ['biomass'] },
  { key: 'nuclear', label: 'Nuclear', columns: ['nuclear'] },
  { key: 'hydro', label: 'Hydro and pumped storage', columns: ['hydro', 'storage'] },
  { key: 'wind', label: 'Wind', columns: ['wind', 'wind_emb'] },
  { key: 'solar', label: 'Solar', columns: ['solar'] },
];

export const FOSSIL = ['gas', 'coal'];
export const LOW_CARBON = ['wind', 'wind_emb', 'solar', 'nuclear', 'hydro', 'storage'];
const ALL = MIX.flatMap((f) => f.columns);

const pos = (v) => (v > 0 ? v : 0);
const yearOf = (ms) => new Date(ms).getUTCFullYear();
const monthStart = (ms) => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

/** Sum of the listed columns at slot i, or NaN if any is missing. */
function sumAt(columns, names, i) {
  let v = 0;
  for (const n of names) {
    const c = columns[n];
    if (!c) continue;
    if (Number.isNaN(c[i])) return NaN;
    v += pos(c[i]);
  }
  return v;
}

/** Share of generation by fuel for each calendar year (UTC). */
export function yearlyMix(data) {
  const { columns, length, startMs } = data;
  const years = new Map();
  for (let i = 0; i < length; i++) {
    const total = sumAt(columns, ALL, i);
    if (!(total > 0)) continue;
    const y = yearOf(startMs + i * 18e5);
    let row = years.get(y);
    if (!row) years.set(y, (row = { year: y, total: 0, slots: 0, sums: Object.fromEntries(MIX.map((f) => [f.key, 0])) }));
    row.total += total;
    row.slots++;
    for (const f of MIX) row.sums[f.key] += sumAt(columns, f.columns, i);
  }
  return [...years.values()].map((r) => ({
    year: r.year,
    partial: r.slots < 17000,
    shares: Object.fromEntries(MIX.map((f) => [f.key, (r.sums[f.key] / r.total) * 100])),
  }));
}

/** Monthly share of generation for each named group: [[monthStartMs, pct], …] per group. */
export function monthlyShares(data, groups) {
  const { columns, length, startMs } = data;
  const out = Object.fromEntries(Object.keys(groups).map((k) => [k, []]));
  let month = null;
  let total = 0;
  let sums = {};
  const flush = () => {
    if (month != null && total > 0) for (const k of Object.keys(groups)) out[k].push([month, (sums[k] / total) * 100]);
  };
  for (let i = 0; i < length; i++) {
    const m = monthStart(startMs + i * 18e5);
    if (m !== month) {
      flush();
      month = m;
      total = 0;
      sums = Object.fromEntries(Object.keys(groups).map((k) => [k, 0]));
    }
    const t = sumAt(columns, ALL, i);
    if (!(t > 0)) continue;
    total += t;
    for (const [k, names] of Object.entries(groups)) sums[k] += sumAt(columns, names, i);
  }
  flush();
  return out;
}

/** Hours in each year with the group below each threshold (MW). */
export function yearlyHoursBelow(data, names, thresholdsMw) {
  const { columns, length, startMs } = data;
  const years = new Map();
  for (let i = 0; i < length; i++) {
    const v = sumAt(columns, names, i);
    if (Number.isNaN(v)) continue;
    const y = yearOf(startMs + i * 18e5);
    let row = years.get(y);
    if (!row) years.set(y, (row = { year: y, hours: thresholdsMw.map(() => 0) }));
    thresholdsMw.forEach((t, k) => { if (v < t) row.hours[k] += 0.5; });
  }
  return [...years.values()];
}

/** Highlights for the fact cards. */
export function facts(data) {
  const { columns, length } = data;
  let lastCoal = -1;
  let wind = { v: -1, i: -1 };
  let solar = { v: -1, i: -1 };
  let green = { v: -1, i: -1 };
  let fossil = { v: Infinity, i: -1 };
  for (let i = 0; i < length; i++) {
    // NESO still shows occasional small coal blips after Ratcliffe closed, so
    // count only output a real coal station would make.
    if (columns.coal[i] >= 200) lastCoal = i;
    const w = sumAt(columns, ['wind', 'wind_emb'], i);
    if (w > wind.v) wind = { v: w, i };
    if (columns.solar[i] > solar.v) solar = { v: columns.solar[i], i };
    const total = sumAt(columns, ALL, i);
    if (total > 10000) {
      const g = (sumAt(columns, LOW_CARBON, i) / total) * 100;
      if (g > green.v) green = { v: g, i };
    }
    const f = sumAt(columns, FOSSIL, i);
    if (f < fossil.v) fossil = { v: f, i };
  }
  return { lastCoal, wind, solar, green, fossil };
}
