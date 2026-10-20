// Builds the Bulgaria data files from Energy-Charts, and writes site/data/bg/.
//
// Same source as Germany, Poland and France (pipeline/build-fr.mjs is the
// pattern): one request per calendar year, cached in .cache-bg/, with the
// current year fetched again each run. Bulgaria's readings are hourly
// throughout, so each fills its four quarter hours; day-ahead prices for the
// BG zone (hourly, every 15 minutes from October 2025) ride along as `price`
// in EUR/MWh.
//
// Energy-Charts allows about two requests a minute from one address, and the
// other Energy-Charts countries run just before this in the same job, so this
// build waits half a minute before every request. A full backfill (12
// generation years, 11 price years) spreads over several runs; each run
// keeps what it got in the cache.
//
// Usage: node pipeline/build-bg.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchYear, fetchPrices, fetchInstalled, BG_SOURCES, BG_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energy-charts.mjs';
import { isStale, mergeYears } from './build-de.mjs';
import { writeDataset } from './core/dataset.mjs';
import { log } from './lib.mjs';

const COLUMNS = [...BG_COLUMNS, 'price'];
export const TIME_ZONE = 'Europe/Sofia';
// Load in Bulgaria has never been near 1.5 GW, so a reading below it is one
// Energy-Charts didn't have (the parser counts a single blank type as zero).
// Nuclear is not floored: Kozloduy runs two 1 GW units and one is often off,
// but both together have been off for whole days, so a low reading can be real.
export const FLOOR_MW = { demand: 1500 };
// Energy-Charts' rate limit: about two requests a minute.
export const PAUSE_MS = 31000;
// Current-year prices are fetched again only this often, to save requests.
const PRICE_REFRESH_MS = 6 * 3600000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Merges generation and price years, ending at the last slot with generation.
 * Energy-Charts' years start at midnight UTC, two hours into the Bulgarian
 * year, so a short run of missing slots in front lets the first year count as
 * a whole Bulgarian calendar year.
 */
export function mergeBulgaria(power, prices) {
  const present = power.filter((e) => e && e.length);
  if (!present.length) return null;
  const first = Math.min(...present.map((e) => e.startMs));
  const y = new Date(first).getUTCFullYear();
  const newYear = Date.UTC(y, 0, 1) - 2 * 3600000;
  const pad = first > newYear && first - newYear <= 2 * 3600000 ? [{ startMs: newYear, length: 1, columns: {} }] : [];
  const merged = mergeYears([...pad, ...present, ...prices], COLUMNS);
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && BG_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  for (const [c, floor] of Object.entries(FLOOR_MW)) {
    const col = merged.columns[c];
    for (let i = 0; i < end; i++) if (col[i] < floor) col[i] = NaN;
  }
  return { ...merged, length: end };
}

/** Whether a cached price year should be fetched again. */
export function priceStale(entry, year, nowMs) {
  if (!isStale(entry, year, nowMs)) return false;
  if (!entry || entry.version !== PARSE_VERSION) return true;
  if (year !== new Date(nowMs).getUTCFullYear()) return true;
  return nowMs - Date.parse(entry.fetched) > PRICE_REFRESH_MS;
}

async function loadCache(dir) {
  await mkdir(dir, { recursive: true });
  const out = new Map();
  for (const f of await readdir(dir)) {
    if (f.endsWith('.json')) out.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
  }
  return out;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'budget-minutes': { type: 'string', default: '3' },
      from: { type: 'string', default: '2015' },
      out: { type: 'string', default: 'site/data/bg' },
      cache: { type: 'string', default: '.cache-bg' },
    },
  });
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const thisYear = new Date(now).getUTCFullYear();
  const years = [];
  for (let y = thisYear; y >= Number(args.from); y--) years.push(y);
  const powerDir = `${args.cache}/years`;
  const priceDir = `${args.cache}/prices`;
  const power = await loadCache(powerDir);
  const prices = await loadCache(priceDir);
  log(`BG: ${power.size} years and ${prices.size} price years in cache`);

  // One queue, newest first, generation before prices in each year, so a
  // short run still brings the current year up to date.
  const queue = [];
  for (const y of years) {
    if (isStale(power.get(y), y, now)) queue.push({ kind: 'generation', year: y, dir: powerDir, cache: power, get: () => fetchYear(y, { country: 'bg', sources: BG_SOURCES, fillMinutes: 60 }) });
    if (priceStale(prices.get(y), y, now)) queue.push({ kind: 'prices', year: y, dir: priceDir, cache: prices, get: () => fetchPrices(y, 'BG') });
  }
  const installedAge = existsSync(`${args.cache}/installed.json`) ? now - JSON.parse(await readFile(`${args.cache}/installed.json`, 'utf8')).fetchedMs : Infinity;
  if (!(installedAge < 7 * 864e5)) queue.push({ kind: 'installed' });
  let left = queue.length;
  for (const job of queue) {
    if (Date.now() + PAUSE_MS > deadline) break;
    await sleep(PAUSE_MS);
    try {
      if (job.kind === 'installed') {
        const installed = await fetchInstalled('bg');
        if (installed) await writeFile(`${args.cache}/installed.json`, JSON.stringify({ ...installed, fetchedMs: Date.now() }));
        log(`BG: installed capacity ${installed ? `to ${Math.max(...installed.years)}` : 'none'}`);
      } else {
        const parsed = await job.get();
        // A year with nothing (no prices published for it) is cached as
        // empty, so it isn't asked for again.
        const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...(parsed ?? { startMs: NaN, length: 0, columns: {} }) };
        job.cache.set(job.year, entry);
        await writeFile(`${job.dir}/${job.year}.json`, JSON.stringify(entry));
        log(`BG: ${job.kind} ${job.year}: ${parsed ? `${parsed.length} quarter hours${parsed.types ? `, types ${parsed.types.join('; ')}` : ''}` : 'none'}`);
      }
      left--;
    } catch (err) {
      log(`BG: ${job.kind} ${job.year ?? ''} failed: ${err.message}`);
      // A refusal means the limit is hit: stop for this run.
      if (/HTTP 429/.test(err.message)) break;
    }
  }
  log(`BG: ${left} requests still to make`);

  const merged = mergeBulgaria([...power.values()], [...prices.values()]);
  if (!merged) {
    log('BG: no years yet, nothing written');
    return;
  }
  if (existsSync(`${args.cache}/installed.json`)) {
    const { fetchedMs, ...installed } = JSON.parse(await readFile(`${args.cache}/installed.json`, 'utf8'));
    await writeFile(`${args.out}/installed.json`, JSON.stringify(installed));
  }
  const got = [...power.entries()].filter(([, e]) => e.length).map(([y]) => y);
  const { bytes } = await writeDataset(args.out, {
    region: 'bg',
    timeZone: TIME_ZONE,
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: { first: Math.min(...got), last: Math.max(...got), toFetch: left }, units: { price: 'EUR/MWh' } },
  }, { log });
  log(`BG: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${COLUMNS.length} columns x ${merged.length} slots) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
