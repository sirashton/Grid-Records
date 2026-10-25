// The United States (lower 48) from EIA-930, the Hourly Electric Grid
// Monitor: every balancing authority's hourly net generation by energy
// source, demand and interchange, from July 2018. EIA publishes the whole
// form as six-month CSV files (EIA930_BALANCE_YYYY_Jan_Jun.csv and _Jul_Dec)
// at www.eia.gov/electricity/gridmonitor/sixMonthFiles/, refreshed daily
// and free of any key. The current file runs to about a day ago.
//
// One row per balancing authority per hour, stamped "UTC Time at End of Hour".
// Each value comes raw, imputed and adjusted; the adjusted series is EIA's
// cleaned one (gaps and outliers filled), so it is preferred and the raw
// value is the fallback. Summing every balancing authority gives the lower
// 48, as EIA's own US48 totals do: flows between them cancel, and what is
// left of interchange is the net flow with Canada and Mexico.
//
// The fuel headings changed over the years: hydro and pumped storage were
// one column until EIA split them, and battery storage and geothermal came
// out of "Other" later still. A column a file doesn't have is left missing
// for that half-year rather than set to zero.

export const BASE = 'https://www.eia.gov/electricity/gridmonitor/sixMonthFiles';
export const PARSE_VERSION = 4;
export const HOUR_MS = 3600000;

// Heading (after "Net Generation (MW) from ") to dataset column. Several
// headings can add into one column.
const FUELS = {
  Coal: 'coal',
  'Natural Gas': 'gas',
  Nuclear: 'nuclear',
  'All Petroleum Products': 'oil',
  'Hydropower and Pumped Storage': 'hydro',
  'Hydropower Excluding Pumped Storage': 'hydro',
  'Pumped Storage': 'pumped_storage',
  Solar: 'solar',
  'Solar without Integrated Battery Storage': 'solar',
  'Solar with Integrated Battery Storage': 'solar',
  Wind: 'wind',
  'Wind without Integrated Battery Storage': 'wind',
  'Wind with Integrated Battery Storage': 'wind',
  'Battery Storage': 'battery',
  'Other Energy Storage': 'other',
  'Unknown Energy Storage': 'other',
  Geothermal: 'geothermal',
  'Other Fuel Sources': 'other',
  'Unknown Fuel Sources': 'other',
};
export const GEN_COLUMNS = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'pumped_storage', 'wind', 'solar', 'geothermal', 'battery', 'other'];
export const US_COLUMNS = [...GEN_COLUMNS, 'pumped_storage_charge', 'battery_charge', 'imports', 'exports', 'demand'];
// Storage reads negative while charging: that part goes to its own column,
// worked out balancing authority by balancing authority so one charging
// battery doesn't cancel another one discharging.
const CHARGE = { battery: 'battery_charge', pumped_storage: 'pumped_storage_charge' };
// Solar, wind and other read slightly negative at night (the plants' own
// use); those are counted as zero.
const NON_NEGATIVE = new Set(['solar', 'wind', 'other', 'coal', 'gas', 'oil', 'nuclear', 'geothermal']);

/** Half-years from 2018 H2 to the one holding nowMs, newest first: '2026H2', '2026H1', ... */
export function halfList(nowMs, from = '2018H2') {
  const d = new Date(nowMs);
  let y = d.getUTCFullYear();
  let h = d.getUTCMonth() < 6 ? 1 : 2;
  const out = [];
  for (;;) {
    const key = `${y}H${h}`;
    out.push(key);
    if (key === from) return out;
    if (h === 2) h = 1;
    else { h = 2; y--; }
    if (y < 2015) return out;
  }
}

/** The file name, first hour (UTC, hour beginning) and hour count of a half-year. */
export function halfInfo(key) {
  const y = Number(key.slice(0, 4));
  const h = Number(key.slice(5));
  const startMs = Date.UTC(y, h === 1 ? 0 : 6, 1);
  const endMs = Date.UTC(h === 1 ? y : y + 1, h === 1 ? 6 : 0, 1);
  return { file: `EIA930_BALANCE_${y}_${h === 1 ? 'Jan_Jun' : 'Jul_Dec'}.csv`, startMs, length: (endMs - startMs) / HOUR_MS };
}

/** Splits one CSV line, honouring quotes. */
export function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "10/24/2026 3:00:00 AM" (UTC) to milliseconds. */
export function parseUtc(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/);
  if (!m) return NaN;
  let h = Number(m[4]) % 12;
  if (m[7] === 'PM') h += 12;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
}

