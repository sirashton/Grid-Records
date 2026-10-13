// Loads the half-hourly dataset and builds metric series from it.

export const FUELS = {
  gas: { label: 'Gas', fossil: true },
  coal: { label: 'Coal', fossil: true },
  nuclear: { label: 'Nuclear' },
  wind: { label: 'Wind', columns: ['wind', 'wind_emb'] },
  solar: { label: 'Solar' },
  hydro: { label: 'Hydro' },
  biomass: { label: 'Biomass' },
  battery: { label: 'Battery discharge', battery: true },
  storage: { label: 'Pumped storage' },
  imports: { label: 'Imports' },
  other: { label: 'Other' },
};

// Columns NESO counts in total generation. Batteries are already inside OTHER.
const GENERATION = ['gas', 'coal', 'nuclear', 'wind', 'wind_emb', 'solar', 'hydro', 'biomass', 'imports', 'storage', 'other'];

export const BATTERY_SOURCES = {
  pn: 'Elexon planned output (PN)',
  b1610: 'Elexon metered output (B1610)',
};

/** Fetches and decodes the dataset. */
export async function loadData(base = 'data') {
  const meta = await (await fetch(`${base}/meta.json`, { cache: 'no-cache' })).json();
  const res = await fetch(`${base}/series.bin.gz`, { cache: 'no-cache' });
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  const raw = await new Response(stream).arrayBuffer();
  const buf = new Int16Array(raw);
  const { length } = meta;
  const columns = {};
  meta.columns.forEach((name, c) => {
    const col = new Float64Array(length);
    let acc = 0;
    for (let i = 0; i < length; i++) {
      acc = i === 0 ? buf[c * length] : acc + buf[c * length + i];
      col[i] = acc;
    }
    for (const [s, n] of meta.missing[name] ?? []) col.fill(NaN, s, s + n);
    columns[name] = col;
  });
  return { meta, columns, length, startMs: meta.startMs };
}

/**
 * Builds a metric series in GW, or as a percentage of total generation.
 * Battery discharge counts as zero before the chosen source has data.
 */
export function metricSeries(data, members, { unit = 'gw', batterySource = 'pn' } = {}) {
  const { columns, length } = data;
  const cols = [];
  const batteryCols = [];
  for (const m of members) {
    if (FUELS[m]?.battery) {
      if (columns[`${batterySource}_dis`]) batteryCols.push(columns[`${batterySource}_dis`]);
    } else {
      for (const c of FUELS[m]?.columns ?? [m]) if (columns[c]) cols.push(columns[c]);
    }
  }
  const total = unit === 'pct' ? generationTotal(data) : null;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (const c of cols) v += c[i];
    for (const c of batteryCols) if (!Number.isNaN(c[i])) v += c[i];
    out[i] = total ? (v / total[i]) * 100 : v / 1000;
  }
  return out;
}

let cachedTotal = null;
export function generationTotal(data) {
  if (cachedTotal?.data === data) return cachedTotal.total;
  const total = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    let v = 0;
    for (const c of GENERATION) if (data.columns[c]) v += data.columns[c][i];
    total[i] = v > 0 ? v : NaN;
  }
  cachedTotal = { data, total };
  return total;
}

/** Index of the last slot where every listed column has data. */
export function lastComplete(data, names) {
  for (let i = data.length - 1; i >= 0; i--) {
    if (names.every((n) => !data.columns[n] || !Number.isNaN(data.columns[n][i]))) return i;
  }
  return -1;
}
