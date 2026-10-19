// AEMO's public data for Western Australia's Wholesale Electricity Market
// (WEM), which runs the South West Interconnected System (SWIS) around Perth.
// No key: https://data.wa.aemo.com.au/public/public-data/datafiles/
//
// - facility-scada: half-hourly energy (MWh) per facility from September 2006
//   to September 2023, one CSV per month.
// - facility-scada-csv: 5-minute average energy (MWh) per facility since the
//   market reform of 1 October 2023, one CSV per trading month (08:00 on the
//   1st to 08:00 on the next 1st). The current month's file is rewritten each
//   morning with data to 08:00 that day. Storage is negative when charging.
// - distributed-pv (half-hourly, November 2020 to June 2026) and
//   estimated-dpv-csv (5-minute, October 2023 on): AEMO's estimate of rooftop
//   solar output, in MW.
// - operational-demand (half-hourly, 2006 on) and
//   operational-demand-withdrawal-csv (5-minute, October 2023 on): what the
//   grid supplied, in MW. Rooftop solar lowers it.
//
// All times are Western Australian time (AWST, UTC+8, no daylight saving in
// the market), and each label is the start of its interval. Nothing names a
// facility's fuel, so FACILITY_FUELS maps the codes, with patterns for new ones.
import { fetchText } from '../lib.mjs';

export const BASE = 'https://data.wa.aemo.com.au/public/public-data/datafiles';
export const WA_TZ = 'Australia/Perth';
export const AWST_MS = 8 * 3600000;
export const SLOT_MS = 30 * 60000;

// Bump when parsing changes, so cached files are parsed again.
export const PARSE_VERSION = 1;

export const GEN_COLUMNS = ['coal', 'gas', 'oil', 'biomass', 'wind', 'solar_utility', 'other', 'battery', 'battery_charge'];
export const WA_COLUMNS = [...GEN_COLUMNS, 'solar_rooftop', 'demand'];

export const DATASETS = {
  scadaOld: { dir: 'facility-scada', match: /^facility-scada-(\d{4})-(\d{2})\.csv$/, kind: 'generation' },
  scada: { dir: 'facility-scada-csv', match: /^FacilityScada-(\d{4})-(\d{2})\.csv$/, kind: 'generation' },
  rooftopOld: { dir: 'distributed-pv', match: /^distributed-pv-(\d{4})()\.csv$/, kind: 'rooftop' },
  rooftop: { dir: 'estimated-dpv-csv', match: /^distributed-pv-new-(\d{4})()\.csv$/, kind: 'rooftop' },
  demandOld: { dir: 'operational-demand', match: /^operational-demand-(\d{4})()\.csv$/, kind: 'demand' },
  demand: { dir: 'operational-demand-withdrawal-csv', match: /^OperationalDemandWithdrawal-(\d{4})()\.csv$/, kind: 'demand' },
};
// The half-hourly facility files stop when the 5-minute ones begin.
export const OLD_SCADA_END = '2023-09';

// Facilities by fuel. Retired Kwinana units: stages A and C burnt coal
// (C could also burn gas), stage B oil then gas.
const COAL = ['COLLIE_G1', 'BW1_BLUEWATERS_G2', 'BW2_BLUEWATERS_G1', 'KWINANA_G1', 'KWINANA_G2', 'KWINANA_G5', 'KWINANA_G6',
  'MUJA_G1', 'MUJA_G2', 'MUJA_G3', 'MUJA_G4', 'MUJA_G5', 'MUJA_G6', 'MUJA_G7', 'MUJA_G8'];
const GAS = ['ALINTA_PNJ_U1', 'ALINTA_PNJ_U2', 'ALINTA_WGP_GT', 'ALINTA_WGP_U2', 'ALCOA_WGP', 'ALCOA_KWI', 'ALCOA_PNJ',
  'COCKBURN_CCG1', 'KEMERTON_GT11', 'KEMERTON_GT12', 'KWINANA_G3', 'KWINANA_G4', 'KWINANA_GT1', 'KWINANA_GT2', 'KWINANA_GT3',
  'NEWGEN_KWINANA_CCG1', 'NEWGEN_NEERABUP_GT1', 'PERTHENERGY_KWINANA_GT1', 'PPP_KCP_EG1', 'SWCJV_WORSLEY_COGEN_COG1',
  'TIWEST_COG1', 'STHRNCRS_EG', 'PRK_AG', 'MUNGARRA_GT1', 'MUNGARRA_GT2', 'MUNGARRA_GT3',
  'PINJAR_GT1', 'PINJAR_GT2', 'PINJAR_GT3', 'PINJAR_GT4', 'PINJAR_GT5', 'PINJAR_GT7', 'PINJAR_GT9', 'PINJAR_GT10', 'PINJAR_GT11'];