const num = (s) => {
  if (s === undefined || s === '') return null;
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

// Each file holds its half-year by local date, so its first and last UTC
// hours spill a few hours over the boundary, and the hours next to it come
// partly from each file. A piece's grid runs a day either side of its half,
// and the builder adds pieces together rather than laying one over another.
export const MARGIN_HOURS = 24;

// Each balancing authority is cleaned on its own before they are summed. A
// gap of a few hours is filled in a straight line between the hours either
// side, so one late report doesn't knock a 30 GW hole in the national total.
// A single hour that jumps away from both neighbours by a large share of the
// balancing authority's usual output, and straight back, is a bad reading
// and takes the mean of its neighbours. Storage, hydro and oil can really
// run for a single hour, so they are left as reported.
export const FILL_HOURS = 6;
const DESPIKE = ['coal', 'gas', 'nuclear', 'wind', 'solar', 'geothermal', 'other', 'demand', 'gen'];
const SPIKE_SHARE = 0.25;
const SPIKE_MIN_MW = 300;

function fillGaps(a, maxGap = FILL_HOURS) {
  let last = -1;
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i])) continue;
    const gap = i - last - 1;
    if (last >= 0 && gap > 0 && gap <= maxGap) {
      for (let k = 1; k <= gap; k++) a[last + k] = a[last] + ((a[i] - a[last]) * k) / (gap + 1);
    }
    last = i;
  }
}

function despike(a) {
  const abs = [];
  for (const v of a) if (!Number.isNaN(v)) abs.push(Math.abs(v));
  if (abs.length < 48) return 0;
  abs.sort((x, y) => x - y);
  const limit = Math.max(SPIKE_MIN_MW, SPIKE_SHARE * abs[Math.floor(abs.length * 0.99)]);
  let n = 0;
  for (let i = 1; i + 1 < a.length; i++) {
    const up = a[i] - a[i - 1];
    const down = a[i] - a[i + 1];
    if (Math.sign(up) === Math.sign(down) && Math.min(Math.abs(up), Math.abs(down)) > limit) {
      a[i] = (a[i - 1] + a[i + 1]) / 2;
      n++;
    }
  }
  return n;
}

/**
 * One half-year file's text, cleaned balancing authority by balancing
 * authority and summed onto an hour-beginning UTC grid: { startMs, length,
 * core, columns, ti, reporting, fuels, bas, hours, spikes }. Slots no row
 * reached are null. `reporting` is, per hour, the usual output (MW) of the
 * balancing authorities with a net generation figure, so a large one missing
 * counts for more than a small one; `ti` is the summed total interchange;
 * `core` is [first slot, slot count] of the half-year itself.
 */
