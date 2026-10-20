// Energy-Charts (Fraunhofer ISE) public net electricity generation by
// production type: Germany every 15 minutes since 2015, and Poland hourly
// from 2015 and every 15 minutes in recent years, and France and Czechia
// likewise.
// https://api.energy-charts.info/ (CC BY 4.0, no key)
//
// Values are MW, averaged over each quarter hour, on UTC timestamps.
// "Public" means the grid feed: it leaves out what industry makes and uses on
// site, but includes rooftop solar fed into the grid.
import { fetchText } from '../lib.mjs';

export const API = 'https://api.energy-charts.info';
export const yearUrl = (year, country = 'de') => `${API}/public_power?country=${country}&start=${year}-01-01T00:00Z&end=${year + 1}-01-01T00:00Z`;
export const installedUrl = (country = 'de') => `${API}/installed_power?country=${country}&time_step=yearly&installation_decommission=false`;
export const INSTALLED_URL = installedUrl('de');
// Day-ahead prices by bidding zone, in EUR/MWh.
export const priceUrl = (year, bzn) => `${API}/price?bzn=${bzn}&start=${year}-01-01T00:00Z&end=${year + 1}-01-01T00:00Z`;

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
const columnsOf = (sources) => [...Object.keys(sources).filter((k) => k !== 'trade'), 'imports', 'exports'];
export const DE_COLUMNS = columnsOf(DE_SOURCES);

