// Builds the Denmark data files from Energinet's Energi Data Service
// (pipeline/sources/energinet.mjs), and writes site/data/dk/.
//
// Energi Data Service limits how often each dataset may be asked for (HTTP
// 429, and a block for an address that keeps going), so the history comes
// in few, large requests: one per past year, and one per month of the
// current year, for generation and for prices. Chunks run from midnight
// Danish winter time (23:00 UTC), so years are Danish calendar years.
//
// Parsed chunks are kept in the Actions cache (.cache-dk/). A run fetches
// chunks it has never seen, the current month every run (so the page stays
// within an hour or two of real time), the two months before it daily
// (Energinet replaces its first "Initial" figures with settlement data after
// about 8 days), and older chunks weekly until their year's "Final" version
// is due on 1 June of the next year. A fresh cache backfills newest first
// over a few runs, and a run stops at the first refusal.
//
// Usage: node pipeline/build-dk.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchGeneration, fetchPrices, DK_COLUMNS, GEN_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energinet.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch } from './core/chunks.mjs';
import { DAY_MS, log } from './lib.mjs';

const COLUMNS = [...DK_COLUMNS, 'price'];
// The current month is fetched again once it is this old.
const LIVE_MS = 20 * 60000;
const HOUR_MS = 3600000;

/**
 * [start, end) in ms of a chunk: 'YYYY' (a Danish calendar year) or 'YYYYMM'
 * (a month), from midnight Danish winter time, 23:00 UTC the day before.
 */
export function chunkRange(key) {
  const y = Number(key.slice(0, 4));
  if (key.length === 4) return [Date.UTC(y, 0, 1) - HOUR_MS, Date.UTC(y + 1, 0, 1) - HOUR_MS];
  const m = Number(key.slice(4)) - 1;
  return [Date.UTC(y, m, 1) - HOUR_MS, Date.UTC(y, m + 1, 1) - HOUR_MS];
}

/** The chunks to have, newest first: this year's months to date, then past years back to `from`. */
export function chunkList(from, nowMs) {
  // The Danish date: an hour ahead of UTC in winter is enough to place a chunk.
  const now = new Date(nowMs + HOUR_MS);
  const y = now.getUTCFullYear();
  const out = [];
  for (let m = now.getUTCMonth(); m >= 0; m--) out.push(`${y}${String(m + 1).padStart(2, '0')}`);
  for (let yy = y - 1; yy >= from; yy--) out.push(String(yy));
  return out;
}

/**
 * Whether a cached chunk should be fetched again. index 0 is the current
 * month. Chunks before their year's Final version (1 June the next year) are
 * checked weekly; after that they stand.
 */
export function isStale(entry, key, index, nowMs) {
  if (!entry || entry.version !== PARSE_VERSION) return true;
  const fetched = Date.parse(entry.fetched);
  const age = nowMs - fetched;
  if (index === 0) return age > LIVE_MS;
  if (index <= 2) return age > DAY_MS;
  const finalDue = Date.UTC(Number(key.slice(0, 4)) + 1, 5, 2);
  if (fetched >= finalDue) return false;
  return nowMs >= finalDue || age > 7 * DAY_MS;
}

/**
 * Lays chunks of generation and prices onto one hourly grid, from the first
 * to the last hour with generation (prices are published a day ahead).
 */
export function mergeDenmark(gen, prices) {
  const merged = stitch([...gen, ...prices], { stepMinutes: STEP_MINUTES, columns: COLUMNS });
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && GEN_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  let start = 0;
  while (start < end && GEN_COLUMNS.every((c) => Number.isNaN(merged.columns[c][start]))) start++;
  if (start >= end) return null;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(start, end);
  return { startMs: merged.startMs + start * STEP_MINUTES * 60000, length: end - start, columns: merged.columns };
}

async function loadDir(dir) {
  await mkdir(dir, { recursive: true });
  const out = new Map();
  for (const f of await readdir(dir)) {
    if (f.endsWith('.json')) out.set(f.replace(/\.json$/, ''), JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
  }
  return out;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'budget-minutes': { type: 'string', default: '3' },
      from: { type: 'string', default: '2015' },
      out: { type: 'string', default: 'site/data/dk' },
      cache: { type: 'string', default: '.cache-dk' },
    },
  });
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const chunks = chunkList(Number(args.from), now);
  const kinds = {
    gen: { dir: `${args.cache}/gen`, fetch: fetchGeneration },
    price: { dir: `${args.cache}/price`, fetch: fetchPrices },
  };
  const cached = {};
  for (const [k, v] of Object.entries(kinds)) cached[k] = await loadDir(v.dir);
  log(`DK: ${cached.gen.size} generation and ${cached.price.size} price chunks in cache`);

  // Newest first, generation before prices for each chunk.
  const queue = [];
  chunks.forEach((key, index) => {
    for (const kind of Object.keys(kinds)) if (isStale(cached[kind].get(key), key, index, now)) queue.push({ kind, key, name: `${kind} ${key}` });
  });
  // Limits are per dataset, so a refusal stops only that kind of request.
  const refusals = {};
  let skipped = 0;
  const { done, left } = await runQueue(queue, async ({ kind, key }) => {
    if (refusals[kind]) { skipped++; return; }
    const [s, e] = chunkRange(key);
    try {
      const piece = await kinds[kind].fetch(s, e, { deadline });
      const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...piece };
      cached[kind].set(key, entry);
      await writeFile(`${kinds[kind].dir}/${key}.json`, JSON.stringify(entry));
      log(`DK: ${kind} ${key}: ${piece.length} hours`);
    } catch (err) {
      if (/HTTP (403|429)/.test(err.message)) refusals[kind] = err.message.slice(0, 400);
      throw err;
    }
    // A pause between requests, as the service asks.
    await new Promise((r) => setTimeout(r, 3000));
  }, { concurrency: 1, deadline, stop: () => Object.keys(refusals).length === Object.keys(kinds).length, log: (m) => log(`DK: ${m}`) });
  const refused = Object.keys(refusals).length ? refusals : null;
  log(`DK: fetched ${done - skipped} chunks, ${left + skipped} still to fetch${refused ? ` (refused: ${JSON.stringify(refused)})` : ''}`);

  const keep = new Set(chunks);
  const pick = (kind) => [...cached[kind].entries()].filter(([k]) => keep.has(k)).map(([, e]) => e);
  const merged = mergeDenmark(pick('gen'), pick('price'));
  if (!merged) {
    log('DK: no data yet, nothing written');
    return;
  }
  const have = chunks.filter((k) => cached.gen.has(k));
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'dk',
    timeZone: 'Europe/Copenhagen',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: {
      chunks: { have: have.length, of: chunks.length, oldest: have.at(-1), toFetch: left + skipped },
      lastRun: { at: new Date().toISOString(), fetched: done - skipped, refused },
      units: { price: 'EUR/MWh' },
    },
  }, { log });
  const last = new Date(merged.startMs + merged.length * HOUR_MS).toISOString();
  log(`DK: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours, data to ${last}) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
