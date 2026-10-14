// NESO Historic Generation Mix: half-hourly GB generation by fuel since 2009,
// updated hourly. This is the backbone of the dataset.
// https://www.neso.energy/data-portal/historic-generation-mix
import { fetchJson, fetchText, parseUtc, SLOT_MS, log } from '../lib.mjs';

const PACKAGE = 'https://api.neso.energy/api/3/action/package_show?id=historic-generation-mix';

// Ratcliffe-on-Soar, GB's last coal station, stopped generating on 30 Sept
// 2024. NESO and Elexon still show occasional coal blips after that (a single
// half hour on a Wednesday morning every few months, e.g. 133 MW on 23 Sept
// 2026, which NESO smears into an eight hour ramp). No coal plant can run, so
// coal is zero from this point on.
export const COAL_CLOSED_MS = Date.UTC(2024, 9, 1);

// Output column -> CSV header. NESO counts battery net discharge in OTHER and
// has said a dedicated battery column is coming; BESS is picked up if present.
export const NESO_COLUMNS = {
  gas: 'GAS',
  coal: 'COAL',
  nuclear: 'NUCLEAR',
  wind: 'WIND',
  wind_emb: 'WIND_EMB',
  solar: 'SOLAR',
  hydro: 'HYDRO',
  biomass: 'BIOMASS',
  imports: 'IMPORTS',
  storage: 'STORAGE',
  other: 'OTHER',
  neso_bess: ['BESS', 'BATTERY', 'BATTERIES'],
};

export async function fetchNesoGenMix() {
  const pkg = await fetchJson(PACKAGE);
  const resource = pkg?.result?.resources?.find((r) => /csv/i.test(r.format ?? r.url));
  if (!resource) throw new Error('NESO generation mix: no CSV resource found');
  log('NESO generation mix: downloading', resource.url);
  return parseNesoGenMix(await fetchText(resource.url, { timeoutMs: 300000 }));
}

/**
 * Parses the CSV into {startMs, length, columns: {name: Float64Array}} on a
 * regular half-hourly grid. Missing slots are NaN.
 */
export function parseNesoGenMix(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const timeIdx = header.indexOf('DATETIME');
  if (timeIdx < 0) throw new Error(`NESO generation mix: no DATETIME column in ${header.join(',')}`);
  const idx = {};
  for (const [name, heads] of Object.entries(NESO_COLUMNS)) {
    const i = [heads].flat().map((h) => header.indexOf(h)).find((i) => i >= 0);
    if (i !== undefined) idx[name] = i;
  }
  for (const name of ['gas', 'coal', 'nuclear', 'wind', 'solar']) {
    if (!(name in idx)) throw new Error(`NESO generation mix: missing ${name} column`);
  }

  const times = [];
  const rows = [];
  for (let l = 1; l < lines.length; l++) {
    const cells = lines[l].split(',');
    const t = parseUtc(cells[timeIdx]);
    if (Number.isNaN(t)) continue;
    times.push(t);
    rows.push(cells);
  }
  const startMs = Math.min(...times.slice(0, 10));
  const endMs = times.reduce((a, b) => Math.max(a, b), 0);
  const length = Math.round((endMs - startMs) / SLOT_MS) + 1;
  const columns = {};
  for (const name of Object.keys(idx)) columns[name] = new Float64Array(length).fill(NaN);

  let duplicates = 0;
  let offGrid = 0;
  for (let r = 0; r < rows.length; r++) {
    const slot = (times[r] - startMs) / SLOT_MS;
    if (!Number.isInteger(slot)) {
      offGrid++;
      continue;
    }
    if (!Number.isNaN(columns.gas[slot])) duplicates++;
    for (const [name, i] of Object.entries(idx)) {
      const v = Number.parseFloat(rows[r][i]);
      columns[name][slot] = Number.isFinite(v) ? v : NaN;
    }
  }
  // Dropouts: NESO occasionally reports gas, hydro and "other" all as exactly
  // zero for a half hour (e.g. 7 July 2026), which never happens on the real
  // grid. Treat those slots as missing rather than as zero-fossil records.
  let dropouts = 0;
  for (let i = 0; i < length; i++) {
    if (columns.gas[i] === 0 && columns.other?.[i] === 0 && columns.hydro?.[i] === 0) {
      for (const col of Object.values(columns)) col[i] = NaN;
      dropouts++;
    }
  }
  let coalBlips = 0;
  for (let i = Math.max(0, Math.ceil((COAL_CLOSED_MS - startMs) / SLOT_MS)); i < length; i++) {
    if (columns.coal[i] > 0) {
      columns.coal[i] = 0;
      coalBlips++;
    }
  }
  let missing = 0;
  for (const v of columns.gas) if (Number.isNaN(v)) missing++;
  log(`NESO generation mix: ${rows.length} rows, ${length} slots from ${new Date(startMs).toISOString()},`,
    `${missing} missing (${dropouts} dropouts), ${duplicates} duplicate, ${offGrid} off-grid, ${coalBlips} coal after closure zeroed; columns ${Object.keys(idx).join(',')}`);
  return { startMs, length, columns, stats: { rows: rows.length, missing, dropouts, duplicates, offGrid, coalBlips } };
}