// Poland. No nuclear; batteries and offshore wind (Baltic Power, 2026) are
// listed only in recent years, and count as zero before.
export const PL_SOURCES = {
  lignite: ['Fossil brown coal / lignite'],
  coal: ['Fossil hard coal'],
  gas: ['Fossil gas'],
  oil: ['Fossil oil', 'Fossil coal-derived gas'],
  wind_onshore: ['Wind onshore'],
  wind_offshore: ['Wind offshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  biomass: ['Biomass', 'Other renewables'],
  other: ['Waste', 'Others'],
  pumped_storage: ['Hydro pumped storage'],
  pumped_storage_charge: ['Hydro pumped storage consumption'],
  battery: ['Battery'],
  battery_charge: ['Battery Consumption'],
  demand: ['Load'],
  trade: ['Cross border electricity trading'],
};
export const PL_COLUMNS = columnsOf(PL_SOURCES);

// France. Hourly in the early years, 15 minutes later. Coal is a few hundred
// MW at most since 2022 (Cordemais, Saint-Avold); batteries are listed only
// in recent years and count as zero before.
export const FR_SOURCES = {
  nuclear: ['Nuclear'],
  coal: ['Fossil hard coal'],
  gas: ['Fossil gas'],
  oil: ['Fossil oil'],
  wind_onshore: ['Wind onshore'],
  wind_offshore: ['Wind offshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  biomass: ['Biomass', 'Other renewables', 'Geothermal'],
  other: ['Waste', 'Others'],
  pumped_storage: ['Hydro pumped storage'],
  pumped_storage_charge: ['Hydro pumped storage consumption'],
  battery: ['Battery'],
  battery_charge: ['Battery Consumption'],
  demand: ['Load'],
  trade: ['Cross border electricity trading'],
};
export const FR_COLUMNS = columnsOf(FR_SOURCES);

// Czechia. Hourly in the early years, 15 minutes later. Lignite is most of the
// fossil output; hard coal (Dětmarovice, Třinec) and gas are small. No
// offshore wind, so onshore wind is the `wind` column.
export const CZ_SOURCES = {
  nuclear: ['Nuclear'],
  lignite: ['Fossil brown coal / lignite'],
  coal: ['Fossil hard coal'],
  gas: ['Fossil gas'],
  oil: ['Fossil oil', 'Fossil coal-derived gas'],
  wind: ['Wind onshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  biomass: ['Biomass', 'Other renewables', 'Geothermal'],
  other: ['Waste', 'Others'],
  pumped_storage: ['Hydro pumped storage'],
  pumped_storage_charge: ['Hydro pumped storage consumption'],
  battery: ['Battery'],
  battery_charge: ['Battery Consumption'],
  demand: ['Load'],
  trade: ['Cross border electricity trading'],
};
export const CZ_COLUMNS = columnsOf(CZ_SOURCES);

// Greece (the interconnected system, which Crete joined in 2025). Hourly so
// far, filled to 15 minutes. No nuclear or offshore wind; Greece has
// burnt no hard coal, so any listed would count with lignite. Batteries are
// listed only in recent years and count as zero before.
export const GR_SOURCES = {
  lignite: ['Fossil brown coal / lignite', 'Fossil hard coal'],
  gas: ['Fossil gas'],
  oil: ['Fossil oil'],
  wind: ['Wind onshore', 'Wind offshore'],
  solar: ['Solar'],
  hydro: ['Hydro Run-of-River', 'Hydro water reservoir'],
  biomass: ['Biomass', 'Other renewables', 'Geothermal'],
  other: ['Waste', 'Others'],
  pumped_storage: ['Hydro pumped storage'],
  pumped_storage_charge: ['Hydro pumped storage consumption'],
  battery: ['Battery'],
  battery_charge: ['Battery Consumption'],
  demand: ['Load'],
  trade: ['Cross border electricity trading'],
};
export const GR_COLUMNS = columnsOf(GR_SOURCES);

/**
 * Parses one Energy-Charts public_power response into MW on a 15-minute UTC
 * grid. Pumping, battery charging and net exports are negative, as the
 * dataset format has it. A quarter hour where most types are blank is
 * missing. A single blank type counts as zero: Energy-Charts kept listing
 * nuclear after the last reactors closed in April 2023, with no values.
 *
 * Hourly readings (Poland before its 15-minute data) fill the quarter hours
 * up to the next reading, at most `fillMinutes` ahead, since an hour's
 * average MW is also each of its quarter hours' average.
 * @returns {{startMs: number, length: number, columns: Record<string, (number|null)[]>, types: string[]}}
 */
export function parsePublicPower(json, { sources = DE_SOURCES, fillMinutes = STEP_MINUTES } = {}) {
  const outColumns = columnsOf(sources);
  const ts = json?.unix_seconds ?? [];
  const types = new Map((json?.production_types ?? []).map((p) => [p.name, p.data]));
  if (!ts.length || !types.size) return { startMs: NaN, length: 0, columns: {}, types: [] };
  const startMs = Math.floor((ts[0] * 1000) / STEP_MS) * STEP_MS;
  const maxFill = Math.max(1, Math.round(fillMinutes / STEP_MINUTES));
  // The last reading fills as far as the one before it did.
  const spanAt = (k) => {
    const gap = k + 1 < ts.length ? ts[k + 1] - ts[k] : k > 0 ? ts[k] - ts[k - 1] : STEP_MINUTES * 60;
    return Math.min(maxFill, Math.max(1, Math.round((gap * 1000) / STEP_MS)));
  };
  const length = Math.round((ts.at(-1) * 1000 - startMs) / STEP_MS) + spanAt(ts.length - 1);
  const listed = [...new Set(Object.values(sources).flat())].filter((n) => types.has(n));
  const columns = Object.fromEntries(outColumns.map((c) => [c, new Array(length).fill(null)]));
  const round = (v) => Math.round(v * 10) / 10;
  for (let k = 0; k < ts.length; k++) {
    const slot = Math.round((ts[k] * 1000 - startMs) / STEP_MS);
    const blank = listed.filter((n) => types.get(n)[k] == null).length;
    if (blank * 2 > listed.length) continue;
    const span = spanAt(k);
    const put = (col, v) => { for (let j = 0; j < span; j++) columns[col][slot + j] = v; };
    for (const [col, names] of Object.entries(sources)) {
      const v = names.reduce((sum, n) => sum + (types.get(n)?.[k] ?? 0), 0);
      if (col === 'trade') {
        put('imports', round(Math.max(0, v)));
        put('exports', round(Math.min(0, v)));
      } else if (col.endsWith('_charge')) {
        put(col, round(-Math.abs(v)));
      } else {
        put(col, round(Math.max(0, v)));
      }
    }
  }
  return { startMs, length, columns, types: [...types.keys()] };
}

/** Fetches one calendar year (UTC). Returns null when there is no data. */
export async function fetchYear(year, { country = 'de', ...opts } = {}) {
  const text = await fetchText(yearUrl(year, country), { timeoutMs: 300000 });
  if (text == null) return null;
  const parsed = parsePublicPower(JSON.parse(text), opts);
  return parsed.length ? parsed : null;
}

/**
 * Parses a day-ahead price response onto the 15-minute grid, as `price` in
 * EUR/MWh. Hourly prices fill their four quarter hours; blank prices stay null.
 */
export function parsePrices(json, { fillMinutes = 60 } = {}) {
  const ts = json?.unix_seconds ?? [];
  const p = json?.price ?? [];
  if (!ts.length) return { startMs: NaN, length: 0, columns: { price: [] } };
  const startMs = Math.floor((ts[0] * 1000) / STEP_MS) * STEP_MS;
  const maxFill = Math.max(1, Math.round(fillMinutes / STEP_MINUTES));
  const spanAt = (k) => {
    const gap = k + 1 < ts.length ? ts[k + 1] - ts[k] : k > 0 ? ts[k] - ts[k - 1] : STEP_MINUTES * 60;
    return Math.min(maxFill, Math.max(1, Math.round((gap * 1000) / STEP_MS)));
  };
  const length = Math.round((ts.at(-1) * 1000 - startMs) / STEP_MS) + spanAt(ts.length - 1);
  const price = new Array(length).fill(null);
  for (let k = 0; k < ts.length; k++) {
    if (p[k] == null) continue;
    const slot = Math.round((ts[k] * 1000 - startMs) / STEP_MS);
    for (let j = 0; j < spanAt(k); j++) price[slot + j] = Math.round(p[k] * 10) / 10;
  }
  return { startMs, length, columns: { price } };
}

/** Day-ahead prices for one calendar year (UTC), or null when there are none. */
export async function fetchPrices(year, bzn) {
  const text = await fetchText(priceUrl(year, bzn), { timeoutMs: 300000 });
  if (text == null) return null;
  const parsed = parsePrices(JSON.parse(text));
  return parsed.columns.price.some((v) => v != null) ? parsed : null;
}

/** Installed capacity by type at the end of each year, in GW. */
export async function fetchInstalled(country = 'de') {
  const text = await fetchText(installedUrl(country));
  if (text == null) return null;
  const j = JSON.parse(text);
  return { years: j.time.map(Number), types: Object.fromEntries(j.production_types.map((p) => [p.name, p.data])) };
}
