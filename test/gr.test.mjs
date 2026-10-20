import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, GR_SOURCES, GR_COLUMNS, PARSE_VERSION } from '../pipeline/sources/energy-charts.mjs';
import { mergeGreece, plan } from '../pipeline/build-gr.mjs';

const t0 = Date.UTC(2016, 0, 5) / 1000;
const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });

test('Greece: types map to columns, hourly readings fill four quarter hours', () => {
  const m = parsePublicPower(response([t0, t0 + 3600], {
    'Fossil brown coal / lignite': [2500, 2400],
    'Fossil gas': [1800, 1900],
    'Wind onshore': [900, 1000],
    'Hydro water reservoir': [300, 200],
    'Hydro pumped storage consumption': [-150, 0],
    Load: [6500, 6400],
    'Cross border electricity trading': [800, -300],
  }), { sources: GR_SOURCES, fillMinutes: 60 });
  assert.deepEqual(Object.keys(m.columns), GR_COLUMNS);
  assert.ok(!GR_COLUMNS.includes('nuclear'));
  assert.deepEqual(m.columns.lignite, [2500, 2500, 2500, 2500, 2400, 2400, 2400, 2400]);
  assert.equal(m.columns.wind[0], 900);
  assert.equal(m.columns.pumped_storage_charge[0], -150);
  assert.deepEqual([m.columns.imports[0], m.columns.exports[4]], [800, -300]);
  // Solar not listed yet counts as zero.
  assert.equal(m.columns.solar[0], 0);
});

test('Greece: a blank load or gas reading is missing, and the first year starts at Athens New Year', () => {
  const start = Date.UTC(2015, 0, 1);
  const power = { startMs: start, length: 3, columns: { demand: [6000, 0, 6100], gas: [1000, 0, 1000] } };
  const m = mergeGreece([power], []);
  // Two hours of missing slots in front: New Year in Athens is 22:00 UTC.
  assert.equal(m.startMs, start - 2 * 3600000);
  assert.equal(m.length, 8 + 3);
  assert.ok(Number.isNaN(m.columns.demand[0]));
  assert.ok(Number.isNaN(m.columns.demand[9]));
  assert.equal(m.columns.demand[10], 6100);
  assert.equal(m.columns.gas[8], 1000);
  assert.ok(Number.isNaN(m.columns.gas[9]));
});

test('Greece: the current year comes first, then missing years newest first', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const fresh = { fetched: new Date(now - 60000).toISOString(), version: PARSE_VERSION };
  const old = { fetched: '2026-02-01T00:00:00Z', version: PARSE_VERSION };
  const power = new Map([[2026, fresh], [2025, old], [2024, old]]);
  const prices = new Map([[2026, { ...fresh, fetched: new Date(now - 3600000).toISOString() }], [2025, old]]);
  const jobs = plan(power, prices, [2026, 2025, 2024, 2023], now);
  assert.deepEqual(jobs, [
    { kind: 'prices', year: 2026 },
    { kind: 'prices', year: 2024 },
    { kind: 'generation', year: 2023 },
    { kind: 'prices', year: 2023 },
  ]);
});

test('Greece story: lignite off, gas floor, zero prices and battery days', async () => {
  const { storyFigures, GAS_FLOOR } = await import('../site/js/gr/story.js');
  const cols = [...GR_COLUMNS, 'price'];
  // Two years and a month of quarter hours, from New Year 2024 in Athens.
  const startMs = Date.UTC(2023, 11, 31, 22);
  const length = 96 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Athens', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const t = startMs + i * 900000;
    const hour = Number(hourOf.format(new Date(t)));
    const sunny = hour >= 10 && hour < 15;
    const evening = hour >= 18 && hour < 22;
    const in2025 = t >= Date.UTC(2024, 11, 31, 22);
    // Lignite runs 1 GW through 2024 and stops in 2025.
    columns.lignite[i] = in2025 ? 0 : 1000;
    columns.gas[i] = sunny ? 500 : evening ? 3000 : 1500;
    columns.solar[i] = sunny ? 6000 : 0;
    columns.exports[i] = sunny ? -2000 : 0;
    columns.imports[i] = sunny ? 0 : 500;
    columns.price[i] = sunny ? (in2025 ? -1 : 0) : 120;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const [y24, y25] = f.rows;
  assert.ok(Math.abs(y24.ligTwh - 24 * 366 / 1000) < 1e-9);
  assert.equal(y25.ligTwh, 0);
  assert.equal(y25.ligOff, 365 * 24);
  assert.equal(y24.ligOff, 0);
  assert.equal(y25.ligDays, 0);
  assert.ok(Math.abs(y25.gasMin - 0.5) < 1e-9);
  assert.equal(y25.gasMax, 3);
  // Gas under 1 GW for the five sunny hours each day.
  assert.equal(y25.gasLow, 365 * 5);
  assert.equal(y25.zeroHours, 365 * 5);
  assert.equal(y25.negHours, 365 * 5);
  assert.equal(y24.negHours, 0);
  assert.equal(y24.zeroHours, 366 * 5);
  assert.ok(Math.abs(y25.cheapGas - 0.5) < 1e-9);
  assert.ok(Math.abs(y25.cheapExport - 2) < 1e-9);
  assert.equal(Math.round(y25.priceHour[12]), -1);
  assert.equal(Math.round(y25.priceHour[20]), 120);
  assert.equal(y24.ligHour[3], 1);
  assert.equal(y25.ligHour[3], 0);
  assert.ok(Math.abs(y25.expHour[12] - 2) < 1e-9 && Math.abs(y25.expHour[3] + 0.5) < 1e-9);
  // Evening gas: 4 h x 3 GW of a day's 5 x 0.5 + 4 x 3 + 15 x 1.5 = 37 GWh.
  assert.ok(Math.abs(y25.gasEveningShare - 12 / 37) < 1e-9);
  assert.ok(Math.abs(y25.gasImportingShare - 34.5 / 37) < 1e-9);
  // Above the floor each day: 4 h x 2 GW + 15 h x 0.5 GW = 15.5 GWh, peak 2 GW over it.
  assert.equal(GAS_FLOOR, 1);
  // The clock-change days run an hour short or long, so take the middle day.
  assert.ok(Math.abs(y25.gasDays[180].gwh - 15.5) < 1e-9);
  assert.deepEqual(y25.batteries.map((b) => b.days), [0, 0, 0, 365]);
  // Lignite last ran on the final slot of 2024; off since.
  assert.equal(f.ligLast, 96 * 366 - 1);
  assert.ok(f.ligOffSpell && f.ligOffSpell.start === 96 * 366);
  assert.equal(f.solarMax.solar, 6);
});
