// Builds the Belgium data files from Energy-Charts, and writes site/data/be/.
//
// Same source as Germany, Poland, France and Czechia (pipeline/build-cz.mjs,
// which this follows), so it shares Germany's cache rules and year merging: the current year is fetched
// again each run, so the page stays live. Readings are hourly in the early
// years and every 15 minutes later; hourly ones fill their four quarter
// hours. Day-ahead prices for the BE bidding zone ride along as `price`.
//
// Belgium builds in its own deploy job (the main build job is near its time
// limit), but Energy-Charts still allows only about two requests a minute, so
// every request waits REQUEST_GAP_MS first and a run stops at the first
// refusal. A cold cache (.cache-be/) fills in about 13 minutes.

// The queue named Elia's open data (ods201, 15 minutes), but it starts in
// 2020; Energy-Charts carries the same ENTSO-E figures back to 2015.
//
// Usage: node pipeline/build-be.mjs [--budget-minutes N] [--from YYYY] [--gap SECONDS]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchYear, fetchPrices, fetchInstalled, BE_SOURCES, BE_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energy-charts.mjs';
import { isStale, mergeYears } from './build-de.mjs';
import { writeDataset } from './core/dataset.mjs';
import { DAY_MS, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2015' },
    out: { type: 'string', default: 'site/data/be' },
    cache: { type: 'string', default: '.cache-be' },
    gap: { type: 'string', default: '31' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const REQUEST_GAP_MS = Number(args.gap) * 1000;
const COLUMNS = [...BE_COLUMNS, 'price'];
// Readings below these (MW) are ones Energy-Charts left blank, which the
// parser counts as zero: Belgian load has never been under 4 GW. Nuclear is
// not floored, because all of Belgium's reactors have been off at once.
export const FLOOR_MW = { demand: 4000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Merges generation and price years, ending at the last slot with generation. */
export function mergeBelgium(power, prices) {
  const merged = mergeYears([...power, ...prices], COLUMNS);
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && BE_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  for (const [c, floor] of Object.entries(FLOOR_MW)) {
    const col = merged.columns[c];
    for (let i = 0; i < end; i++) if (col[i] < floor) col[i] = NaN;
  }
  const out = { ...merged, length: end };
  dropUnreportedGas(out);
  return out;
}

const GEN_COLUMNS = BE_COLUMNS.filter((c) => c !== 'demand');
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' });

/**
 * Blanks gas on Belgian days when some gas plants went unreported. On those
 * days gas drops by a gigawatt or more at midnight and load runs that much
 * above generation plus net imports, as on 25 to 27 April and 16 to 18 May
 * 2025. Elia's load is itself off by up to about 0.6 GW for months at a time,
 * so each day is judged against the fortnight around it: a day whose balance
 * gap is GAP_MW above its neighbours', with gas at least half that gap below
 * theirs, has its gas set missing. Returns the days blanked.
 */
export const GAP_MW = 600;
export function dropUnreportedGas(data, stepMinutes = STEP_MINUTES) {
  const { columns: c, length, startMs } = data;
  const days = [];
  let cur = null;
  for (let i = 0; i < length; i++) {
    const key = dayOf.format(new Date(startMs + i * stepMinutes * 60000));
    if (cur?.key !== key) days.push((cur = { key, from: i, to: i, gap: 0, gas: 0, n: 0 }));
    cur.to = i + 1;
    if (!Number.isFinite(c.demand[i]) || !Number.isFinite(c.gas[i])) continue;
    let supply = 0;
    for (const k of GEN_COLUMNS) if (Number.isFinite(c[k][i])) supply += c[k][i];
    cur.gap += c.demand[i] - supply;
    cur.gas += c.gas[i];
    cur.n++;
  }
  for (const d of days) { d.gap /= d.n || NaN; d.gas /= d.n || NaN; }
  const median = (xs) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
  const dropped = [];
  days.forEach((d, j) => {
    const near = days.slice(Math.max(0, j - 7), j + 8).filter((x) => x !== d);
    const excess = d.gap - median(near.map((x) => x.gap));
    if (!(excess > GAP_MW) || !(median(near.map((x) => x.gas)) - d.gas > excess / 2)) return;
    c.gas.fill(NaN, d.from, d.to);
    dropped.push(d.key);
  });
  return dropped;
}

async function loadCache(dir) {
  await mkdir(dir, { recursive: true });
  const out = new Map();
  for (const f of await readdir(dir)) {
    if (f.endsWith('.json')) out.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
  }
  return out;
}

let refused = false;
/** One throttled request, or { skipped } once time is short or a request was refused. */
async function throttled(fn) {
  if (refused || Date.now() + REQUEST_GAP_MS > deadline) return { skipped: true };
  await sleep(REQUEST_GAP_MS);
  try {
    return { value: await fn() };
  } catch (err) {
    if (/HTTP (429|403)/.test(err.message)) refused = true;
    return { error: err };
  }
}

/** Fetches the stale years of one kind into its cache folder until the deadline. */
async function refresh(kind, dir, cached, years, fetchOne, now) {
  const queue = years.filter((y) => isStale(cached.get(y), y, now));
  let fetched = 0;
  for (const year of queue) {
    const r = await throttled(() => fetchOne(year));
    if (r.skipped) break;
    if (r.error) {
      log(`BE: ${kind} ${year} failed: ${r.error.message}`);
      continue;
    }
    const parsed = r.value;
    // A year with nothing is cached as empty, so it isn't asked for again.
    const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...(parsed ?? { startMs: NaN, length: 0, columns: {} }) };
    cached.set(year, entry);
    await writeFile(`${dir}/${year}.json`, JSON.stringify(entry));
    log(`BE: ${kind} ${year}: ${parsed ? `${parsed.length} quarter hours${parsed.types ? `, types ${parsed.types.join('; ')}` : ''}` : 'none'}`);
    fetched++;
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
  log(`BE: ${power.size} years and ${prices.size} price years in cache`);
  // Newest first in both, so a short run still keeps the page live.
  const leftPower = await refresh('generation', powerDir, power, years, (y) => fetchYear(y, { country: 'be', sources: BE_SOURCES, fillMinutes: 60 }), now);
  const leftPrices = await refresh('prices', priceDir, prices, years, (y) => fetchPrices(y, 'BE'), now);
  log(`BE: ${leftPower} generation years and ${leftPrices} price years still to fetch${refused ? ' (Energy-Charts refused a request, so this run stopped asking)' : ''}`);

  const merged = mergeBelgium([...power.values()], [...prices.values()]);
  if (!merged) {
    log('BE: no years yet, nothing written');
    return;
  }
  // Installed capacity changes once a year, so it is fetched at most once a day.
  const capFile = `${args.cache}/installed.json`;
  let installed = existsSync(capFile) ? JSON.parse(await readFile(capFile, 'utf8')) : null;
  if (!installed?.fetched || now - Date.parse(installed.fetched) > DAY_MS) {
    const r = await throttled(() => fetchInstalled('be'));
    if (r.value) {
      installed = { ...r.value, fetched: new Date().toISOString() };
      await writeFile(capFile, JSON.stringify(installed));
    } else if (r.error) log(`BE: installed capacity failed: ${r.error.message}`);
  }
  if (installed) await writeFile(`${args.out}/installed.json`, JSON.stringify({ years: installed.years, types: installed.types }));

  const got = [...power.entries()].filter(([, e]) => e.length).map(([y]) => y);
  const { bytes } = await writeDataset(args.out, {
    region: 'be',
    timeZone: 'Europe/Brussels',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: { first: Math.min(...got), last: Math.max(...got), toFetch: leftPower, pricesToFetch: leftPrices }, units: { price: 'EUR/MWh' } },
  }, { log });
  log(`BE: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${COLUMNS.length} columns x ${merged.length} slots) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
