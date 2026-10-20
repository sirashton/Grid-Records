// Japan: the area supply and demand results (エリア需給実績) that each general
// transmission and distribution operator publishes for its own area. Since
// April 2024 all of them use one layout (eria_jukyu_YYYYMM_NN.csv): average MW
// per half hour by fuel, with curtailed solar and wind, pumped storage and
// batteries signed (positive is output). Each operator hosts its own files, in
// its own folders, encodings and date formats; this module hides that.
//
// Nine of the ten areas are covered. Okinawa (area 10) is left out: it is not
// connected to the other nine, and its operator's site refuses automated
// requests. Adding it later means one more entry in AREAS; the national sum
// only counts slots that every listed area reported.
//
// Pure parsing lives here (tested in test/jp.test.mjs); fetching shells out to
// curl, because Kyushu's site turns away Node's own fetch.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);

export const PARSE_VERSION = 2;
export const STEP_MINUTES = 30;
const SLOT_MS = STEP_MINUTES * 60000;
const JST_MS = 9 * 3600000;

// Columns each area file gives, after the signed ones are split.
export const AREA_COLUMNS = [
  'demand', 'nuclear', 'gas', 'coal', 'oil', 'thermal_other', 'hydro', 'geothermal', 'biomass',
  'solar', 'solar_curtailed', 'wind', 'wind_curtailed', 'pumped_storage', 'pumped_storage_charge',
  'battery', 'battery_charge', 'other',
];
// The national dataset adds `thermal`, every thermal plant together: the
// operators' files before April 2024 don't split it by fuel, so it is the one
// fossil column that can run the whole history.
export const JP_COLUMNS = [...AREA_COLUMNS, 'thermal'];
export const THERMAL = ['gas', 'coal', 'oil', 'thermal_other'];

// Header names (after NFKC, which turns full-width brackets and letters into
// ASCII) to columns. Signed ones split into output and charging.
const HEADER = {
  'エリア需要': 'demand',
  '原子力': 'nuclear',
  '火力(LNG)': 'gas',
  '火力(石炭)': 'coal',
  '火力(石油)': 'oil',
  '火力(その他)': 'thermal_other',
  '水力': 'hydro',
  '地熱': 'geothermal',
  'バイオマス': 'biomass',
  '太陽光発電実績': 'solar',
  '太陽光実績': 'solar',
  '太陽光出力制御量': 'solar_curtailed',
  '太陽光抑制量': 'solar_curtailed',
  '風力発電実績': 'wind',
  '風力実績': 'wind',
  '風力出力制御量': 'wind_curtailed',
  '風力抑制量': 'wind_curtailed',
  '揚水': 'pumped',
  '蓄電池': 'battery_signed',
  'その他': 'other',
};
const SPLIT = { pumped: ['pumped_storage', 'pumped_storage_charge'], battery_signed: ['battery', 'battery_charge'] };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

// Fiscal years of the older hourly files (April 2016 to March 2024).
const OLD_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
const quarters = (f) => OLD_YEARS.flatMap((y) => [1, 2, 3, 4].map((q) => f(y, q)));
const yearly = (f) => OLD_YEARS.map((y) => f(y));

/**
 * The operators' areas, in OCCTO's order: where each keeps its monthly files
 * (`month`, sources tried in order), any daily files for the latest days
 * (`daily`), and its older hourly files (`history`: a list of { name, url },
 * or a page whose links match `pattern`).
 */
