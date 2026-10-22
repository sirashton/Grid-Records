// Ontario: the IESO, which runs Ontario's grid and market. Its public reports
// site (reports-public.ieso.ca, no key) has:
// - GenOutputbyFuelHourly: one XML file per year since 2015, the hourly output
//   (MWh, so average MW) of every transmission-connected generator summed by
//   fuel. The current year's file is rewritten each morning up to yesterday.
// - GenOutputCapability: one XML file per day, the hourly output of each
//   generator, rewritten each hour through the day; the same figures as the
//   yearly file once the day is over. The last three months are kept.
// - Demand: one CSV per year, Ontario Demand by hour (MW), rewritten daily.
//
// Hours: hour 1 is 00:00 to 01:00 Eastern Standard Time (UTC-5) all year; the
// IESO does not change its market hours for daylight saving.
// Fuel OTHER is the grid batteries (every OTHER unit in the generator report is
// a BESS), discharge only. Distribution-connected solar and wind are not in
// these reports: the IESO counts them as lower demand.

export const BASE = 'https://reports-public.ieso.ca/public';
export const ON_COLUMNS = ['nuclear', 'gas', 'hydro', 'wind', 'solar', 'biomass', 'battery', 'demand'];
export const GEN_COLUMNS = ON_COLUMNS.filter((c) => c !== 'demand');
export const PARSE_VERSION = 1;
export const FIRST_YEAR = 2015;
const HOUR_MS = 3600000;
const UTC_OFFSET_H = 5;

const FUELS = { NUCLEAR: 'nuclear', GAS: 'gas', HYDRO: 'hydro', WIND: 'wind', SOLAR: 'solar', BIOFUEL: 'biomass', OTHER: 'battery' };

/** Grid column for one of the IESO's fuel names, or null (CONTROL ACTIONS). */
export const fuelColumn = (name) => FUELS[String(name ?? '').trim().toUpperCase()] ?? null;

/** UTC start of an IESO day (YYYY-MM-DD, Eastern Standard Time). */
export const dayStartMs = (day) => Date.parse(`${day}T00:00:00Z`) + UTC_OFFSET_H * HOUR_MS;

const num = (s) => (s == null || String(s).trim() === '' ? null : Number(s));
const tag = (s, name) => s.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

/** An empty piece of `length` hours from `startMs`, every column missing. */
function emptyPiece(startMs, length) {
  return { startMs, length, columns: Object.fromEntries(ON_COLUMNS.map((c) => [c, new Array(length).fill(null)])) };
}

/**
 * One GenOutputbyFuelHourly year onto the hourly grid, as average MW by fuel.
 * The grid runs from 1 January to the last day in the file. An hour the file
 * has counts every fuel it leaves out as 0 (batteries before 2025); a blank
 * output is missing. Demand is left missing.
 */
export function parseFuelYear(xml) {
  const days = xml.split('<DailyData>').slice(1);
  if (!days.length) return null;
  const first = tag(days[0], 'Day');
  const last = tag(days.at(-1), 'Day');
  const startMs = dayStartMs(first);
  const piece = emptyPiece(startMs, Math.round((dayStartMs(last) - startMs) / HOUR_MS) + 24);
  for (const d of days) {
    const base = Math.round((dayStartMs(tag(d, 'Day')) - startMs) / HOUR_MS);
    for (const h of d.split('<HourlyData>').slice(1)) {
      const i = base + Number(tag(h, 'Hour')) - 1;
      if (!(i >= 0 && i < piece.length)) continue;
      for (const c of GEN_COLUMNS) piece.columns[c][i] = 0;
      for (const f of h.split('<FuelTotal>').slice(1)) {
        const col = fuelColumn(tag(f, 'Fuel'));
        if (!col) continue;
        const v = num(tag(f, 'Output'));
        piece.columns[col][i] = v == null ? null : Math.max(0, v);
      }
    }
  }
  return piece;
}

/** Ontario Demand from a Demand CSV, laid onto `piece` (same grid) in place. */
export function addDemand(piece, csv) {
  for (const line of csv.split(/\r?\n/)) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}),(\d+),([^,]*),([^,]*)/);
    if (!m) continue;
    const i = Math.round((dayStartMs(m[1]) - piece.startMs) / HOUR_MS) + Number(m[2]) - 1;
    const v = num(m[4]);
    if (i >= 0 && i < piece.length && v != null && v > 0) piece.columns.demand[i] = v;
  }
  return piece;
}

/**
 * One GenOutputCapability day onto the hourly grid: each generator's output
 * summed by fuel. Only the hours the file has reached are filled.
 */
export function parseGeneratorDay(xml) {
  const day = tag(xml, 'Date');
  if (!day) return null;
  const piece = emptyPiece(dayStartMs(day), 24);
  for (const g of xml.split('<Generator>').slice(1)) {
    const col = fuelColumn(tag(g, 'FuelType'));
    if (!col) continue;
    const outputs = g.split('<Capabilities>')[0];
    for (const [, h, v] of outputs.matchAll(/<Hour>(\d+)<\/Hour>\s*<EnergyMW>([^<]*)</g)) {
      const i = Number(h) - 1;
      if (!(i >= 0 && i < 24)) continue;
      if (piece.columns.nuclear[i] == null) for (const c of GEN_COLUMNS) piece.columns[c][i] = 0;
      piece.columns[col][i] += Math.max(0, num(v) ?? 0);
    }
  }
  return piece;
}

/** GETs one report file, retrying a few times. */
export async function getText(url, { retries = 3, timeoutMs = 120000 } = {}) {
  let err;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw err;
}

/** The files for year `y`; the current year's have no year in their name. */
export function yearUrls(y, currentYear) {
  const sfx = y === currentYear ? '' : `_${y}`;
  return {
    fuel: `${BASE}/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly${sfx}.xml`,
    demand: `${BASE}/Demand/PUB_Demand${sfx}.csv`,
  };
}

/** The generator report for day YYYY-MM-DD; today's has no date in its name. */
export const dayUrl = (day, today) =>
  `${BASE}/GenOutputCapability/PUB_GenOutputCapability${day === today ? '' : `_${day.replaceAll('-', '')}`}.xml`;

/** Today's date (YYYY-MM-DD) in Eastern Standard Time. */
export const estDate = (ms) => new Date(ms - UTC_OFFSET_H * HOUR_MS).toISOString().slice(0, 10);

/** One year, parsed: fuel output plus demand. */
export async function fetchYear(y, currentYear) {
  const urls = yearUrls(y, currentYear);
  const xml = await getText(urls.fuel);
  if (!xml) return null;
  const piece = parseFuelYear(xml);
  if (!piece) return null;
  const csv = await getText(urls.demand).catch(() => null);
  if (csv) addDemand(piece, csv);
  return piece;
}
