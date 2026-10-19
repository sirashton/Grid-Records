import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, DE_COLUMNS, PARSE_VERSION } from '../pipeline/sources/energy-charts.mjs';
import { isStale, mergeYears } from '../pipeline/build-de.mjs';

const t0 = Date.UTC(2024, 5, 1) / 1000;
const response = (n, types) => ({
  unix_seconds: Array.from({ length: n }, (_, k) => t0 + k * 900),
  production_types: Object.entries(types).map(([name, data]) => ({ name, data: typeof data === 'function' ? Array.from({ length: n }, (_, k) => data(k)) : data })),
});

test('puts quarter hours on a 15-minute grid and groups types into columns', () => {
  const m = parsePublicPower(response(4, {
    Solar: (k) => k * 100,
    'Hydro Run-of-River': () => 2000,
    'Hydro water reservoir': () => 100,
    'Hydro pumped storage consumption': () => -500,
    'Cross border electricity trading': [1000, 3000, -2000, -1000],
    'Fossil oil': () => 300,
    'Fossil coal-derived gas': () => 400,
  }));
  assert.equal(m.startMs, Date.UTC(2024, 5, 1));
  assert.equal(m.length, 4);
  assert.deepEqual(m.columns.solar, [0, 100, 200, 300]);
  assert.deepEqual(m.columns.hydro, [2100, 2100, 2100, 2100]);
  // Pumping and exports are negative, as the dataset format has it.
  assert.deepEqual(m.columns.pumped_storage_charge, [-500, -500, -500, -500]);
  assert.deepEqual(m.columns.imports, [1000, 3000, 0, 0]);
  assert.deepEqual(m.columns.exports, [0, 0, -2000, -1000]);
  assert.deepEqual(m.columns.oil, [700, 700, 700, 700]);
  // Types not listed at all count as zero.
  assert.deepEqual(m.columns.nuclear, [0, 0, 0, 0]);
  assert.deepEqual(Object.keys(m.columns), DE_COLUMNS);
});

test('leaves a quarter hour missing if most types are blank', () => {
  const m = parsePublicPower(response(3, { Solar: [1, null, 3], 'Wind onshore': [10, null, 10], Nuclear: [8, 8, null] }));
  assert.deepEqual(m.columns.solar, [1, null, 3]);
  assert.equal(m.columns.wind_onshore[1], null);
});

test('counts one blank type as zero, as with nuclear after April 2023', () => {
  const m = parsePublicPower(response(1, { Solar: () => 100, 'Wind onshore': () => 50, Nuclear: [null] }));
  assert.deepEqual(m.columns.nuclear, [0]);
  assert.deepEqual(m.columns.solar, [100]);
});

test('merges years onto one grid, starting at New Year in German time', () => {
  const q = 900000;
  const t = Date.UTC(2015, 0, 1);
  const a = { startMs: t, length: 3, columns: { solar: [1, 2, null] } };
  const b = { startMs: t + 2 * q, length: 2, columns: { solar: [3, 4] } };
  const m = mergeYears([b, a]);
  // Four empty quarter hours in front, from 23:00 UTC on New Year's Eve.
  assert.equal(m.startMs, t - 3600000);
  assert.equal(m.length, 8);
  assert.deepEqual([...m.columns.solar].slice(4), [1, 2, 3, 4]);
  assert.ok(Number.isNaN(m.columns.solar[0]));
  assert.ok(Number.isNaN(m.columns.lignite[5]));
});

test('refreshes the current year, and last year only around New Year', () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const entry = (fetched) => ({ version: PARSE_VERSION, fetched: new Date(fetched).toISOString() });
  assert.equal(isStale(undefined, 2020, now), true);
  assert.equal(isStale({ ...entry(now), version: -1 }, 2020, now), true);
  assert.equal(isStale(entry(now - 3600000), 2026, now), true);
  assert.equal(isStale(entry(now - 60000), 2026, now), false);
  assert.equal(isStale(entry(Date.UTC(2026, 0, 20)), 2025, now), false);
  assert.equal(isStale(entry(Date.UTC(2026, 0, 2)), 2025, now), true);
  assert.equal(isStale(entry(Date.UTC(2020, 0, 2)), 2019, now), false);
});

test('works out the story figures: floor, ceiling, solar hours and the tightest hours', async () => {
  const { storyFigures, demandSeries } = await import('../site/js/de/story.js');
  const { DE_COLUMNS: cols } = await import('../pipeline/sources/energy-charts.mjs');
  // Two years and a month of quarter hours, from New Year 2024 in German time.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const perDay = 96;
  const length = perDay * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = (Math.floor(i / 4) + 1) % 24;
    columns.solar[i] = hour >= 11 && hour < 14 ? 30000 : 0;
    columns.lignite[i] = hour >= 18 ? 20000 : 8000;
    columns.wind_onshore[i] = 5000;
    columns.imports[i] = hour >= 18 ? 3000 : 0;
    columns.pumped_storage_charge[i] = -1000;
  }
  const data = { startMs, length, stepMinutes: 15, columns };
  assert.equal(demandSeries(data)[80], 20 + 5 + 3 - 1);
  const f = storyFigures(data, length);
  assert.deepEqual(f.years, [2024, 2025, 'past365']);
  const [y24] = f.rows;
  assert.equal(y24.fossilMin, 8);
  assert.equal(y24.fossilMax, 20);
  assert.equal(y24.solar22, 366 * 3);
  assert.equal(y24.fossil10, 366 * 18);
  assert.equal(y24.halfDays, 366);
  assert.equal(y24.top.fossil, 20);
  assert.equal(y24.top.imports, 3);
  assert.equal(f.importRun.hours[0], 6);
});