export function parseHalf(key, text) {
  const half = halfInfo(key);
  const startMs = half.startMs - MARGIN_HOURS * HOUR_MS;
  const length = half.length + 2 * MARGIN_HOURS;
  const lines = text.split(/\r?\n/);
  const head = splitCsv(lines[0]);
  const at = (name) => head.indexOf(name);
  const pick = (base) => {
    const adj = at(`${base} (Adjusted)`) >= 0 ? at(`${base} (Adjusted)`) : at(`${base}  (Adjusted)`);
    return { adj, raw: at(base) };
  };
  const iBa = at('Balancing Authority');
  const iUtc = at('UTC Time at End of Hour');
  const fuel = [];
  for (const [label, col] of Object.entries(FUELS)) {
    const p = pick(`Net Generation (MW) from ${label}`);
    if (p.raw >= 0 || p.adj >= 0) fuel.push({ col, ...p });
  }
  const totals = { gen: pick('Net Generation (MW)'), demand: pick('Demand (MW)'), ti: pick('Total Interchange (MW)') };
  const present = new Set(fuel.map((f) => f.col));
  const fields = [...new Set(fuel.map((f) => f.col)), 'gen', 'demand', 'ti'];
  const value = (r, p) => (p.adj >= 0 && num(r[p.adj]) != null ? num(r[p.adj]) : p.raw >= 0 ? num(r[p.raw]) : null);

  // Per balancing authority, one array per field. A repeated row for the
  // same hour replaces the earlier one rather than adding to it.
  const perBa = new Map();
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const r = splitCsv(line);
    const i = Math.round((parseUtc(r[iUtc]) - HOUR_MS - startMs) / HOUR_MS);
    if (!(i >= 0 && i < length)) continue;
    let ba = perBa.get(r[iBa]);
    if (!ba) {
      ba = Object.fromEntries(fields.map((f) => [f, new Float32Array(length).fill(NaN)]));
      perBa.set(r[iBa], ba);
    }
    for (const t of ['gen', 'demand', 'ti']) {
      const v = value(r, totals[t]);
      ba[t][i] = v ?? NaN;
    }
    const sums = {};
    for (const f of fuel) {
      const v = value(r, f);
      if (v != null) sums[f.col] = (sums[f.col] ?? 0) + v;
    }
    for (const c of present) ba[c][i] = sums[c] ?? NaN;
  }

  const columns = Object.fromEntries(US_COLUMNS.map((c) => [c, Array(length).fill(null)]));
  const ti = Array(length).fill(null);
  const reporting = new Float64Array(length);
  const add = (arr, i, v) => { arr[i] = (arr[i] ?? 0) + v; };
  let spikes = 0;
  for (const ba of perBa.values()) {
    for (const f of fields) {
      fillGaps(ba[f]);
      if (DESPIKE.includes(f)) spikes += despike(ba[f]);
    }
    let sum = 0;
    let n = 0;
    for (const v of ba.gen) if (!Number.isNaN(v)) { sum += Math.max(0, v); n++; }
    const weight = n ? Math.max(1, sum / n) : 0;
    for (let i = 0; i < length; i++) {
      if (!Number.isNaN(ba.gen[i])) reporting[i] += weight;
      if (!Number.isNaN(ba.demand[i])) add(columns.demand, i, ba.demand[i]);
      if (!Number.isNaN(ba.ti[i])) add(ti, i, ba.ti[i]);
      for (const c of present) {
        let v = ba[c][i];
        if (Number.isNaN(v)) continue;
        if (v < 0 && CHARGE[c]) {
          add(columns[CHARGE[c]], i, v);
          v = 0;
        }
        if (v < 0 && NON_NEGATIVE.has(c)) v = 0;
        add(columns[c], i, v);
      }
    }
  }
  for (const [c, charge] of Object.entries(CHARGE)) if (present.has(c)) present.add(charge);
  let hours = 0;
  for (let i = 0; i < length; i++) if (reporting[i]) hours++;
  const round = (a) => a.map((v) => (v == null ? null : Math.round(v)));
  return {
    startMs,
    length,
    core: [MARGIN_HOURS, half.length],
    columns: Object.fromEntries(Object.entries(columns).map(([c, a]) => [c, round(a)])),
    ti: round(ti),
    reporting: [...reporting].map(Math.round),
    bas: perBa.size,
    hours,
    spikes,
    fuels: [...present],
  };
}

/**
 * Adds half-year pieces into one hourly grid, then keeps only the hours
 * enough balancing authorities reported (by usual output, at least
 * `minShare` of the most in that half-year). In a kept hour a fuel its half-year reports reads zero
 * where nobody had any, and interchange left over after flows between
 * balancing authorities cancel is the net flow with Canada and Mexico.
 */
export function addHalves(pieces, minShare = 0.97) {
  const ps = pieces.filter((p) => p && p.length).sort((a, b) => a.startMs - b.startMs);
  if (!ps.length) return null;
  const startMs = ps[0].startMs;
  const length = Math.max(...ps.map((p) => Math.round((p.startMs - startMs) / HOUR_MS) + p.length));
  const columns = Object.fromEntries(US_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]));
  const ti = new Float64Array(length).fill(NaN);
  const reporting = new Float64Array(length);
  const owner = new Array(length).fill(null);
  const most = new Map(ps.map((p) => [p, Math.max(...p.reporting)]));
  const add = (arr, i, v) => { if (v != null) arr[i] = Number.isNaN(arr[i]) ? v : arr[i] + v; };
  for (const p of ps) {
    const base = Math.round((p.startMs - startMs) / HOUR_MS);
    for (let k = 0; k < p.length; k++) {
      const i = base + k;
      reporting[i] += p.reporting[k];
      add(ti, i, p.ti[k]);
      for (const c of US_COLUMNS) add(columns[c], i, p.columns[c]?.[k]);
    }
    for (let k = p.core[0]; k < p.core[0] + p.core[1]; k++) owner[base + k] = p;
  }
  let dropped = 0;
  for (let i = 0; i < length; i++) {
    const p = owner[i];
    if (!p || !reporting[i] || reporting[i] < minShare * most.get(p)) {
      if (reporting[i]) dropped++;
      for (const c of US_COLUMNS) columns[c][i] = NaN;
      continue;
    }
    for (const c of p.fuels) if (Number.isNaN(columns[c][i])) columns[c][i] = 0;
    if (!Number.isNaN(ti[i])) {
      columns.imports[i] = Math.max(0, -ti[i]);
      columns.exports[i] = ti[i] > 0 ? -ti[i] : 0;
    }
  }
  return { startMs, length, columns, dropped };
}

/** Downloads one half-year file as text. */
export async function fetchHalf(key, timeoutMs = 180000) {
  const url = `${BASE}/${halfInfo(key).file}`;
  const res = await fetch(url, { headers: { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