// Distillate peakers and small diesel sets.
const OIL = ['GERALDTON_GT1', 'WEST_KALGOORLIE_GT2', 'WEST_KALGOORLIE_GT3', 'NAMKKN_MERR_SG1',
  'TESLA_GERALDTON_G1', 'TESLA_KEMERTON_G1', 'TESLA_NORTHAM_G1', 'TESLA_PICTON_G1'];
// Landfill and sewage gas, and waste to energy.
const BIOMASS = ['BIOGAS01', 'ATLAS', 'CANNING_MELVILLE', 'GOSNELLS', 'KALAMUNDA', 'KALAMUNDA_SG', 'RED_HILL', 'ROCKINGHAM',
  'SOUTH_CARDUP', 'TAMALA_PARK', 'HENDERSON_RENEWABLE_IG1', 'PHOENIX_KWINANA_WTE_G1'];
// A small hydro station, and a unit no source describes.
const OTHER = ['PRDSO_WALPOLE_HG1', 'MHPS'];

export const FACILITY_FUELS = Object.fromEntries([
  ...COAL.map((c) => [c, 'coal']), ...GAS.map((c) => [c, 'gas']), ...OIL.map((c) => [c, 'oil']),
  ...BIOMASS.map((c) => [c, 'biomass']), ...OTHER.map((c) => [c, 'other']),
]);

/**
 * The fuel column for a facility code: '' for loads and demand-side
 * programmes, null for a code it can't place (counted as other, and logged).
 */
export function facilityFuel(code) {
  const c = String(code).toUpperCase();
  if (FACILITY_FUELS[c]) return FACILITY_FUELS[c];
  if (/_IL$|_DSP_/.test(c)) return '';
  // Solar farms with a battery behind the same connection count as solar.
  if (/PV|SOLAR|_SF_/.test(c)) return 'solar_utility';
  if (/_WF\d*$|_WF\d*_|_WWF/.test(c)) return 'wind';
  if (/_ESR\d*$|BESS/.test(c)) return 'battery';
  if (/COAL|BLUEWATERS|COLLIE_G|MUJA_G/.test(c)) return 'coal';
  if (/_GT\d*$|_CCG\d*$|COG\d*$/.test(c)) return 'gas';
  return null;
}

/** The UTC instant of a WA market time, "YYYY-MM-DD HH:MM[:SS]" or "DD/MM/YYYY HH:MM[:SS]". */
export function waToUtc(s) {
  const t = s.replace(/"/g, '').trim();
  let y, mo, d, rest;
  if (t[2] === '/') [d, mo, y, rest] = [t.slice(0, 2), t.slice(3, 5), t.slice(6, 10), t.slice(11)];
  else [y, mo, d, rest] = [t.slice(0, 4), t.slice(5, 7), t.slice(8, 10), t.slice(11)];
  const ms = Date.UTC(+y, +mo - 1, +d, +rest.slice(0, 2), +rest.slice(3, 5)) - AWST_MS;
  return Number.isNaN(ms) ? null : ms;
}

/** Files listed in one of the IIS directory pages: name, url, year, month and a change stamp. */
export function parseListing(html, ds) {
  const out = [];
  const re = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(\d+)\s+<A HREF="([^"]+)">([^<]+)<\/A>/gi;
  for (const m of html.matchAll(re)) {
    const name = m[5].trim();
    const hit = name.match(ds.match);
    if (!hit) continue;
    out.push({
      name,
      url: new URL(m[4], BASE).href.replace(/^http:/, 'https:'),
      year: +hit[1],
      month: hit[2] ? +hit[2] : null,
      size: +m[3],
      etag: `${m[1]} ${m[2]} ${m[3]}`,
    });
  }
  return out;
}

export async function listFiles(ds) {
  const html = await fetchText(`${BASE}/${ds.dir}/`, { timeoutMs: 60000 });
  return html ? parseListing(html, ds) : [];
}

/** Calls row(fields, index) for each data line of a comma-separated file (no commas inside fields). */
export function eachRow(text, row) {
  let index = null;
  let at = 0;
  while (at < text.length) {
    let nl = text.indexOf('\n', at);
    if (nl < 0) nl = text.length;
    const line = text.slice(at, text[nl - 1] === '\r' ? nl - 1 : nl);
    at = nl + 1;
    if (!line) continue;
    const fields = line.split(',').map((f) => (f.charCodeAt(0) === 34 ? f.slice(1, -1) : f));
    if (!index) index = Object.fromEntries(fields.map((h, i) => [h.trim().replace(/^﻿/, ''), i]));
    else row(fields, index);
  }
}

