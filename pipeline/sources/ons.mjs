// ONS (Operador Nacional do Sistema Elétrico), Brazil's grid operator, open
// data on a public S3 bucket (no key, CC BY 4.0):
// https://dados.ons.org.br and s3://ons-aws-prod-opendata/dataset/
//
// Three datasets, all keyed by local time in Brasília (America/Sao_Paulo,
// which kept daylight saving until 2019):
// - geracao_usina_2_ho: hourly MWmed for every plant ONS dispatches or
//   estimates, since 2000, one CSV per year to 2021 and per month after. Since
//   2023 it also carries ONS's estimate of small distributed solar (MMGD).
// - balanco_energia_subsistema_ho: hourly load (carga) per subsystem and for
//   the whole interconnected system (SIN), one CSV per year since 2000.
// - restricao_coff_eolica_tm / restricao_coff_fotovoltaica_tm: half-hourly
//   constrained-off wind (from October 2021) and solar (from April 2024) per
//   plant, with ONS's estimate of the generation not realised (GNRa).
//
// On the day daylight saving started the files skip the missing hour; on the
// day it ended they hold the repeated hour once, so one UTC hour is missing.
const BUCKET = 'https://ons-aws-prod-opendata.s3.amazonaws.com';

export const BR_TZ = 'America/Sao_Paulo';
export const HOUR_MS = 3600000;

// Bump when parsing changes, so cached files are parsed again.
export const PARSE_VERSION = 3;

export const GEN_COLUMNS = ['hydro', 'nuclear', 'coal', 'gas', 'oil', 'other', 'biomass', 'wind', 'solar_utility', 'solar_rooftop'];
export const CURTAIL_COLUMNS = ['wind_curtailed', 'solar_curtailed'];
export const BR_COLUMNS = [...GEN_COLUMNS, ...CURTAIL_COLUMNS, 'demand'];

export const DATASETS = {
  generation: { prefix: 'dataset/geracao_usina_2_ho/', match: /^GERACAO_USINA-2_(\d{4})(?:_(\d{2}))?\.csv$/ },
  balance: { prefix: 'dataset/balanco_energia_subsistema_ho/', match: /^BALANCO_ENERGIA_SUBSISTEMA_(\d{4})()\.csv$/ },
  windCurtailment: { prefix: 'dataset/restricao_coff_eolica_tm/', match: /^RESTRICAO_COFF_EOLICA_(\d{4})_(\d{2})\.csv$/ },
  solarCurtailment: { prefix: 'dataset/restricao_coff_fotovoltaica_tm/', match: /^RESTRICAO_COFF_FOTOVOLTAICA_(\d{4})_(\d{2})\.csv$/ },
};

/**
 * Maps one plant row to an output column, from its plant type, fuel and
 * operating mode: '' for rows to skip, null for a combination it doesn't know.
 */
export function fuelColumn(type, fuel, mode) {
  const t = String(type ?? '').toUpperCase();
  const f = String(fuel ?? '').toLowerCase();
  // Pumping at the small Pedreira and Traição stations, listed as zero throughout.
  if (t.startsWith('BOMB')) return '';
  if (t.startsWith('HIDRO')) return 'hydro';
  if (t.startsWith('NUCLEAR')) return 'nuclear';
  if (t.startsWith('EOL')) return 'wind';
  if (t.startsWith('FOTO')) return /mmgd/i.test(mode ?? '') ? 'solar_rooftop' : 'solar_utility';
  if (t.startsWith('T')) {
    if (f.startsWith('gás') || f.startsWith('gas')) return 'gas';
    if (f.startsWith('carv')) return 'coal';
    if (f.includes('óleo') || f.includes('oleo') || f.includes('diesel')) return 'oil';
    if (f.startsWith('biomass')) return 'biomass';
    // "Outras Multi-Combustível" and "Resíduos Industriais" (steelworks and
    // refinery gases): fossil, but no single fuel.
    return 'other';
  }
  return null;
}

const offsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BR_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Brasília's offset from UTC at an instant, in ms (negative). */
export function brOffset(ms) {
  const p = Object.fromEntries(offsetFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}

/**
 * The UTC instant of a "YYYY-MM-DD HH:MM:SS" Brasília wall time. A wall time
 * that never happened (the hour skipped when saving started) gives null; the
 * repeated hour when it ended gives the earlier of the two.
 */
export function brToUtc(s) {
  const wall = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16));
  // Try the earlier (summer, -2h) offset first, then standard time (-3h).
  for (const guess of [wall + 2 * HOUR_MS, wall + 3 * HOUR_MS]) {
    if (guess + brOffset(guess) === wall) return guess;
  }
  return null;
}

/** The hourly UTC grid covering one file: a year, or a month when `month` is set. */
export function fileGrid(year, month) {
  const pad = (n) => String(n).padStart(2, '0');
  const from = month ? `${year}-${pad(month)}-01 00:00:00` : `${year}-01-01 00:00:00`;
  const [ny, nm] = month ? (month === 12 ? [year + 1, 1] : [year, month + 1]) : [year + 1, 1];
  const to = `${ny}-${pad(nm)}-01 00:00:00`;
  const startMs = brToUtc(from);
  return { startMs, length: Math.round((brToUtc(to) - startMs) / HOUR_MS) };
}

/**
 * Reads a semicolon-separated CSV from an async iterable of text chunks, and
 * calls row(fields, index) for each data line, with index mapping header
 * names to positions.
 */
export async function eachRow(chunks, row) {
  let rest = '';
  let pending = null; // a quoted field running over a line break
  let index = null;
  const record = (l) => {
    const fields = l.includes('"') ? splitQuoted(l) : l.split(';');
    if (!index) index = Object.fromEntries(fields.map((h, i) => [h.trim(), i]));
    else row(fields, index);
  };
  const line = (l) => {
    if (l.endsWith('\r')) l = l.slice(0, -1);
    if (pending != null) l = `${pending}\n${l}`;
    else if (!l) return;
    // An odd number of quotes so far means a field is still open.
    pending = (l.split('"').length - 1) % 2 ? l : null;
    if (pending == null) record(l);
  };
  for await (const chunk of chunks) {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop();
    for (const l of lines) line(l);
  }
  line(rest);
}

