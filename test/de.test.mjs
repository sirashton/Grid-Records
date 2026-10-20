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

test('works out the story figures: lignite by hour, the surplus, trade and batteries', async () => {
  const { storyFigures, demandSeries, FOSSIL_FLOOR, LIGNITE_DIP } = await import('../site/js/de/story.js');
  const { DE_COLUMNS: cols } = await import('../pipeline/sources/energy-charts.mjs');
  // Two years and a month of quarter hours, from New Year 2024 in German time.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const length = 96 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const hour = Number(hourOf.format(new Date(startMs + i * 900000)));
    const sunny = hour >= 11 && hour < 16;
    // 2025 dips lignite 3 GW at noon and exports; 2024 runs flat and imports in the evening.
    const in2025 = startMs + i * 900000 >= Date.UTC(2024, 11, 31, 23);
    columns.solar[i] = sunny ? 40000 : 0;
    columns.wind_onshore[i] = 5000;
    columns.lignite[i] = in2025 && sunny ? 5000 : 8000;
    columns.gas[i] = hour >= 18 ? 6000 : 1000;
    columns.exports[i] = in2025 && sunny ? -10000 : 0;
    columns.imports[i] = !sunny && hour >= 18 ? 3000 : 0;
    columns.pumped_storage_charge[i] = -1000;
  }
  const data = { startMs, length, stepMinutes: 15, columns };
  // A quarter hour at 20:00 in 2024: lignite 8, gas 6, wind 5, imports 3, pumping 1.
  assert.equal(demandSeries(data)[84], 8 + 6 + 5 + 3 - 1);
  const f = storyFigures(data, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const [y24, y25] = f.rows;
  // 2024: flat lignite, no surplus, no dip.
  assert.equal(y24.dipDays, 0);
  assert.equal(y24.surplus.hours, 0);
  assert.equal(y24.ligMin, 8);
  assert.equal(y24.fosMax, 14);
  assert.ok(Math.abs(y24.ligTwh - 8 * 24 * 366 / 1000) < 1e-6);
  // 2025: five sunny hours a day with wind and solar (45 GW) above demand (40 GW), lignite at 5 GW, exporting 10 GW.
  assert.equal(y25.surplus.hours, 365 * 5);
  assert.ok(Math.abs(y25.surplus.lignite - 5) < 1e-9);
  assert.ok(Math.abs(y25.surplus.exports - 10) < 1e-9);
  assert.equal(y25.dipDays, 365);
  assert.ok(Math.abs(y25.dip - 3) < 1e-9 && y25.dip > LIGNITE_DIP);
  assert.ok(Math.abs(y25.ligHour[13] - 5) < 1e-9);
  assert.ok(Math.abs(y25.ligHour[3] - 8) < 1e-9);
  // Fossil while importing: 6 hours a day (18:00 to midnight) at 14 GW of the day's total.
  const fossilDay = 14 * 6 + 9 * 13 + 6 * 5;
  assert.ok(Math.abs(y25.fosImportingShare - (14 * 6) / fossilDay) < 1e-9);
  assert.equal(y25.impHours, 365 * 6);
  // The tightest hours are evenings: lignite 8 and gas 6, imports 3.
  assert.equal(y25.top.fossil, 14);
  assert.equal(y25.top.imports, 3);
  // Fossil above the 5 GW floor: 9 GWh an hour for 6 hours, 4 for 13 and 1 for 5 = 111 GWh a day, peak 9 GW over the floor.
  assert.equal(FOSSIL_FLOOR, 5);
  // The median day; the clock-change days are an hour short or long.
  assert.ok(Math.abs(y25.fosDays[182].gwh - 111) < 1e-9);
  assert.deepEqual(y25.batteries.map((b) => b.days), [0, 0, 365, 365]);
  assert.equal(y25.fosLow10, 365 * 18);
  assert.equal(y25.fosLow5, 0);
  // Record spells: fossil under 10 GW for the 18 hours outside the evening, 19 on the October clock change.
  assert.equal((f.fossil10Spell.end - f.fossil10Spell.start) / 4, 19);
  assert.equal(f.fossil5Spell, null);
});
