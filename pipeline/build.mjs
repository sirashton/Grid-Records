// Builds the site's data files: fetches NESO's generation mix and Elexon's
// battery data, merges them onto one half-hourly grid and writes site/data/.
//
// Battery history is slow to fetch, so it is kept between runs: first from the
// Actions cache (.cache/), otherwise from the live site, and new days are
// fetched within a time budget. A fresh start backfills over several runs.
//
// The half-hourly deploy has a short budget, so a separate backfill workflow
// fetches history for longer, in parallel, into its own cache. Each job merges
// the other's latest cache (--merge-cache) so neither loses the other's days.
//
// Usage: node pipeline/build.mjs [--budget-minutes N] [--concurrency N]
//   [--backfill-from YYYY-MM-DD] [--merge-cache DIR]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchNesoGenMix } from './sources/neso-genmix.mjs';
import { fetchBatteryUnits } from './sources/elexon-bmunits.mjs';
import { BATTERY_SOURCES, daysToFetch, mergeStores } from './sources/elexon-battery.mjs';
import { encodeColumns } from './encode.mjs';
import { fetchJson, dayStart, isoDay, DAY_MS, SLOT_MS, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    'backfill-from': { type: 'string', default: '2017-01-01' },
    'live-url': { type: 'string', default: process.env.LIVE_URL ?? 'https://sirashton.github.io/Grid-Records' },
    out: { type: 'string', default: 'site/data' },
    cache: { type: 'string', default: '.cache' },
    'merge-cache': { type: 'string' },
    concurrency: { type: 'string', default: '1' },
  },
});

const OUT = args.out;
const CACHE = args.cache;
const BUDGET_MS = Number(args['budget-minutes']) * 60000;
const CONCURRENCY = Math.max(1, Number(args.concurrency));
const BACKFILL_FROM = Date.parse(`${args['backfill-from']}T00:00:00Z`);
const started = Date.now();

async function readStore(dir, source) {
  const file = `${dir}/battery-${source}.json`;
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
}

async function loadStore(source) {
  let store = await readStore(CACHE, source);
  if (store) log(`battery ${source}: restored ${Object.keys(store.days).length} days from cache`);
  if (!store) {
    try {
      const live = await fetchJson(`${args['live-url']}/data/battery-${source}.json`, { retries: 1 });
      if (live?.days) {
        log(`battery ${source}: restored ${Object.keys(live.days).length} days from the live site`);
        store = live;
      }
    } catch (err) {
      log(`battery ${source}: no live copy (${err.message})`);
    }
  }
  store ??= { days: {} };
  const other = args['merge-cache'] && await readStore(args['merge-cache'], source);
  if (other) {
    const before = Object.keys(store.days).length;
    store = mergeStores(store, other);
    log(`battery ${source}: merged ${args['merge-cache']}, ${Object.keys(store.days).length - before} days added`);
  }
  return store;
}