/** Splits a line with quoted fields ("a;b" and "" for a quote). */
export function splitQuoted(l) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (quoted) {
      if (c !== '"') cur += c;
      else if (l[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ';') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Sums rows into hourly columns on a file's grid; hours with no rows stay NaN. */
function accumulator(grid, names) {
  const cols = Object.fromEntries(names.map((c) => [c, new Float64Array(grid.length)]));
  const seen = new Uint8Array(grid.length);
  const times = new Map();
  return {
    /** The slot of a wall time, or -1 when it is outside the file or never happened. */
    slot(stamp) {
      if (typeof stamp !== 'string' || !/^\d{4}-\d\d-\d\d \d\d:\d\d/.test(stamp)) return -1;
      let i = times.get(stamp);
      if (i === undefined) {
        const ms = brToUtc(stamp);
        i = ms == null ? -1 : Math.floor((ms - grid.startMs) / HOUR_MS);
        if (i >= grid.length) i = -1;
        times.set(stamp, i);
      }
      return i;
    },
    add(i, col, v) {
      seen[i] = 1;
      if (col) cols[col][i] += v;
    },
    piece(scale = 1) {
      const columns = {};
      for (const c of names) {
        columns[c] = Array.from(cols[c], (v, i) => (seen[i] ? Math.round(v * scale * 10) / 10 : null));
      }
      return { ...grid, columns };
    },
  };
}

const num = (s) => {
  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
};

/** Parses one generation-by-plant file into hourly MW per fuel. */
export async function parseGeneration(chunks, year, month) {
  const acc = accumulator(fileGrid(year, month), GEN_COLUMNS);
  const unknown = {};
  await eachRow(chunks, (f, ix) => {
    const i = acc.slot(f[ix.din_instante]);
    if (i < 0) return;
    const col = fuelColumn(f[ix.nom_tipousina], f[ix.nom_tipocombustivel], f[ix.cod_modalidadeoperacao]);
    if (col == null) unknown[`${f[ix.nom_tipousina]}/${f[ix.nom_tipocombustivel]}`] = true;
    acc.add(i, col, num(f[ix.val_geracao]));
  });
  const piece = acc.piece();
  // One day a year in 2013 to 2015 every plant but one reads zero: that is
  // missing data, not a blackout. An hour under a quarter of the file's
  // median total is treated as missing.
  const total = (i) => GEN_COLUMNS.reduce((s, c) => s + (piece.columns[c][i] ?? 0), 0);
  const totals = [];
  for (let i = 0; i < piece.length; i++) if (piece.columns.hydro[i] != null) totals.push(total(i));
  totals.sort((a, b) => a - b);
  const floor = (totals[Math.floor(totals.length / 2)] ?? 0) / 4;
  for (let i = 0; i < piece.length; i++) {
    if (piece.columns.hydro[i] != null && total(i) < floor) for (const c of GEN_COLUMNS) piece.columns[c][i] = null;
  }
  return { ...piece, unknown: Object.keys(unknown) };
}

/** Parses one yearly energy balance file into hourly whole-system load. */
export async function parseBalance(chunks, year) {
  const acc = accumulator(fileGrid(year), ['demand']);
  await eachRow(chunks, (f, ix) => {
    if (f[ix.id_subsistema].trim() !== 'SIN') return;
    const i = acc.slot(f[ix.din_instante]);
    if (i >= 0) acc.add(i, 'demand', num(f[ix.val_carga]));
  });
  return acc.piece();
}

/**
 * Parses one monthly constrained-off file into the hourly MW not generated
 * because ONS limited the plants (GNRa), the average of the two half hours.
 */
export async function parseCurtailment(chunks, year, month, column) {
  const acc = accumulator(fileGrid(year, month), [column]);
  await eachRow(chunks, (f, ix) => {
    const i = acc.slot(f[ix.din_instante]);
    if (i >= 0) acc.add(i, column, num(f[ix.val_geracaonaorealizadaapurada]));
  });
  return acc.piece(0.5);
}

/** Lists a dataset's CSV files: [{ name, year, month, etag, size, url }]. */
export async function listFiles({ prefix, match }, { fetchImpl = fetch } = {}) {
  const out = [];
  let token = null;
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
    if (token) q.set('continuation-token', token);
    const res = await fetchImpl(`${BUCKET}/?${q}`);
    if (!res.ok) throw new Error(`ONS listing ${prefix}: HTTP ${res.status}`);
    const xml = await res.text();
    for (const [, body] of xml.matchAll(/<Contents>(.*?)<\/Contents>/gs)) {
      const key = /<Key>(.*?)<\/Key>/.exec(body)?.[1] ?? '';
      const name = key.slice(prefix.length);
      const m = match.exec(name);
      if (!m) continue;
      out.push({
        name,
        year: Number(m[1]),
        month: m[2] ? Number(m[2]) : null,
        etag: (/<ETag>(.*?)<\/ETag>/.exec(body)?.[1] ?? '').replace(/&quot;|"/g, ''),
        size: Number(/<Size>(\d+)<\/Size>/.exec(body)?.[1] ?? 0),
        url: `${BUCKET}/${key}`,
      });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>(.*?)<\/NextContinuationToken>/.exec(xml)?.[1] : null;
  } while (token);
  return out;
}

/** Streams a file's text, for the parsers above. */
export async function* fetchChunks(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const decoder = new TextDecoder('utf-8');
  for await (const bytes of res.body) yield decoder.decode(bytes, { stream: true });
  const tail = decoder.decode();
  if (tail) yield tail;
}
