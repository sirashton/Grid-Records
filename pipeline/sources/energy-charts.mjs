// Energy-Charts (Fraunhofer ISE) public net electricity generation for
// Germany, by production type, every 15 minutes since 2015.
// https://api.energy-charts.info/ (CC BY 4.0, no key)
//
// Values are MW, averaged over each quarter hour, on UTC timestamps.
// "Public" means the grid feed: it leaves out what industry makes and uses on
// site, but includes rooftop solar fed into the grid.
import { fetchText } from '../lib.mjs';

export const API = 'https://api.energy-charts.info';
export const yearUrl = (year) => `${API}/public_power?country=de&start=${year}-01-01T00:00Z&end=${year + 1}-01-01T00:00Z`;
export const INSTALLED_URL = `${API}/installed_power?country=de&time_step=yearly&installation_decommission=false`;

// Bump when parsing changes, so cached years are parsed again.
export const PARSE_VERSION = 3;
export const STEP_MINUTES = 15;
const STEP_MS = STEP_MINUTES * 60000;

// Output columns (the framework's canonical names), in the order they are
// written, and the Energy-Charts types that make each one up.
export const DE_SOURCES = {
  nuclear: ['Nuclear'],
  lignite: ['Fossil brown coal / lignite'],
  coal: ['Fossil hard coal'],
  gas: ['Fossil gas'],
  // Oil, and gas made from coal in coke ovens and blast furnaces.
  oil: ['Fossil oil', 'Fossil coal-derived gas'],
  wind_onshore: ['Wind onshore'],
  wind_offshore: ['Wind offshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  // Geothermal is about 20 MW, too small for a column of its own.
  biomass: ['Biomass', 'Geothermal'],
  other: ['Waste', 'Others'],
  pumped_storage: ['Hydro pumped storage'],
  pumped_storage_charge: ['Hydro pumped storage consumption'],
  trade: ['Cross border electricity trading'],
};
export const DE_COLUMNS = [...Object.keys(DE_SOURCES).filter((k) => k !== 'trade'), 'imports', 'exports'];

/**
 * Parses one Energy-Charts public_power response into MW on a 15-minute UTC
 * grid. Pumping and net exports are negative, as the dataset format has it.
 * A quarter hour where most types are blank is missing. A single blank type
 * counts as zero: Energy-Charts kept listing nuclear after the last reactors
 * closed in April 2023, with no values.
 * @returns {{startMs: number, length: number, columns: Record<string, (number|null)[]>, types: string[]}}
 */
export function parsePublicPower(json) {
  const ts = json?.unix_seconds ?? [];
  const types = new Map((json?.production_types ?? []).map((p) => [p.name, p.data]));
  if (!ts.length || !types.size) return { startMs: NaN, length: 0, columns: {}, types: [] };
  const startMs = Math.floor((ts[0] * 1000) / STEP_MS) * STEP_MS;
  const length = Math.floor((ts.at(-1) * 1000 - startMs) / STEP_MS) + 1;
  const listed = [...new Set(Object.values(DE_SOURCES).flat())].filter((n) => types.has(n));
  const columns = Object.fromEntries(DE_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  const round = (v) => Math.round(v * 10) / 10;
  for (let k = 0; k < ts.length; k++) {
    const slot = Math.round((ts[k] * 1000 - startMs) / STEP_MS);
    const blank = listed.filter((n) => types.get(n)[k] == null).length;
    if (blank * 2 > listed.length) continue;
    for (const [col, names] of Object.entries(DE_SOURCES)) {
      const v = names.reduce((sum, n) => sum + (types.get(n)?.[k] ?? 0), 0);
      if (col === 'trade') {
        columns.imports[slot] = round(Math.max(0, v));
        columns.exports[slot] = round(Math.min(0, v));
      } else if (col === 'pumped_storage_charge') {
        columns[col][slot] = round(-Math.abs(v));
      } else {
        columns[col][slot] = round(Math.max(0, v));
      }
    }
  }
  return { startMs, length, columns, types: [...types.keys()] };
}

/** Fetches one calendar year (UTC). Returns null when there is no data. */
export async function fetchYear(year) {
  const text = await fetchText(yearUrl(year), { timeoutMs: 300000 });
  if (text == null) return null;
  const parsed = parsePublicPower(JSON.parse(text));
  return parsed.length ? parsed : null;
}

/** Installed capacity by type at the end of each year, in GW. */
export async function fetchInstalled() {
  const text = await fetchText(INSTALLED_URL);
  if (text == null) return null;
  const j = JSON.parse(text);
  return { years: j.time.map(Number), types: Object.fromEntries(j.production_types.map((p) => [p.name, p.data])) };
}
