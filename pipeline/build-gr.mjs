// Builds the Greece data files from Energy-Charts, and writes site/data/gr/.
//
// Same source as Germany, Poland and France (pipeline/build-fr.mjs), with its
// year cache and merge. Greece's readings are hourly in the early years and
// every 15 minutes later; hourly ones fill their four quarter hours.
// Day-ahead prices for the GR bidding zone ride along as `price` (EUR/MWh).
//
// Energy-Charts allows about two requests a minute from one address, and the
// other Energy-Charts countries run just before this one, so requests here
// are spaced more than 30 seconds apart and a refusal stops the run: the
// history fills over several runs through the cache, newest year first, and
// after that a run asks only for the current year (generation and prices)
// and, once a day, installed capacity.
//
// Usage: node pipeline/build-gr.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { yearUrl, priceUrl, installedUrl, parsePublicPower, parsePrices, GR_SOURCES, GR_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energy-charts.mjs';
import { isStale, mergeYears } from './build-de.mjs';
import { writeDataset } from './core/dataset.mjs';
import { fetchText, log, DAY_MS } from './lib.mjs';

const COLUMNS = [...GR_COLUMNS, 'price'];
// Greek load has never been near this low; a reading below it is one
// Energy-Charts didn't have (a single blank type is read as zero).
export const FLOOR_MW = { demand: 1500 };
// Time between two requests to Energy-Charts.
export const GAP_MS = 32000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Merges generation and price years, ending at the last slot with generation. */
export function mergeGreece(power, prices) {
  // Energy-Charts years start at midnight UTC, two hours after New Year in
  // Athens. A missing slot in front lets the first year count as a whole
  // Greek calendar year.
  const present = power.filter((e) => e?.length);
  const first = present.length ? Math.min(...present.map((e) => e.startMs)) : NaN;
  const newYear = Date.UTC(new Date(first).getUTCFullYear(), 0, 1) - 2 * 3600000;
  const pad = first - newYear > 0 && first - newYear <= 2 * 3600000 ? [{ startMs: newYear, length: 1, columns: {} }] : [];
  const merged = mergeYears([...pad, ...power, ...prices], COLUMNS);
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && GR_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  for (const [c, floor] of Object.entries(FLOOR_MW)) {
    const col = merged.columns[c];
    for (let i = 0; i < end; i++) if (col[i] < floor) col[i] = NaN;
  }
  return { ...merged, length: end };
}

/**
 * The requests a run should make, most useful first: the current year's
 * generation and prices (the live part), then missing years newest first,
 * generation before prices.
 */
export function plan(power, prices, years, now) {
  const out = [];
  for (const year of years) {
    if (isStale(power.get(year), year, now)) out.push({ kind: 'generation', year });
    if (isStale(prices.get(year), year, now)) out.push({ kind: 'prices', year });
  }
  return out;
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
      out: { type: 'string', default: 'site/data/gr' },
      cache: { type: 'string', default: '.cache-gr' },
    },
  });
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const thisYear = new Date(now).getUTCFullYear();
  const years = [];
  for (let y = thisYear; y >= Number(args.from); y--) years.push(y);
  const dirs = { generation: `${args.cache}/years`, prices: `${args.cache}/prices` };
  const cache = { generation: await loadCache(dirs.generation), prices: await loadCache(dirs.prices) };
  log(`GR: ${cache.generation.size} years and ${cache.prices.size} price years in cache`);

  const queue = plan(cache.generation, cache.prices, years, now);
  const instFile = `${args.cache}/installed.json`;
  let installed = existsSync(instFile) ? JSON.parse(await readFile(instFile, 'utf8')) : null;
  if (!installed || !(now - Date.parse(installed.fetched ?? 0) < DAY_MS)) queue.push({ kind: 'installed' });

  // The runs before this one may have just used Energy-Charts' allowance.
  let last = Date.now();
  let done = 0;
  for (const job of queue) {
    if (Date.now() + GAP_MS > deadline) break;
    await sleep(Math.max(0, last + GAP_MS - Date.now()));
    last = Date.now();
    const url = job.kind === 'generation' ? yearUrl(job.year, 'gr') : job.kind === 'prices' ? priceUrl(job.year, 'GR') : installedUrl('gr');
    let text;
    try {
      text = await fetchText(url, { retries: 0, timeoutMs: 240000 });
    } catch (err) {
      log(`GR: ${job.kind} ${job.year ?? ''} failed, stopping: ${err.message}`);
      break;
    }
    done++;
    if (job.kind === 'installed') {
      if (text == null) continue;
      const j = JSON.parse(text);
      installed = { fetched: new Date().toISOString(), years: j.time.map(Number), types: Object.fromEntries(j.production_types.map((p) => [p.name, p.data])) };
      await writeFile(instFile, JSON.stringify(installed));
      log(`GR: installed capacity ${installed.years[0]}-${installed.years.at(-1)}, types ${Object.keys(installed.types).join('; ')}`);
      continue;
    }
    const json = text == null ? null : JSON.parse(text);
    const parsed = job.kind === 'generation' ? parsePublicPower(json, { sources: GR_SOURCES, fillMinutes: 60 }) : parsePrices(json ?? {});
    const empty = job.kind === 'generation' ? !parsed.length : !parsed.columns.price.some((v) => v != null);
    // A year with nothing is cached as empty, so it isn't asked for again.
    const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...(empty ? { startMs: NaN, length: 0, columns: {} } : parsed) };
    cache[job.kind].set(job.year, entry);
    await writeFile(`${dirs[job.kind]}/${job.year}.json`, JSON.stringify(entry));
    const steps = json?.unix_seconds?.length > 1 ? ` first ${new Date(json.unix_seconds[0] * 1000).toISOString()}, steps ${[...new Set(json.unix_seconds.slice(1).map((t, k) => t - json.unix_seconds[k]))].slice(0, 4).join('/')} s` : '';
    log(`GR: ${job.kind} ${job.year}: ${empty ? 'none' : `${parsed.length} quarter hours${parsed.types ? `, types ${parsed.types.join('; ')}` : ''}`}${steps}`);
  }
  log(`GR: made ${done} of ${queue.length} requests`);

  const power = [...cache.generation.values()];
  const merged = mergeGreece(power, [...cache.prices.values()]);
  if (!merged) {
    log('GR: no years yet, nothing written');
    return;
  }
  if (installed) await writeFile(`${args.out}/installed.json`, JSON.stringify({ years: installed.years, types: installed.types }));
  const got = [...cache.generation.entries()].filter(([, e]) => e.length).map(([y]) => y);
  const toFetch = plan(cache.generation, cache.prices, years, Date.now()).filter((j) => j.year !== thisYear).length;
  const { bytes } = await writeDataset(args.out, {
    region: 'gr',
    timeZone: 'Europe/Athens',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: { first: Math.min(...got), last: Math.max(...got), toFetch }, units: { price: 'EUR/MWh' } },
  }, { log });
  log(`GR: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${COLUMNS.length} columns x ${merged.length} slots) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
