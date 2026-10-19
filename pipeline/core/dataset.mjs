// Writes a country's dataset in the one format every page reads: meta.json
// and series.bin.gz (see pipeline/encode.mjs). Each country's adapter
// (pipeline/build-<cc>.mjs) builds columns of average MW on a regular grid
// at its own native step, and hands them here. The rules are checked so a
// new country can't quietly break the shared record code.
// The full contract: docs/adding-a-country.md.
import { mkdir, writeFile } from 'node:fs/promises';
import { encodeColumns } from '../encode.mjs';

export const FORMAT_VERSION = 1;
export const STEPS = [5, 10, 15, 30, 60];

// Column names new countries should use where they apply. Older GB and NZ
// columns (storage, wind_emb, bioenergy, diesel, pn_dis...) predate the list.
export const CANONICAL_COLUMNS = [
  'coal', 'lignite', 'gas', 'oil', 'nuclear', 'hydro', 'pumped_storage', 'pumped_storage_charge',
  'wind', 'wind_onshore', 'wind_offshore', 'solar', 'solar_utility', 'solar_rooftop', 'geothermal',
  'biomass', 'battery', 'battery_charge', 'imports', 'exports', 'other', 'demand',
];
// Columns that take power off the grid, and so are zero or below.
const NEGATIVE = /(_charge|_chg|^exports)$/;
// Columns that may take either sign: a spot price in $/MWh, and operational
// demand, which goes below zero when rooftop solar outruns it (South Australia).
const SIGNED = /^(price|demand)$/;

/** A column of `length` slots, all missing. */
export const emptyColumn = (length) => new Float64Array(length).fill(NaN);

/** Throws if the dataset breaks the format's rules; returns warnings for softer problems. */
export function checkDataset({ region, timeZone, stepMinutes, startMs, length, columns }) {
  const fail = (msg) => { throw new Error(`dataset ${region}: ${msg}`); };
  const warnings = [];
  if (!/^[a-z]{2,3}$/.test(region ?? '')) fail('region must be a lower-case country code');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { fail(`unknown time zone ${timeZone}`); }
  if (!STEPS.includes(stepMinutes)) fail(`stepMinutes must be one of ${STEPS.join(', ')}`);
  if (!Number.isInteger(startMs) || startMs % (stepMinutes * 60000)) fail('startMs must be a whole multiple of the step');
  if (!Number.isInteger(length) || length <= 0) fail('length must be a positive integer');
  const names = Object.keys(columns);
  if (!names.length) fail('no columns');
  for (const name of names) {
    const col = columns[name];
    if (!/^[a-z][a-z0-9_]*$/.test(name)) fail(`column name ${name} must be lower snake case`);
    if (col.length !== length) fail(`column ${name} has ${col.length} slots, not ${length}`);
    let wrongSign = 0;
    let present = 0;
    for (let i = 0; i < length; i++) {
      const v = col[i];
      if (Number.isNaN(v)) continue;
      if (!Number.isFinite(v)) fail(`column ${name} has a non-finite value at slot ${i}`);
      present++;
      if (!SIGNED.test(name) && (NEGATIVE.test(name) ? v > 0.5 : v < -0.5)) wrongSign++;
    }
    if (!present) warnings.push(`column ${name} has no data`);
    if (wrongSign) warnings.push(`column ${name} has ${wrongSign} slots with the wrong sign (${NEGATIVE.test(name) ? 'charging and exports are 0 or below' : 'generation is 0 or more'})`);
  }
  return warnings;
}

/**
 * Checks, encodes and writes a dataset to outDir, returning its meta.
 * `extra` holds country-specific facts for the page (coverage, unit lists).
 */
export async function writeDataset(outDir, { region, timeZone, stepMinutes, startMs, length, columns, extra = {} }, { log = console.log } = {}) {
  for (const w of checkDataset({ region, timeZone, stepMinutes, startMs, length, columns })) log(`warning: ${region}: ${w}`);
  const { names, missing, base, gz } = encodeColumns(columns, length);
  const lastSlot = Object.fromEntries(names.map((n) => {
    const col = columns[n];
    let i = length - 1;
    while (i >= 0 && Number.isNaN(col[i])) i--;
    return [n, i >= 0 ? i : null];
  }));
  const meta = {
    ...extra,
    version: FORMAT_VERSION,
    region,
    timeZone,
    generated: new Date().toISOString(),
    startMs,
    stepMinutes,
    length,
    columns: names,
    missing,
    lastSlot,
    ...(Object.keys(base).length ? { base } : {}),
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/series.bin.gz`, gz);
  await writeFile(`${outDir}/meta.json`, JSON.stringify(meta));
  return { meta, bytes: gz.length };
}
