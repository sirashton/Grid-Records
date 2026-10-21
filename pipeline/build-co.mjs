// Builds the Colombia data files from XM's API (pipeline/sources/xm.mjs) and
// writes site/data/co/.
//
// One month per pair of requests (generation and fuel burned, by plant). Each
// parsed month is kept in the Actions cache (.cache-co/), so a fresh cache
// backfills over a few runs, newest first. The current month is fetched
// again every run (XM adds a day at a time, about two days behind) and the
// three before it once a day, as XM revises its settlement figures.
//
// Usage: node pipeline/build-co.mjs [--budget-minutes N] [--from YYYY-MM] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CO_COLUMNS, PARSE_VERSION, fetchMonth, fetchPlants, parseMonth, plantMap, query, monthRange, entities, hourKeys } from './sources/xm.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, monthList, isStale, stitch } from './core/chunks.mjs';
import { lastFilled } from './core/recent.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2000-01' },
    out: { type: 'string', default: 'site/data/co' },
    cache: { type: 'string', default: '.cache-co' },
    concurrency: { type: 'string', default: '3' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const RUN_MS = 20 * 60000;

/** Whether month `index` (0 = current) should be fetched again. */
export function needsFetch(entry, index, nowMs) {
  if (index === 0 && entry) return nowMs - Date.parse(entry.fetched) > RUN_MS;
  return isStale(entry, index, nowMs, { version: PARSE_VERSION, recent: 4 });
}

/** Stitches the months and ends the grid at the last hour with generation. */
export function mergeColombia(pieces) {
  const merged = stitch(pieces, { stepMinutes: 60, columns: CO_COLUMNS });
  if (!merged) return null;
  const end = lastFilled(merged, CO_COLUMNS);
  for (const c of CO_COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  return { ...merged, length: end };
}

async function main() {
  await mkdir(args.out, { recursive: true });
  await mkdir(args.cache, { recursive: true });
  const now = Date.now();

  let plantsJson;
  try {
    plantsJson = await fetchPlants();
    await writeFile(`${args.cache}/plants.json`, JSON.stringify(plantsJson));
  } catch (err) {
    log(`CO: resource list failed (${err.message}), using the cached one`);
    plantsJson = JSON.parse(await readFile(`${args.cache}/plants.json`, 'utf8'));
  }
  const plants = plantMap(plantsJson);
  log(`CO: ${plants.size} plants in XM's resource list`);

  const cached = new Map();
  for (const f of await readdir(args.cache)) {
    if (/^\d{6}\.json$/.test(f)) cached.set(f.slice(0, 6), JSON.parse(await readFile(`${args.cache}/${f}`, 'utf8')));
  }
  const months = monthList(args.from, now);
  const queue = months.filter((ym, i) => needsFetch(cached.get(ym), i, now));
  log(`CO: ${cached.size} months cached, ${queue.length} to fetch`);

  const unknown = {};
  const { done, left } = await runQueue(queue, async (ym) => {
    const t = Date.now();
    const { gene, fuel } = await fetchMonth(ym);
    const piece = parseMonth(ym, gene, fuel, plants);
    for (const [k, v] of piece.unknown) unknown[k] = (unknown[k] ?? 0) + v;
    const entry = { version: PARSE_VERSION, fetched: new Date().toISOString(), ...piece };
    cached.set(ym, entry);
    await writeFile(`${args.cache}/${ym}.json`, JSON.stringify(entry));
    log(`CO: ${ym}: ${piece.days} days in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`CO: ${m}`) });
  log(`CO: fetched ${done} months, ${left} still to fetch`);
  const top = Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (top.length) log(`CO: unclassified plants (MWh, counted as other): ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`);

  const merged = mergeColombia(months.map((ym) => cached.get(ym)).filter(Boolean));
  if (!merged) {
    log('CO: no data yet, nothing written');
    return;
  }

  // A check against XM's own system total for the latest complete month.
  try {
    const ym = months.find((m, i) => i > 0 && cached.get(m));
    const { start, end } = monthRange(ym);
    const sys = entities(await query('hourly', { MetricId: 'Gene', StartDate: start, EndDate: end, Entity: 'Sistema', Filter: [] }));
    const sysMwh = sys.reduce((s, r) => s + hourKeys.reduce((a, k) => a + (Number(r[k]) || 0), 0), 0) / 1000;
    const p = cached.get(ym);
    const ours = CO_COLUMNS.reduce((s, c) => s + p.columns[c].reduce((a, v) => a + (v ?? 0), 0), 0);
    log(`CO: ${ym}: plants sum to ${(ours / 1e3).toFixed(0)} GWh, XM's system total ${(sysMwh / 1e3).toFixed(0)} GWh`);
  } catch (err) {
    log(`CO: system total check failed: ${err.message}`);
  }

  const have = months.filter((ym) => cached.get(ym)?.version === PARSE_VERSION).length;
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'co',
    timeZone: 'America/Bogota',
    stepMinutes: 60,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { months: { fetched: have, listed: months.length, toFetch: left } },
  }, { log });
  log(`CO: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