export const AREAS = [
  // Hokkaido's monthly file runs a day or two behind; the forecast site's
  // daily file covers the gap, updated through the day.
  { code: '01', key: 'hokkaido', name: 'Hokkaido',
    month: (ym) => [{ url: `https://www.hepco.co.jp/network/con_service/public_document/supply_demand_results/csv/eria_jukyu_${ym}_01.csv` }],
    daily: (ymd) => `https://denkiyoho.hepco.co.jp/area/data/${ymd}_hokkaido_jukyu.csv`,
    // The 2018 second quarter is only published as .xls, so it is a gap.
    history: quarters((y, q) => ({ name: `${y}_${q}q`, url: `https://www.hepco.co.jp/network/con_service/public_document/supply_demand_results/csv/sup_dem_results_${y}_${q}q.csv` })) },
  // Tohoku posts a month's file around the 25th of the next; until then the
  // same rows come as a zip of daily files.
  { code: '02', key: 'tohoku', name: 'Tohoku',
    month: (ym) => [
      { url: `https://setsuden.nw.tohoku-epco.co.jp/common/demand/eria_jukyu_${ym}_02.csv` },
      { url: `https://setsuden.nw.tohoku-epco.co.jp/get_realtime_jukyu.php?year=${ym.slice(0, 4)}&month=${ym.slice(4)}`, zip: /realtime_jukyu_\d{8}_02\.csv$/, partial: true },
    ],
    history: quarters((y, q) => ({ name: `${y}_${q}Q`, url: `https://setsuden.nw.tohoku-epco.co.jp/common/demand/juyo_${y}_tohoku_${q}Q.csv` })) },
  // TEPCO's yearly files are in 万kWh; the parser scales them.
  { code: '03', key: 'tepco', name: 'Tokyo',
    month: (ym) => [{ url: `https://www.tepco.co.jp/forecast/html/images/eria_jukyu_${ym}_03.csv` }],
    history: yearly((y) => ({ name: `${y}`, url: `https://www.tepco.co.jp/forecast/html/images/area-${y}.csv` })) },
  // Chubu keeps only the current month as a CSV; earlier months are in a zip
  // per fiscal year (April to March).
  { code: '04', key: 'chubu', name: 'Chubu',
    month: (ym) => [
      { url: `https://powergrid.chuden.co.jp/denki_yoho_content_data/eria_jukyu_${ym}_04.csv` },
      { url: `https://powergrid.chuden.co.jp/denki_yoho_content_data/eria_jukyu_${fiscalYear(ym)}.zip`, zip: new RegExp(`eria_jukyu_${ym}_04\\.csv$`) },
    ],
    history: yearly((y) => ({ name: `${y}`, url: `https://powergrid.chuden.co.jp/denki_yoho_content_data/${y}_areabalance_current_term.csv` })) },
  // Hokuriku's older files are quarterly, then monthly, with one odd name,
  // so they are read off its list page.
  { code: '05', key: 'hokuriku', name: 'Hokuriku',
    month: (ym) => [{ url: `https://www.rikuden.co.jp/nw/denki-yoho/csv/eria_jukyu_${ym}_05.csv` }],
    history: { page: 'https://www.rikuden.co.jp/nw_jyukyudata/area_jisseki.html', pattern: /\/nw_jyukyudata\/attach\/area_jisseki_rikuden(\d{6}(?:_\d{2})?)\.csv/g, base: 'https://www.rikuden.co.jp' } },
  { code: '06', key: 'kansai', name: 'Kansai',
    month: (ym) => [{ url: `https://www.kansai-td.co.jp/interchange/denkiyoho/area-performance/eria_jukyu_${ym}_06.csv` }],
    history: yearly((y) => ({ name: `${y}`, url: `https://www.kansai-td.co.jp/denkiyoho/csv/area_jyukyu_jisseki_${y}.csv` })) },
  { code: '07', key: 'chugoku', name: 'Chugoku',
    month: (ym) => [{ url: `https://www.energia.co.jp/nw/jukyuu/sys/eria_jukyu_${ym}_07.csv` }],
    history: yearly((y) => ({ name: `${y}`, url: `https://www.energia.co.jp/nw/service/retailer/data/area/csv/kako-${y}.csv` })) },
  // Shikoku's older years are workbooks, in 万kW.
  { code: '08', key: 'shikoku', name: 'Shikoku',
    month: (ym) => [{ url: `https://www.yonden.co.jp/nw/supply_demand/csv/eria_jukyu_${ym}_08.csv` }],
    history: yearly((y) => ({ name: `${y}`, url: `https://www.yonden.co.jp/nw/supply_demand/jukyu${y}.xlsx` })) },
  // Kyushu labels each half hour by its end (0:30 to 24:00); the parser
  // spots that from the 24:00 rows. Its first three years go by Heisei year.
  { code: '09', key: 'kyushu', name: 'Kyushu',
    month: (ym) => [{ url: `https://www.kyuden.co.jp/td_area_jukyu/csv/eria_jukyu_${ym}_09.csv` }],
    history: quarters((y, q) => {
      const label = y < 2019 ? `H${y - 1988}` : `${y}`;
      return { name: `${y}_${q}Q`, url: `https://www.kyuden.co.jp/td_area_jukyu/csv_area_jyukyu_jisseki/area_jyukyu_jisseki_${label}_${q}Q.csv` };
    }) },
];