/**
 * Sums readings onto half-hour slots. add(ms, column, mw) takes one reading
 * that covers `stepMinutes` from ms; piece() averages each slot over the
 * readings it got (so a 5-minute gap doesn't read low), and leaves a slot
 * with fewer than half its readings missing.
 */
export function slotAccumulator(columns, stepMinutes) {
  const per = 30 / stepMinutes;
  const sums = new Map(); // slot ms -> { col: sum }
  const seen = new Map(); // slot ms -> Set of reading times
  return {
    add(ms, col, mw) {
      const slot = Math.floor(ms / SLOT_MS) * SLOT_MS;
      let s = sums.get(slot);
      if (!s) { s = {}; sums.set(slot, s); seen.set(slot, new Set()); }
      seen.get(slot).add(ms);
      if (col) s[col] = (s[col] ?? 0) + mw;
    },
    piece() {
      if (!sums.size) return { startMs: 0, length: 0, columns: {} };
      const slots = [...sums.keys()].sort((a, b) => a - b);
      const startMs = slots[0];
      const length = Math.round((slots.at(-1) - startMs) / SLOT_MS) + 1;
      const out = Object.fromEntries(columns.map((c) => [c, new Array(length).fill(null)]));
      for (const slot of slots) {
        const n = seen.get(slot).size;
        if (n * 2 < per) continue;
        const i = Math.round((slot - startMs) / SLOT_MS);
        const s = sums.get(slot);
        for (const c of columns) out[c][i] = Math.round(((s[c] ?? 0) / n) * 10) / 10;
      }
      return { startMs, length, columns: out };
    },
  };
}

/**
 * One facility file to fuel columns in MW. Half-hourly files give MWh per
 * half hour, 5-minute files average MWh per 5 minutes. Storage splits into
 * discharge and charging per facility; other fuels are summed and floored at
 * zero (a station's own use shows as small negatives when it is off).
 */
export function parseScada(text, { fiveMinute }) {
  const step = fiveMinute ? 5 : 30;
  const toMw = 60 / step;
  const acc = slotAccumulator(GEN_COLUMNS, step);
  const unknown = new Set();
  eachRow(text, (f, ix) => {
    const time = fiveMinute ? f[ix['Dispatch Interval']] : f[ix['Trading Interval']];
    const code = f[ix['Facility Code']];
    const raw = fiveMinute ? f[ix['Average MWh']] : f[ix['Energy Generated (MWh)']];
    const ms = time && waToUtc(time);
    if (ms == null) return;
    // A blank reading is missing, not zero.
    if (raw === '' || raw == null) return;
    const mw = Number(raw) * toMw;
    if (!Number.isFinite(mw)) return;
    let col = facilityFuel(code);
    if (col === '') return;
    if (col == null) { unknown.add(code); col = 'other'; }
    if (col === 'battery' && mw < 0) col = 'battery_charge';
    acc.add(ms, col, mw);
  });
  const piece = acc.piece();
  for (const c of GEN_COLUMNS) {
    if (c === 'battery_charge') continue;
    piece.columns[c] = piece.columns[c].map((v) => (v == null ? v : Math.max(0, v)));
  }
  return { ...piece, unknown: [...unknown] };
}

/** A rooftop solar or demand file to one column, from whichever time and value columns it has. */
export function parseSeries(text, column) {
  const rows = [];
  eachRow(text, (f, ix) => {
    const tKey = ['Trading Interval', 'Dispatch Interval', 'Timestamp'].find((k) => k in ix);
    const vKey = Object.keys(ix).find((k) => /^Estimated DPV Generation|^Operational Demand( \(MW\))?$/.test(k));
    if (!tKey || !vKey) return;
    const ms = waToUtc(f[ix[tKey]]);
    const v = f[ix[vKey]] === '' ? NaN : Number(f[ix[vKey]]);
    if (ms != null && Number.isFinite(v)) rows.push([ms, v]);
  });
  if (!rows.length) return { startMs: 0, length: 0, columns: {} };
  rows.sort((a, b) => a[0] - b[0]);
  // The 5-minute files' steps are 5 minutes apart; the older ones 30.
  let gap = Infinity;
  for (let i = 1; i < Math.min(rows.length, 50); i++) if (rows[i][0] > rows[i - 1][0]) gap = Math.min(gap, rows[i][0] - rows[i - 1][0]);
  const acc = slotAccumulator([column], gap <= 5 * 60000 ? 5 : 30);
  for (const [ms, v] of rows) acc.add(ms, column, v);
  return acc.piece();
}