/** Fetches missing and recent days, newest first, until the budget runs out. */
async function updateStore(source, store, batteries, deadline) {
  const { fetchDay } = BATTERY_SOURCES[source];
  const today = dayStart(Date.now());
  const queue = daysToFetch(store, BATTERY_SOURCES[source], Date.now(), BACKFILL_FROM);
  let fetched = 0;
  let empty = 0;
  let next = 0;
  // A few workers share the queue, newest days first.
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const d = queue[next++];
      try {
        const day = await fetchDay(d, batteries);
        if (day && day.dis.some((v) => v !== null)) {
          store.days[isoDay(d)] = { ...day, fetched: new Date().toISOString() };
          fetched++;
        } else {
          empty++;
          // Before battery data exists, record the day as empty so it is not refetched.
          if (today - d > 30 * DAY_MS) store.days[isoDay(d)] = { dis: [], chg: [] };
        }
      } catch (err) {
        log(`battery ${source}: ${isoDay(d)} failed: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const remaining = queue.length - fetched - empty;
  log(`battery ${source}: fetched ${fetched} days, ${empty} empty, ${Math.max(0, remaining)} still to backfill`);
  store.backfillRemaining = Math.max(0, remaining);
  return store;
}

/** Spreads a day store onto the grid as discharge and charge columns. */
function storeToColumns(store, startMs, length) {
  const dis = new Float64Array(length).fill(NaN);
  const chg = new Float64Array(length).fill(NaN);
  let first = null;
  for (const [day, { dis: d, chg: c }] of Object.entries(store.days)) {
    const base = (Date.parse(`${day}T00:00:00Z`) - startMs) / SLOT_MS;
    for (let i = 0; i < d.length; i++) {
      const slot = base + i;
      if (slot < 0 || slot >= length || d[i] === null) continue;
      dis[slot] = d[i];
      chg[slot] = c[i];
      if (first === null || slot < first) first = slot;
    }
  }
  return { dis, chg, first };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(CACHE, { recursive: true });

  const [neso, batteries] = await Promise.all([fetchNesoGenMix(), fetchBatteryUnits()]);

  const sources = Object.keys(BATTERY_SOURCES);
  const stores = {};
  const deadline = started + BUDGET_MS;
  await Promise.all(sources.map(async (s) => {
    stores[s] = await updateStore(s, await loadStore(s), batteries, deadline);
    const json = JSON.stringify({ updated: new Date().toISOString(), ...stores[s] });
    await writeFile(`${CACHE}/battery-${s}.json`, json);
    await writeFile(`${OUT}/battery-${s}.json`, json);
  }));

  // One grid from the start of NESO's data to the latest slot any source has.
  const startMs = neso.startMs;
  let endSlot = neso.length - 1;
  for (const s of sources) {
    for (const [day, { dis }] of Object.entries(stores[s].days)) {
      const base = (Date.parse(`${day}T00:00:00Z`) - startMs) / SLOT_MS;
      for (let i = dis.length - 1; i >= 0; i--) {
        if (dis[i] !== null) {
          endSlot = Math.max(endSlot, base + i);
          break;
        }
      }
    }
  }
  const length = endSlot + 1;
  const columns = {};
  for (const [name, col] of Object.entries(neso.columns)) {
    const c = new Float64Array(length).fill(NaN);
    c.set(col.subarray(0, Math.min(col.length, length)));
    columns[name] = c;
  }
  const coverage = {};
  for (const s of sources) {
    const { dis, chg, first } = storeToColumns(stores[s], startMs, length);
    columns[`${s}_dis`] = dis;
    columns[`${s}_chg`] = chg;
    coverage[s] = { first, backfillRemaining: stores[s].backfillRemaining };
    const recent = [...dis.subarray(-48 * 7)].map((v, i) => [v, chg[length - 48 * 7 + i]]).filter(([v]) => !Number.isNaN(v));
    if (recent.length) {
      const max = Math.max(...recent.map(([v]) => v));
      const min = Math.min(...recent.map(([, c]) => c));
      const mwh = recent.reduce((n, [v, c]) => n + (v + c) / 2, 0);
      log(`battery ${s}: past week peak discharge ${max} MW, peak charge ${min} MW, net ${Math.round(mwh)} MWh`);
    }
  }

  const { names, missing, gz } = encodeColumns(columns, length);
  await writeFile(`${OUT}/series.bin.gz`, gz);
  const lastValid = (name) => {
    const col = columns[name];
    for (let i = length - 1; i >= 0; i--) if (!Number.isNaN(col[i])) return i;
    return null;
  };
  const meta = {
    generated: new Date().toISOString(),
    startMs,
    stepMinutes: 30,
    length,
    columns: names,
    missing,
    lastSlot: Object.fromEntries(names.map((n) => [n, lastValid(n)])),
    battery: {
      coverage,
      units: batteries,
    },
  };
  await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
  log(`wrote ${OUT}/series.bin.gz (${(gz.length / 1e6).toFixed(2)} MB, ${names.length} columns x ${length} slots)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
