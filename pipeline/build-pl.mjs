// Builds the Poland data files from Energy-Charts, and writes site/data/pl/.
//
// Same source and time zone as Germany (pipeline/build-de.mjs), so it shares
// that build's cache rules and year merging. Poland's readings are hourly in
// the early years and every 15 minutes later; hourly ones fill their four
// quarter hours. Day-ahead prices for the PL bidding zone ride along as a
// `price` column (EUR/MWh) for the story.
//
// Usage: node pipeline/build-pl.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchYear, fetchPrices, fetchInstalled, PL_SOURCES, PL_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energy-charts.mjs';
import { isStale, mergeYears } from './build-de.mjs';
import { writeDataset } from './core/dataset.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2015' },
    out: { type: 'string', default: 'site/data/pl' },
    cache: { type: 'string', default: '.cache-pl' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const COLUMNS = [...PL_COLUMNS, 'price'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Merges generation and price years, ending at the last slot with generation. */
export function mergePoland(power, prices) {
  const merged = mergeYears([...power, ...prices], COLUMNS);
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && PL_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  return { ...merged, length: end };
}

async function loadCache(dir) {
  await mkdir(dir, { recursive: true });
  const out = new Map();
  for (const f of await readdir(dir)) {
    if (f.endsWith('.json')) out.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
  }
  return out;
}

/** Fetches the stale years of one kind into its cache folder until the deadline. */
async function refresh(kind, dir, cached, years, fetchOne, now) {
  const queue = years.filter((y) => isStale(cached.get(y), y, now));
  let fetched = 0;
  for (const year of queue) {
    if (Date.now() > deadline) break;
    try {
      const parsed = await fetchOne(year);
      // A year with nothing (prices before the PL zone was published) is cached
      // as empty, so it isn't asked for again.
      const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...(parsed ?? { startMs: NaN, length: 0, columns: {} }) };
      cached.set(year, entry);
      await writeFile(`${dir}/${year}.json`, JSON.stringify(entry));
      log(`PL: ${kind} ${year}: ${parsed ? `${parsed.length} quarter hours${parsed.types ? `, types ${parsed.types.join('; ')}` : ''}` : 'none'}`);
      fetched++;
    } catch (err) {
      log(`PL: ${kind} ${year} failed: ${err.message}`);
    }
    // Energy-Charts rate-limits bursts of requests.
    await sleep(1500);
  }
  return queue.length - fetched;
}

async function main() {
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const thisYear = new Date(now).getUTCFullYear();
  const years = [];
  for (let y = thisYear; y >= Number(args.from); y--) years.push(y);
  const powerDir = `${args.cache}/years`;
  const priceDir = `${args.cache}/prices`;
  const power = await loadCache(powerDir);
  const prices = await loadCache(priceDir);
  log(`PL: ${power.size} years and ${prices.size} price years in cache`);
  const leftPower = await refresh('generation', powerDir, power, years, (y) => fetchYear(y, { country: 'pl', sources: PL_SOURCES, fillMinutes: 60 }), now);
  const leftPrices = await refresh('prices', priceDir, prices, years, (y) => fetchPrices(y, 'PL'), now);
  log(`PL: ${leftPower} generation years and ${leftPrices} price years still to fetch`);

  const merged = mergePoland([...power.values()], [...prices.values()]);
  if (!merged) {
    log('PL: no years yet, nothing written');
    return;
  }
  let installed = null;
  try {
    installed = await fetchInstalled('pl');
    if (installed) await writeFile(`${args.cache}/installed.json`, JSON.stringify(installed));
  } catch (err) {
    log(`PL: installed capacity failed: ${err.message}`);
  }
  if (!installed && existsSync(`${args.cache}/installed.json`)) installed = JSON.parse(await readFile(`${args.cache}/installed.json`, 'utf8'));
  if (installed) await writeFile(`${args.out}/installed.json`, JSON.stringify(installed));

  const got = [...power.entries()].filter(([, e]) => e.length).map(([y]) => y);
  const { bytes } = await writeDataset(args.out, {
    region: 'pl',
    timeZone: 'Europe/Warsaw',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: { first: Math.min(...got), last: Math.max(...got), toFetch: leftPower }, units: { price: 'EUR/MWh' } },
  }, { log });
  log(`PL: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${COLUMNS.length} columns x ${merged.length} slots) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