// The first month in the shared layout any operator published. Months an
// operator didn't publish are cached as missing; its older files cover them.
export const FIRST_MONTH = '2024-02';

/** The fiscal year (starting in April) a YYYYMM month belongs to. */
export function fiscalYear(ym) {
  const y = Number(ym.slice(0, 4));
  return Number(ym.slice(4)) >= 4 ? y : y - 1;
}

/** Text from bytes: UTF-8 when the bytes are valid UTF-8, Shift_JIS (cp932) otherwise. */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** One CSV line to cells, honouring double quotes (some files quote "2,555"). */
export function csvCells(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** A number from a cell: blank, dashes or text are null; thousands commas are dropped. */
export function cellNumber(s) {
  if (s == null) return null;
  const t = s.normalize('NFKC').replace(/,/g, '').trim();
  if (!t || !/^[-+]?\d*\.?\d+$/.test(t)) return null;
  return Number(t);
}

/** Y, M, D from 2026/9/1, 2026/09/01, 2026-09-01 or 20260901. */
export function parseDate(s) {
  const t = s.normalize('NFKC').trim();
  let m = t.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Minutes after midnight from 0:00, 00:30, 1:30:00, 24:00 or 13時. */
export function parseTime(s) {
  const t = s.normalize('NFKC').trim();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?(?:時)?/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

/** UTC ms of a Japan local date and minute of day. Japan has no daylight saving. */
export const jstMs = ([y, mo, d], minutes) => Date.UTC(y, mo - 1, d) + minutes * 60000 - JST_MS;

/**
 * Parses one area file in the shared layout. Rows with no area demand (the
 * rest of the current month, published blank) are left out; within a row
 * that has demand, a blank cell is a fuel the area doesn't have, so 0.
 * Returns { startMs, length, columns } at 30 minutes, NaN where no row.
 */
export function parseEria(text) {
  // Kansai's files mix CR and CRLF line ends.
  const lines = text.split(/\r\n|\r|\n/);
  const hi = lines.findIndex((l) => /^"?(DATE|年月日)"?\s*,\s*"?(TIME|時刻)"?/i.test(l.normalize('NFKC')));
  if (hi < 0) throw new Error('no DATE,TIME header');
  const header = csvCells(lines[hi]).map((h) => h.normalize('NFKC').replace(/\s/g, ''));
  const idx = {};
  header.forEach((h, i) => { if (HEADER[h] && idx[HEADER[h]] == null) idx[HEADER[h]] = i; });
  if (idx.demand == null) throw new Error(`no area demand column in ${header.join(',')}`);
  const rows = [];
  let endLabelled = false;
  for (let li = hi + 1; li < lines.length; li++) {
    const cells = csvCells(lines[li]);
    if (cells.length < 3) continue;
    const date = parseDate(cells[0]);
    const minutes = parseTime(cells[1] ?? '');
    if (!date || minutes == null) continue;
    if (minutes === 1440) endLabelled = true;
    const demand = cellNumber(cells[idx.demand]);
    rows.push({ date, minutes, cells, demand });
  }
  // Kyushu-style files label each half hour by its end, 0:30 to 24:00.
  const shift = endLabelled ? -SLOT_MS : 0;
  const kept = rows.filter((r) => r.demand != null);
  if (!kept.length) return { startMs: NaN, length: 0, columns: {} };
  const times = kept.map((r) => jstMs(r.date, r.minutes) + shift);
  const startMs = Math.min(...times);
  const length = Math.round((Math.max(...times) - startMs) / SLOT_MS) + 1;
  const columns = Object.fromEntries(AREA_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]));
  kept.forEach((r, k) => {
    const i = Math.round((times[k] - startMs) / SLOT_MS);
    for (const c of AREA_COLUMNS) columns[c][i] = 0;
    for (const [name, col] of Object.entries(idx)) {
      const v = cellNumber(r.cells[col]) ?? 0;
      if (SPLIT[name]) {
        columns[SPLIT[name][0]][i] = Math.max(0, v);
        columns[SPLIT[name][1]][i] = Math.min(0, v);
      } else columns[name][i] = name === 'demand' ? v : Math.max(0, v);
    }
  });
  return { startMs, length, columns };
}

// The older hourly files (April 2016 to early 2024): one per operator and
// fiscal year or quarter, each in its own layout, thermal not split by fuel.
// Names after NFKC with units and spaces stripped. Kansai, Kyushu and Shikoku
// put 太陽光/風力 on a row above 実績 and 抑制量 (or 制御量), sometimes once over
// both columns, so a sub-name is joined to the nearest super-name above it.
const OLD_HEADER = {
  'エリア需要': 'demand', '東京エリア需要': 'demand', '需要': 'demand',
  '原子力': 'nuclear', '火力': 'thermal', '水力': 'hydro', '地熱': 'geothermal', 'バイオマス': 'biomass',
  '太陽光実績': 'solar', '太陽光発電実績': 'solar', '太陽光(実績)': 'solar',
  '太陽光抑制量': 'solar_curtailed', '太陽光制御量': 'solar_curtailed', '太陽光出力制御量': 'solar_curtailed', '太陽光(抑制量)': 'solar_curtailed', '太陽光(出力制御量)': 'solar_curtailed',
  '風力実績': 'wind', '風力発電実績': 'wind', '風力(実績)': 'wind',
  '風力抑制量': 'wind_curtailed', '風力制御量': 'wind_curtailed', '風力出力制御量': 'wind_curtailed', '風力(抑制量)': 'wind_curtailed', '風力(出力制御量)': 'wind_curtailed',
  '揚水': 'pumped', '揚水等': 'pumped',
};
const SUB_NAMES = new Set(['実績', '抑制量', '制御量']);
export const OLD_COLUMNS = ['demand', 'nuclear', 'thermal', 'hydro', 'geothermal', 'biomass', 'solar', 'solar_curtailed', 'wind', 'wind_curtailed', 'pumped_storage', 'pumped_storage_charge'];
const cleanName = (s) => (s ?? '').normalize('NFKC').replace(/[〔\[(](?:MWh|万kWh|MW)[〕\])]/gi, '').replace(/\s/g, '');

/** Date and minutes from a row's first cells: "2016/4/1 0:00", or a date cell and a time cell. */
function rowTime(cells, carried) {
  const first = (cells[0] ?? '').normalize('NFKC').trim();
  const both = first.match(/^(\S+)\s+(\d{1,2}:\d{2})/);
  if (both) {
    const date = parseDate(both[1]);
    const minutes = parseTime(both[2]);
    return date && minutes != null ? { date, minutes } : null;
  }
  const date = first ? parseDate(first) : carried;
  const minutes = parseTime(cells[1] ?? '');
  if (!date || minutes == null || !/^\d/.test((cells[1] ?? '').normalize('NFKC').trim())) return null;
  return { date, minutes };
}

/** Each header column's key, from the rows above the first data row. */
function oldHeaderIndex(headRows) {
  const width = Math.max(...headRows.map((c) => c.length), 0);
  // Row by row, the nearest name at or left of each column (for spanning super-names).
  const spread = headRows.map((cells) => {
    let last = '';
    return Array.from({ length: width }, (_, j) => (last = cleanName(cells[j]) || last));
  });
  const idx = {};
  for (let j = 0; j < width; j++) {
    let key = null;
    headRows.forEach((cells, r) => {
      let name = cleanName(cells[j]);
      if (!name) return;
      if (SUB_NAMES.has(name)) {
        for (let up = r - 1; up >= 0; up--) {
          const above = cleanName(headRows[up][j]) || spread[up][j];
          if (above && !SUB_NAMES.has(above)) { name = above + name; break; }
        }
      }
      if (OLD_HEADER[name]) key = OLD_HEADER[name];
    });
    if (key && idx[key] == null) idx[key] = j;
  }
  return idx;
}

/**
 * Parses one older hourly file, given as rows of cells. Each hour's MWh is
 * its average MW, and fills both of its half hours. Values in 万kWh or 万kW
 * (TEPCO, Shikoku) are scaled to MW. Returns { startMs, length, columns } at 30 minutes.
 */
export function parseHourly(rows) {
  let firstData = -1;
  for (let r = 0; r < rows.length; r++) {
    if (rowTime(rows[r], null)) { firstData = r; break; }
  }
  if (firstData < 0) throw new Error('no hourly rows');
  const headRows = rows.slice(0, firstData);
  const scale = headRows.some((cells) => cells.some((c) => /万kW/i.test(c.normalize('NFKC')))) ? 10 : 1;
  const idx = oldHeaderIndex(headRows);
  if (idx.demand == null) throw new Error(`no demand column in ${headRows.map((c) => c.join(',')).join(' / ')}`);
  const times = [];
  const vals = [];
  let carried = null;
  for (let r = firstData; r < rows.length; r++) {
    const cells = rows[r];
    const t = rowTime(cells, carried);
    if (!t) continue;
    carried = t.date;
    const demand = cellNumber(cells[idx.demand]);
    if (demand == null) continue;
    times.push(t);
    vals.push(cells);
  }
  if (!times.length) return { startMs: NaN, length: 0, columns: {} };
  const endLabelled = times.some((t) => t.minutes === 1440);
  const ms = times.map((t) => jstMs(t.date, t.minutes) - (endLabelled ? 3600000 : 0));
  const startMs = Math.min(...ms);
  const length = Math.round((Math.max(...ms) - startMs) / SLOT_MS) + 2;
  const columns = Object.fromEntries(OLD_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]));
  ms.forEach((t, k) => {
    const i = Math.round((t - startMs) / SLOT_MS);
    for (const s of [i, i + 1]) {
      for (const c of OLD_COLUMNS) columns[c][s] = 0;
      for (const [name, col] of Object.entries(idx)) {
        const v = (cellNumber(vals[k][col]) ?? 0) * scale;
        if (SPLIT[name]) {
          columns[SPLIT[name][0]][s] = Math.max(0, v);
          columns[SPLIT[name][1]][s] = Math.min(0, v);
        } else columns[name][s] = name === 'demand' ? v : Math.max(0, v);
      }
    }
  });
  return { startMs, length, columns };
}

