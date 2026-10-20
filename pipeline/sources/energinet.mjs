// Energinet's Energi Data Service (https://www.energidataservice.dk/, no key,
// CC BY 4.0): Denmark's production by fuel, exchange on every interconnector
// and gross consumption, per bidding zone (DK1 west of the Great Belt, DK2
// east), from the GenerationProdTypeExchange dataset. Hourly from 2015.
//
// Each hour carries the best version Energinet has: "Initial" (live
// measurements of the larger plants, scaled up, published within the hour),
// "Preliminary" (settlement data, at least 8 days later) and "Final" (fuel
// splits from that year's plant fuel counts, by 1 June the next year). So the
// latest hour is usually one to two hours old.
//
// Fuel columns are by each plant's main fuel: a biomass plant that also burns
// some coal counts as biomass. Values are MWh per hour, which is average MW.
// Exchange is positive into Denmark. The Great Belt link between DK1 and DK2
// is internal and left out, so summing the two zones gives all of Denmark.
//
// Day-ahead prices (EUR/MWh) come from Elspotprices (hourly, to 30 September
// 2025) and DayAheadPrices (every 15 minutes, from 1 October 2025); `price`
// is the mean of the DK1 and DK2 prices, averaged to the hour.
//
// ElectricityProdex5MinRealtime and PowerSystemRightNow are fresher (5 and 1
// minute), but split thermal output only by plant size, not by fuel, so the
// page uses the hourly fuel data throughout.
import { fetchJson } from '../lib.mjs';

export const API = 'https://api.energidataservice.dk/dataset';
export const AREAS = ['DK1', 'DK2'];
const FILTER = encodeURIComponent(JSON.stringify({ PriceArea: AREAS }));
// [start, end) in UTC, as YYYY-MM-DDTHH:MM.
const range = (startMs, endMs) => `start=${new Date(startMs).toISOString().slice(0, 16)}&end=${new Date(endMs).toISOString().slice(0, 16)}&timezone=UTC`;
export const generationUrl = (startMs, endMs) => `${API}/GenerationProdTypeExchange?${range(startMs, endMs)}&filter=${FILTER}&limit=0`;
// Elspotprices stops at the end of September 2025, when the day-ahead market
// moved to 15-minute prices in DayAheadPrices.
export const PRICE_SWITCH_MS = Date.UTC(2025, 8, 30, 22);
export const priceUrl = (startMs, endMs) => (startMs < PRICE_SWITCH_MS
  ? `${API}/Elspotprices?${range(startMs, Math.min(endMs, PRICE_SWITCH_MS))}&filter=${FILTER}&limit=0`
  : `${API}/DayAheadPrices?${range(startMs, endMs)}&filter=${FILTER}&limit=0`);

// Bump when parsing changes, so cached months are parsed again.
export const PARSE_VERSION = 1;
export const STEP_MINUTES = 60;
const HOUR_MS = 3600000;

// Output columns and the Energinet fields that make each one up.
export const DK_SOURCES = {
  coal: ['FossilHardCoal'],
  gas: ['FossilGas'],
  oil: ['FossilOil'],
  // Waste incineration plants, nearly all of them combined heat and power.
  waste: ['Waste'],
  // Wood pellets, wood chips and straw, and biogas engines.
  biomass: ['Biomass', 'Biogas'],
  wind_onshore: ['OnshoreWindPower'],
  wind_offshore: ['OffshoreWindPower'],
  // Solar fed into the grid; SolarPowerSelfCon, Energinet's estimate of what
  // rooftops use themselves, is left out, as other countries' grid feeds do.
  solar: ['SolarPower'],
  hydro: ['HydroPower'],
  demand: ['GrossCon'],
};
// Net flow on each border, positive into Denmark, as MW.
export const BORDERS = {
  net_no: 'ExchangeNorway',
  net_se: 'ExchangeSweden',
  net_de: 'ExchangeGermany',
  net_nl: 'ExchangeNetherlands',
  net_gb: 'ExchangeGreatBritain',
};
export const GEN_COLUMNS = Object.keys(DK_SOURCES).filter((c) => c !== 'demand');
export const DK_COLUMNS = [...Object.keys(DK_SOURCES), 'imports', 'exports', ...Object.keys(BORDERS)];

const timeOf = (r) => Date.parse(`${(r.TimeUTC ?? r.HourUTC).slice(0, 19)}Z`);

/**
 * How many minutes each record covers: the gap to the area's next record, at
 * most an hour. Energinet's datasets are moving from hours to quarter hours,
 * so both are read. The last record takes the one before it's length.
 */
