// Energy-Charts (Fraunhofer ISE) public net electricity generation for
// Germany, by production type, every 15 minutes since 2015.
// https://api.energy-charts.info/ (CC BY 4.0, no key)
//
// Values are MW, averaged over each quarter hour, on UTC timestamps.
// "Public" means the grid feed: it leaves out what industry makes and uses on
// site, but includes rooftop solar fed into the grid.
import { fetchText, SLOT_MS } from '../lib.mjs';

export const API = 'https://api.energy-charts.info';
export const yearUrl = (year) => `${API}/public_power?country=de&start=${year}-01-01T00:00Z&end=${year + 1}-01-01T00:00Z`;
export const INSTALLED_URL = `${API}/installed_power?country=de&time_step=yearly&installation_decommission=false`;

// Bump when parsing changes, so cached years are parsed again.
export const PARSE_VERSION = 1;

// Output columns, in the order they are written, and the Energy-Charts types
// that make each one up. Charging and net exports are stored as positive MW.
export const DE_SOURCES = {
  nuclear: ['Nuclear'],
  lignite: ['Fossil brown coal / lignite'],
  hardcoal: ['Fossil hard coal'],
  gas: ['Fossil gas'],
  // Oil, and gas made from coal in coke ovens and blast furnaces.
  oil: ['Fossil oil', 'Fossil coal-derived gas'],
  wind_on: ['Wind onshore'],
  wind_off: ['Wind offshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  // Geothermal is about 20 MW, too small for a column of its own.
  biomass: ['Biomass', 'Geothermal'],
  other: ['Waste', 'Others'],
  pumped: ['Hydro pumped storage'],
  pumped_chg: ['Hydro pumped storage consumption'],
  trade: ['Cross border electricity trading'],
};
export const DE_COLUMNS = [...Object.keys(DE_SOURCES).filter((k) => k !== 'trade'), 'imports', 'exports'];

/**
 * Parses one Energy-Charts public_power response into half-hourly MW on a UTC
 * grid. Each half hour is the mean of its two quarter hours, and is missing
 * if any quarter hour of any type in it is missing.
 * @returns {{startMs: number, length: number, columns: Record<string, (number|null)[]>, types: string[]}}
 */
export function parsePublicPower(json) {
  const ts = json?.unix_seconds ?? [];
  const types = new Map((json?.production_types ?? []).map((p) => [p.name, p.data]));
  if (!ts.length || !types.size) return { startMs: NaN, length: 0, columns: {}, types: [] };
  const startMs = Math.floor((ts[0] * 1000) / SLOT_MS) * SLOT_MS;
  const length = Math.floor((ts.at(-1) * 1000 - startMs) / SLOT_MS) + 1;
  const sums = Object.fromEntries(Object.keys(DE_SOURCES).map((c) => [c, new Float64Array(length)]));
  const counts = new Int8Array(length);
  const bad = new Uint8Array(length);
  for (let k = 0; k < ts.length; k++) {
    const slot = Math.floor((ts[k] * 1000 - startMs) / SLOT_MS);
    counts[slot]++;
    for (const [col, names] of Object.entries(DE_SOURCES)) {
      let present = false;
      for (const n of names) {
        const v = types.get(n)?.[k];
        if (v == null) continue;
        present = true;
        sums[col][slot] += v;
      }
      // A type Energy-Charts doesn't list at all that year (coal-derived gas
      // before 2016, nuclear after April 2023) counts as zero, but a listed
      // type with a gap is missing.
      if (!present && names.some((n) => types.has(n))) bad[slot] = 1;
    }
  }
  const round = (v) => Math.round(v * 10) / 10;
  const columns = Object.fromEntries(DE_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  for (let i = 0; i < length; i++) {
    // Whole half hours only: both quarter hours, nothing missing.
    if (counts[i] !== 2 || bad[i]) continue;
    for (const col of Object.keys(DE_SOURCES)) {
      const v = sums[col][i] / 2;
      if (col === 'trade') {
        columns.imports[i] = round(Math.max(0, v));
        columns.exports[i] = round(Math.max(0, -v));
      } else {
        columns[col][i] = round(Math.abs(v));
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