/** Rows of cells from CSV text. */
export const csvRows = (text) => text.split(/\r\n|\r|\n/).map(csvCells);

/**
 * Rows of cells from an .xlsx sheet's XML and its shared strings (Shikoku).
 * Only what the operators' sheets use: shared strings, inline strings and
 * numbers; phonetic runs (<rPh>) are dropped. Excel date serials in the first
 * column are turned into Y/M/D text, and times (fractions of a day) into H:MM.
 */
export function xlsxRows(sheetXml, sharedXml = '') {
  const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, '')));
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1];
      if (!ref) continue;
      let col = 0;
      for (const ch of ref) col = col * 26 + ch.charCodeAt(0) - 64;
      col--;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const body = cm[2] ?? '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = '';
      if (type === 's' && v != null) text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = unescape(body.replace(/<rPh[\s\S]*?<\/rPh>/g, '').replace(/<[^>]+>/g, ''));
      else if (v != null) text = unescape(v);
      while (cells.length < col) cells.push('');
      cells[col] = text.trim();
    }
    // Dates as day serials, times as fractions of a day.
    if (/^\d{5}(\.0+)?$/.test(cells[0] ?? '')) {
      cells[0] = excelDate(Number(cells[0]));
      const f = Number(cells[1]);
      if (cells[1] !== '' && Number.isFinite(f) && f >= 0 && f < 1) {
        const m = Math.round(f * 1440);
        cells[1] = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
      }
    }
    rows.push(cells);
  }
  return rows;
}

