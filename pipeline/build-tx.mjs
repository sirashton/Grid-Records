// Builds the Texas (ERCOT) data files from ERCOT's Interval Generation by
// Fuel reports and fuel mix dashboard (pipeline/sources/ercot.mjs), and
// writes site/data/tx/.
//
// The history is one workbook a year: 2007 to 2024 in one zip on the Fuel
// Mix page, 2025 and the current year as their own files. Each parsed year
// is kept in the Actions cache (.cache-tx/years/) under the file's
// Last-Modified date, so a run downloads only a workbook ERCOT has replaced
// (the current year's, about monthly). The years before 2016 are .xls, read
// with Python's xlrd (pip install xlrd); without it they are skipped.
//
// The reports run a few weeks behind, so the dashboard's last two days are
// laid after them (pipeline/core/recent.mjs) and kept in the cache, so the
// latest data is within a quarter hour or so and the days between fill in as
// runs go by. A newly published month replaces the dashboard's figures.
//
// Usage: node pipeline/build-tx.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TX_COLUMNS, STEP_MINUTES, PARSE_VERSION, PAGE_URL, DASHBOARD_URL,
  parseWorkbook, pageLinks, parseDashboard, rowsToPiece,
} from './sources/ercot.mjs';
import { readWorkbook } from './sources/xlsx.mjs';
import { writeDataset } from './core/dataset.mjs';
import { stitch } from './core/chunks.mjs';
import { loadState, saveState, prune, extend, lastFilled } from './core/recent.mjs';
import { fetchText, log, DAY_MS } from './lib.mjs';

const exec = promisify(execFile);
const UA = { 'user-agent': 'grid-records (+https://github.com/sirashton/Grid-Records)' };
const RECENT_VERSION = 1;
// How long the dashboard rows are kept after the reports reach them.
const RECENT_KEEP_DAYS = 70;

async function head(url) {
  const r = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return `${r.headers.get('last-modified')}|${r.headers.get('content-length')}`;
}

async function download(url, file) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
}

/** A workbook's sheets, .xlsx in Node and .xls through Python's xlrd. */
async function sheetsOf(file) {
  if (/\.xlsx$/i.test(file)) return readWorkbook(file);
  const { stdout } = await exec('python3', [new URL('./sources/xls2json.py', import.meta.url).pathname, file], { maxBuffer: 1 << 30 });
  return JSON.parse(stdout);
}

/** Lays the years and the dashboard rows on one grid, ending at the last quarter with data. */
export function mergeTexas(years, recentRows) {
  const fuels = TX_COLUMNS.filter((c) => c !== 'biomass');
  // The current year's workbook covers the whole year, so it is cut at its
  // last data before the dashboard is laid after it.
  let grid = trim(stitch(years, { stepMinutes: STEP_MINUTES, columns: TX_COLUMNS }), fuels);
  grid = extend(grid, rowsToPiece(recentRows), { stepMinutes: STEP_MINUTES, columns: TX_COLUMNS });
  return trim(grid, fuels);
}