function durations(records) {
  const out = new Map();
  const byArea = new Map();
  for (const r of records) {
    if (!byArea.has(r.PriceArea)) byArea.set(r.PriceArea, []);
    byArea.get(r.PriceArea).push(r);
  }
  for (const list of byArea.values()) {
    list.sort((a, b) => timeOf(a) - timeOf(b));
    let prev = 60;
    for (let k = 0; k < list.length; k++) {
      const t = timeOf(list[k]);
      let min = k + 1 < list.length ? (timeOf(list[k + 1]) - t) / 60000 : prev;
      if (!(min > 0) || min > 60) min = new Date(t).getUTCMinutes() ? 15 : 60;
      out.set(list[k], min);
      prev = min;
    }
  }
  return out;
}

/**
 * Hourly whole-Denmark columns from one request's records:
 * { startMs, length, columns }. An hour is kept only when both zones cover
 * all of it; a missing field in a record that is there counts as zero (DK2
 * has no Norway cable, and links count as zero before they opened).
 */
export function parseGeneration(records, startMs, endMs) {
  const length = Math.round((endMs - startMs) / HOUR_MS);
  const sums = Object.fromEntries([...Object.keys(DK_SOURCES), ...Object.keys(BORDERS)].map((c) => [c, new Float64Array(length)]));
  const cover = Object.fromEntries(AREAS.map((a) => [a, new Float64Array(length)]));
  const dur = durations(records);
  for (const r of records) {
    if (!AREAS.includes(r.PriceArea)) continue;
    // A record with neither consumption nor wind is one Energinet hasn't filled.
    if (r.GrossCon == null && r.OnshoreWindPower == null) continue;
    const t = timeOf(r);
    const i = Math.floor((t - startMs) / HOUR_MS);
    if (i < 0 || i >= length) continue;
    // The MWh of every record in an hour add up to that hour's average MW,
    // whether it came as one hourly record or four quarter hours.
    for (const [c, fields] of Object.entries(DK_SOURCES)) for (const f of fields) sums[c][i] += Number(r[f]) || 0;
    for (const [c, f] of Object.entries(BORDERS)) sums[c][i] += Number(r[f]) || 0;
    cover[r.PriceArea][i] += dur.get(r);
  }
  const columns = Object.fromEntries(DK_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  for (let i = 0; i < length; i++) {
    if (AREAS.some((a) => cover[a][i] < 59.5)) continue;
    for (const c of Object.keys(sums)) columns[c][i] = Math.round(sums[c][i] * 10) / 10;
    let net = 0;
    for (const c of Object.keys(BORDERS)) net += sums[c][i];
    columns.imports[i] = Math.max(0, Math.round(net * 10) / 10);
    columns.exports[i] = Math.min(0, Math.round(net * 10) / 10);
  }
  return { startMs, length, columns };
}

/**
 * Hourly price (EUR/MWh), the mean of DK1 and DK2, from either price dataset.
 * Quarter-hour prices are averaged to the hour. { startMs, length, columns: { price } }
 */
export function parsePrices(records, startMs, endMs) {
  const length = Math.round((endMs - startMs) / HOUR_MS);
  const sum = new Float64Array(length);
  const n = new Float64Array(length);
  for (const r of records) {
    if (!AREAS.includes(r.PriceArea)) continue;
    const p = r.DayAheadPriceEUR ?? r.SpotPriceEUR;
    if (p == null || !Number.isFinite(Number(p))) continue;
    const i = Math.floor((timeOf(r) - startMs) / HOUR_MS);
    if (i < 0 || i >= length) continue;
    sum[i] += Number(p);
    n[i]++;
  }
  const price = Array.from(sum, (s, i) => (n[i] ? Math.round((s / n[i]) * 100) / 100 : null));
  return { startMs, length, columns: { price } };
}

/** Fetches one month (UTC) of generation and exchange. */
export async function fetchGeneration(startMs, endMs) {
  const json = await fetchJson(generationUrl(startMs, endMs), { timeoutMs: 180000 });
  return parseGeneration(json?.records ?? [], startMs, endMs);
}

/** Fetches one month (UTC) of prices, across the switch to 15-minute prices if needed. */
export async function fetchPrices(startMs, endMs) {
  const parts = startMs < PRICE_SWITCH_MS && endMs > PRICE_SWITCH_MS ? [[startMs, PRICE_SWITCH_MS], [PRICE_SWITCH_MS, endMs]] : [[startMs, endMs]];
  const records = [];
  for (const [s, e] of parts) {
    const json = await fetchJson(priceUrl(s, e), { timeoutMs: 180000 });
    records.push(...(json?.records ?? []));
  }
  return parsePrices(records, startMs, endMs);
}