/** Excel's day serial (1900 system) to Y/M/D text. */
export function excelDate(serial) {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Lays several pieces of one area onto one grid. Where a later piece has a
 * reading (area demand), it replaces the whole slot, columns it lacks
 * included, so an older hourly file never mixes with a newer split one.
 */
export function joinPieces(pieces, names = JP_COLUMNS) {
  const present = pieces.filter((p) => p && p.length);
  if (!present.length) return { startMs: NaN, length: 0, columns: {} };
  const startMs = Math.min(...present.map((p) => p.startMs));
  const length = Math.max(...present.map((p) => Math.round((p.startMs - startMs) / SLOT_MS) + p.length));
  const columns = Object.fromEntries(names.map((c) => [c, new Float64Array(length).fill(NaN)]));
  for (const p of present) {
    const base = Math.round((p.startMs - startMs) / SLOT_MS);
    const demand = p.columns.demand;
    for (let i = 0; i < p.length; i++) {
      const d = demand?.[i];
      if (d == null || Number.isNaN(d)) continue;
      for (const c of names) {
        const v = p.columns[c]?.[i];
        columns[c][base + i] = v == null ? NaN : v;
      }
    }
  }
  return { startMs, length, columns };
}

/** An area's thermal output at slot j: its own `thermal` (older files), or the four fuels added up. */
function areaThermal(cols, j) {
  const t = cols.thermal?.[j];
  if (t != null && !Number.isNaN(t)) return t;
  let s = 0;
  for (const c of THERMAL) {
    const v = cols[c]?.[j];
    if (v == null || Number.isNaN(v)) return NaN;
    s += v;
  }
  return s;
}

/**
 * The national series: at each slot, the sum over areas, only where every
 * area has a reading. A column is NaN wherever any area lacks it (fuel splits
 * before April 2024, batteries), so a missing area never reads as a dip.
 * `areas` maps area key to { startMs, length, columns } on one step.
 * `thermal` is every area's thermal output, split by fuel or not.
 */
export function combineAreas(areas, { names = JP_COLUMNS } = {}) {
  const list = Object.values(areas).filter((a) => a && a.length);
  if (!list.length || list.length < Object.keys(areas).length) return null;
  const startMs = Math.min(...list.map((a) => a.startMs));
  const length = Math.max(...list.map((a) => Math.round((a.startMs - startMs) / SLOT_MS) + a.length));
  const out = Object.fromEntries(names.map((c) => [c, new Float64Array(length).fill(NaN)]));
  const offsets = list.map((a) => Math.round((a.startMs - startMs) / SLOT_MS));
  for (let i = 0; i < length; i++) {
    let all = true;
    for (let k = 0; k < list.length && all; k++) {
      const j = i - offsets[k];
      const d = j >= 0 && j < list[k].length ? list[k].columns.demand[j] : NaN;
      if (Number.isNaN(d)) all = false;
    }
    if (!all) continue;
    for (const c of names) {
      let s = 0;
      for (let k = 0; k < list.length && !Number.isNaN(s); k++) {
        const j = i - offsets[k];
        const v = c === 'thermal' ? areaThermal(list[k].columns, j) : list[k].columns[c]?.[j];
        s = v == null ? NaN : s + v;
      }
      out[c][i] = s;
    }
  }
  return { startMs, length, columns: out };
}

/** Index one past the last slot with a demand reading. */
export function lastFilled(piece) {
  if (!piece?.length) return 0;
  let i = piece.length;
  while (i > 0 && Number.isNaN(piece.columns.demand[i - 1])) i--;
  return i;
}

// Fetching.

/** Downloads a URL to a file with curl; returns the HTTP status (0 on a network failure). */
export async function download(url, file) {
  try {
    const { stdout } = await run('curl', ['-sS', '-L', '--compressed', '-A', UA, '--retry', '3', '--retry-delay', '3', '--max-time', '180', '-o', file, '-w', '%{http_code}', url]);
    return Number(stdout.trim());
  } catch (err) {
    const code = Number(String(err.stdout ?? '').trim());
    if (code) return code;
    throw new Error(`curl failed for ${url}: ${String(err.stderr || err.message).trim().slice(0, 200)}`);
  }
}

const zipCache = new Map();
/** Fetches a zip once per run and returns its files as { name, bytes }; null when it isn't there. */
async function zipFiles(url) {
  if (!zipCache.has(url)) {
    zipCache.set(url, (async () => {
      const dir = await mkdtemp(join(tmpdir(), 'jp-zip-'));
      try {
        const status = await download(url, `${dir}/a.zip`);
        if (status === 404) return null;
        if (status !== 200) throw new Error(`HTTP ${status} for ${url}`);
        await run('unzip', ['-q', '-o', `${dir}/a.zip`, '-d', `${dir}/x`]);
        const names = (await readdir(`${dir}/x`, { recursive: true })).filter((n) => /\.csv$/i.test(n));
        return Promise.all(names.map(async (name) => ({ name, bytes: await readFile(`${dir}/x/${name}`) })));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    })());
  }
  return zipCache.get(url);
}

/** A URL's bytes, or null on a 404. Other failures throw. */
export async function fetchBytes(url) {
  const dir = await mkdtemp(join(tmpdir(), 'jp-get-'));
  try {
    const status = await download(url, `${dir}/f`);
    if (status === 404) return null;
    if (status !== 200) throw new Error(`HTTP ${status} for ${url}`);
    return await readFile(`${dir}/f`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ymdOf = (ms) => new Date(ms + JST_MS).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Fetches and parses one area's month, trying its sources in order, then
 * tops up the days after the monthly file's last reading from the area's
 * daily files, if it has them, up to today. Returns { ...piece, url, partial }
 * or null when no source has the month.
 */
export async function fetchAreaMonth(area, ym, { nowMs = Date.now() } = {}) {
  let piece = null;
  for (const src of area.month(ym)) {
    let parsed;
    if (src.zip) {
      const files = await zipFiles(src.url);
      const wanted = (files ?? []).filter((f) => src.zip.test(f.name));
      if (!wanted.length) continue;
      parsed = joinPieces(wanted.map((f) => parseEria(decodeText(f.bytes))));
    } else {
      const bytes = await fetchBytes(src.url);
      if (!bytes) continue;
      parsed = parseEria(decodeText(bytes));
    }
    if (parsed.length) { piece = { ...parsed, url: src.url, partial: !!src.partial }; break; }
  }
  if (!area.daily) return piece;
  const [y, m] = [Number(ym.slice(0, 4)), Number(ym.slice(4))];
  const monthStart = jstMs([y, m, 1], 0);
  const monthEnd = jstMs([m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1], 0);
  const from = piece ? piece.startMs + lastFilled(piece) * SLOT_MS : monthStart;
  // Daily files are kept for the latest days only.
  if (from >= monthEnd || nowMs - from > 10 * 86400000) return piece;
  const days = [];
  for (let t = from - ((from + JST_MS) % 86400000); t < Math.min(monthEnd, nowMs); t += 86400000) days.push(ymdOf(t));
  const extra = [];
  for (const d of days) {
    const bytes = await fetchBytes(area.daily(d));
    if (bytes) extra.push(parseEria(decodeText(bytes)));
  }
  if (!extra.some((p) => p.length)) return piece;
  // The monthly file wins where it has a reading.
  return { ...joinPieces([...extra, piece]), url: piece?.url ?? area.daily(days[0]), partial: true };
}

/** An area's older hourly files, as { name, url }: its list, or the links on its list page. */
export async function historyFiles(area) {
  const h = area.history;
  if (!h) return [];
  if (Array.isArray(h)) return h;
  const bytes = await fetchBytes(h.page);
  if (!bytes) return [];
  const found = new Map([...decodeText(bytes).matchAll(h.pattern)].map((m) => [m[1], `${h.base}${m[0]}`]));
  return [...found.keys()].sort().map((name) => ({ name, url: found.get(name) }));
}

/** Fetches and parses one older hourly file (CSV, or an .xlsx workbook); null when it isn't there. */
export async function fetchHistoryFile(file) {
  if (/\.xlsx$/i.test(file.url)) {
    const dir = await mkdtemp(join(tmpdir(), 'jp-xlsx-'));
    try {
      const status = await download(file.url, `${dir}/a.xlsx`);
      if (status === 404) return null;
      if (status !== 200) throw new Error(`HTTP ${status} for ${file.url}`);
      await run('unzip', ['-q', '-o', `${dir}/a.xlsx`, 'xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml', '-d', `${dir}/x`]);
      const sheet = await readFile(`${dir}/x/xl/worksheets/sheet1.xml`, 'utf8');
      const shared = await readFile(`${dir}/x/xl/sharedStrings.xml`, 'utf8').catch(() => '');
      return parseHourly(xlsxRows(sheet, shared));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const bytes = await fetchBytes(file.url);
  return bytes ? parseHourly(csvRows(decodeText(bytes))) : null;
}