function trim(grid, names) {
  if (!grid) return null;
  const end = lastFilled(grid, names);
  if (!end) return null;
  const columns = Object.fromEntries(TX_COLUMNS.map((c) => [c, Float64Array.from(grid.columns[c].subarray(0, end))]));
  return { startMs: grid.startMs, length: end, columns };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'budget-minutes': { type: 'string', default: '4' },
      from: { type: 'string', default: '2007' },
      out: { type: 'string', default: 'site/data/tx' },
      cache: { type: 'string', default: '.cache-tx' },
    },
  });
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  const yearDir = `${args.cache}/years`;
  await mkdir(yearDir, { recursive: true });
  await mkdir(args.out, { recursive: true });
  const cached = new Map();
  for (const f of await readdir(yearDir)) {
    if (f.endsWith('.json')) cached.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${yearDir}/${f}`, 'utf8')));
  }
  log(`TX: ${cached.size} years in cache`);

  const save = async (year, stamp, piece) => {
    const entry = { stamp, version: PARSE_VERSION, fetched: new Date().toISOString(), ...piece };
    cached.set(year, entry);
    await writeFile(`${yearDir}/${year}.json`, JSON.stringify(entry));
    log(`TX: ${year}: ${piece.days} days${piece.unknown.length ? `, unmapped fuels ${piece.unknown.join(', ')}` : ''}`);
  };
  const current = (year, stamp) => cached.get(year)?.stamp === stamp && cached.get(year)?.version === PARSE_VERSION;

  const html = await fetchText(PAGE_URL);
  const links = pageLinks(html ?? '');
  log(`TX: page lists ${Object.keys(links.years).join(', ')}${links.previous ? ' and the previous years zip' : ''}`);
  const work = await mkdtempish();
  try {
    // The years with their own workbook, newest first.
    for (const year of Object.keys(links.years).map(Number).sort((a, b) => b - a)) {
      if (year < Number(args.from) || Date.now() > deadline) continue;
      const url = links.years[year];
      try {
        const stamp = await head(url);
        if (current(year, stamp)) continue;
        const file = join(work, `${year}${url.match(/\.xlsx?$/i)[0]}`);
        await download(url, file);
        await save(year, stamp, parseWorkbook(await sheetsOf(file), year));
      } catch (err) {
        log(`TX: ${year} failed: ${err.message}`);
      }
    }
    // The zip of earlier years, when any of them is missing or ERCOT replaced it.
    if (links.previous && Date.now() < deadline) {
      try {
        const stamp = await head(links.previous);
        const zipYears = [];
        for (let y = Number(args.from); y < Math.min(...Object.keys(links.years).map(Number), 9999); y++) zipYears.push(y);
        const todo = zipYears.filter((y) => !current(y, stamp));
        if (todo.length) {
          const zip = join(work, 'previous.zip');
          await download(links.previous, zip);
          await exec('unzip', ['-qq', '-o', zip, '-d', join(work, 'previous')]);
          const files = (await readdir(join(work, 'previous'))).filter((f) => /IntGenbyFuel\d{4}\.xlsx?$/i.test(f));
          for (const year of todo.sort((a, b) => b - a)) {
            if (Date.now() > deadline) break;
            const f = files.find((n) => n.toLowerCase().includes(`intgenbyfuel${year}.`));
            if (!f) continue;
            try {
              await save(year, stamp, parseWorkbook(await sheetsOf(join(work, 'previous', f)), year));
            } catch (err) {
              log(`TX: ${year} failed: ${err.message}`);
            }
          }
        }
      } catch (err) {
        log(`TX: previous years failed: ${err.message}`);
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // The last two days from the dashboard, kept between runs.
  const stateFile = `${args.cache}/recent.json`;
  const state = await loadState(stateFile, RECENT_VERSION);
  try {
    const rows = parseDashboard(JSON.parse(await fetchText(DASHBOARD_URL, { retries: 2 })));
    Object.assign(state.rows, rows);
    log(`TX: dashboard: ${Object.keys(rows).length} quarter hours`);
  } catch (err) {
    log(`TX: dashboard failed: ${err.message}`);
  }

  const years = [...cached.values()].filter((e) => e.length);
  const archive = stitch(years, { stepMinutes: STEP_MINUTES, columns: TX_COLUMNS });
  const archiveEnd = archive ? archive.startMs + lastFilled(archive, TX_COLUMNS) * STEP_MINUTES * 60000 : 0;
  prune(state, archiveEnd - RECENT_KEEP_DAYS * DAY_MS);
  await saveState(stateFile, state);

  const merged = mergeTexas(years, state.rows);
  if (!merged) {
    log('TX: no data yet, nothing written');
    return;
  }
  const got = [...cached.keys()].filter((y) => cached.get(y).length).sort();
  const { bytes } = await writeDataset(args.out, {
    region: 'tx',
    timeZone: 'America/Chicago',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: got, reportsEnd: archiveEnd, units: { other: 'MW, battery discharge included' } },
  }, { log });
  log(`TX: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${TX_COLUMNS.length} columns x ${merged.length} quarter hours), reports to ${new Date(archiveEnd).toISOString()}, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

async function mkdtempish() {
  const dir = join(tmpdir(), `ercot-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
