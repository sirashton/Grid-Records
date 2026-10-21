// Colombia: XM, the operator of the national grid (SIN) and its market.
// XM's public API (servapibi.xm.com.co, no key) gives the net generation of
// every plant each hour since 2000 ("Gene" by Recurso, kWh), up to 31 days per
// request. Plants are classified by XM's resource list (type and energy
// source) and, for thermal plants, by the fuel XM says they burned that hour
// ("ConsCombustibleMBTU" by Recurso, from about 2005), so a gas plant running
// on diesel during a gas shortage counts as oil.
//
// Hours: Hour01 is 00:00 to 01:00 Colombia time (UTC-5, no daylight saving).

export const API = 'https://servapibi.xm.com.co';
export const CO_COLUMNS = ['hydro', 'coal', 'gas', 'oil', 'biomass', 'wind', 'solar', 'other'];
export const PARSE_VERSION = 1;
const HOUR_MS = 3600000;
const UTC_OFFSET_H = 5;

// Retired plants that XM's resource list no longer has, for the hours before
// XM published their fuel use. Termoflores II and III (Barranquilla) burned
// gas: XM's fuel data for them from 2005 shows gas only.
export const RETIRED = { TFL2: 'gas', TFL3: 'gas' };

/** Grid column for one of XM's fuel or energy-source names. */
export function fuelColumn(name) {
  const s = String(name ?? '').toUpperCase();
  if (/BIOGAS|BAGAZO|BIOMASA|CASCARILLA|RESIDUO|MADERA/.test(s)) return 'biomass';
  if (/CARB/.test(s)) return 'coal';
  if (/GAS|GLP/.test(s)) return 'gas';
  if (/ACPM|COMBUST|JET|DIESEL|FUEL|QUEROS|KEROS|CRUDO|OIL|MEZCLA|NAFTA/.test(s)) return 'oil';
  if (/AGUA/.test(s)) return 'hydro';
  if (/VIENTO/.test(s)) return 'wind';
  if (/SOLAR/.test(s)) return 'solar';
  return null;
}

/** Column for a plant in XM's resource list: { Type, EnerSource }. */
export function plantColumn(plant) {
  if (!plant) return null;
  const type = String(plant.Type ?? '').toUpperCase();
  if (type.startsWith('HIDRA')) return 'hydro';
  if (type.startsWith('EOLIC')) return 'wind';
  if (type.startsWith('SOLAR')) return 'solar';
  return fuelColumn(plant.EnerSource) ?? 'other';
}

/** The entities of an XM API answer, each with its date: [{ date, ...Values }]. */
export function entities(json) {
  return (json?.Items ?? []).flatMap((item) => (item.ListEntities ?? item.HourlyEntities ?? item.DailyEntities ?? [])
    .map((e) => ({ date: item.Date, ...(e.Values ?? e) })));
}

/** XM's resource list as a Map of code to { Type, EnerSource, Name }. */
export const plantMap = (json) => new Map(entities(json).map((v) => [v.Code, v]));

export const hourKeys = Array.from({ length: 24 }, (_, h) => `Hour${String(h + 1).padStart(2, '0')}`);
const num = (s) => (s === '' || s == null ? null : Number(s));

/** UTC start of a Colombian day (YYYY-MM-DD). */
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`) + UTC_OFFSET_H * HOUR_MS;

/** First and last day (YYYY-MM-DD) of month YYYYMM. */
export function monthRange(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4)) - 1;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const mm = String(m + 1).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}`, days: last };
}

/**
 * One month of generation onto Colombia's hourly grid, as average MW by fuel.
 * gene: the "Gene" by Recurso answer; fuel: the "ConsCombustibleMBTU" by
 * Recurso answer (may be empty); plants: plantMap of the resource list.
 * A day with no plants reported is missing; a plant's blank hour counts as 0.
 * Thermal output is split by the fuels burned that hour where XM reports
 * them, otherwise by the plant's listed energy source. Returns
 * { startMs, length, columns, unknown: [code: MWh] }.
 */
export function parseMonth(ym, gene, fuel, plants) {
  const { start, days } = monthRange(ym);
  const startMs = dayStartMs(start);
  const length = days * 24;
  const columns = Object.fromEntries(CO_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  const slot = (date, h) => Math.round((dayStartMs(date.slice(0, 10)) - startMs) / HOUR_MS) + h;

  // Fuel burned by each plant each hour: code -> slot -> { column: MBTU }.
  const burned = new Map();
  for (const row of entities(fuel)) {
    const col = fuelColumn(row.Name);
    if (!col || !row.code) continue;
    for (let h = 0; h < 24; h++) {
      const v = num(row[hourKeys[h]]);
      if (!(v > 0)) continue;
      const i = slot(row.date, h);
      if (!burned.has(row.code)) burned.set(row.code, new Map());
      const by = burned.get(row.code);
      const cell = by.get(i) ?? {};
      cell[col] = (cell[col] ?? 0) + v;
      by.set(i, cell);
    }
  }

  const unknown = {};
  const seenDays = new Set();
  for (const row of entities(gene)) {
    if (!row.code) continue;
    const base = slot(row.date, 0);
    if (base < 0 || base >= length) continue;
    seenDays.add(base);
    for (let h = 0; h < 24; h++) if (columns.hydro[base + h] == null) for (const c of CO_COLUMNS) columns[c][base + h] = 0;
    const listed = plantColumn(plants.get(row.code));
    const fixed = listed ?? RETIRED[row.code] ?? null;
    const fuels = burned.get(row.code);
    for (let h = 0; h < 24; h++) {
      const kwh = num(row[hourKeys[h]]);
      if (!kwh) continue;
      const mw = kwh / 1000;
      const i = base + h;
      const thermal = !fixed || !['hydro', 'wind', 'solar'].includes(fixed);
      const mix = thermal ? fuels?.get(i) : null;
      if (mix) {
        const total = Object.values(mix).reduce((a, b) => a + b, 0);
        for (const [c, v] of Object.entries(mix)) columns[c][i] += (mw * v) / total;
      } else if (fixed) {
        columns[fixed][i] += mw;
      } else {
        columns.other[i] += mw;
        unknown[row.code] = (unknown[row.code] ?? 0) + mw;
      }
    }
  }
  // XM reports a plant's own use as small negative net output now and then.
  for (const c of CO_COLUMNS) for (let i = 0; i < length; i++) if (columns[c][i] != null && columns[c][i] < 0) columns[c][i] = 0;
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  for (const c of CO_COLUMNS) columns[c] = columns[c].map(round);
  return { startMs, length, columns, days: seenDays.size, unknown: Object.entries(unknown).map(([k, v]) => [k, Math.round(v)]) };
}

/** POSTs one query to the XM API, retrying a few times. */
export async function query(path, body, { retries = 4, timeoutMs = 120000 } = {}) {
  let err;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API}/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw err;
}

/** The answers parseMonth needs for month YYYYMM. */
export async function fetchMonth(ym) {
  const { start, end } = monthRange(ym);
  const ask = (MetricId) => query('hourly', { MetricId, StartDate: start, EndDate: end, Entity: 'Recurso', Filter: [] });
  const gene = await ask('Gene');
  const fuel = Number(ym) >= 200401 ? await ask('ConsCombustibleMBTU') : null;
  return { gene, fuel };
}

export const fetchPlants = () => query('lists', { MetricId: 'ListadoRecursos', Entity: 'Sistema' });
