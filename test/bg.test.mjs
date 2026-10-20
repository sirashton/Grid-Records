import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, BG_SOURCES, BG_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeBulgaria, priceStale } from '../pipeline/build-bg.mjs';

const H = 3600;

test('Bulgaria: hourly readings fill quarter hours, batteries charge negative, no pumping column', () => {
  const t0 = Date.UTC(2026, 6, 1) / 1000;
  const json = {
    unix_seconds: [t0, t0 + H],
    production_types: [
      { name: 'Nuclear', data: [2000, 1000] },
      { name: 'Fossil brown coal / lignite', data: [1500, 900] },
      { name: 'Solar', data: [0, 3000] },
      { name: 'Battery', data: [800, 0] },
      { name: 'Battery Consumption', data: [0, -2500] },
      { name: 'Load', data: [4200, 4000] },
      { name: 'Cross border electricity trading', data: [-600, 300] },
    ],
  };
  const p = parsePublicPower(json, { sources: BG_SOURCES, fillMinutes: 60 });
  assert.equal(p.length, 8);
  assert.deepEqual(p.columns.lignite, [1500, 1500, 1500, 1500, 900, 900, 900, 900]);
  assert.equal(p.columns.battery[0], 800);
  assert.equal(p.columns.battery_charge[4], -2500);
  assert.equal(p.columns.exports[0], -600);
  assert.equal(p.columns.imports[4], 300);
  assert.ok(!BG_COLUMNS.includes('pumped_storage_charge'));
  assert.ok(!BG_COLUMNS.includes('oil'));
  assert.ok(BG_COLUMNS.includes('battery_charge'));
});

test('Bulgaria: the first year starts at Sofia midnight, and blank load is missing', () => {
  const start = Date.UTC(2015, 0, 1);
  const power = { startMs: start, length: 3, columns: { nuclear: [2000, 2000, 2000], demand: [3500, 0, 3600], solar: [0, 0, 0] } };
  const m = mergeBulgaria([power], [{ startMs: NaN, length: 0, columns: {} }]);
  // Two hours of missing quarter hours in front: 22:00 UTC on 31 December.
  assert.equal(m.startMs, Date.UTC(2014, 11, 31, 22));
  assert.equal(m.length, 8 + 3);
  assert.ok(Number.isNaN(m.columns.nuclear[0]));
  assert.equal(m.columns.nuclear[8], 2000);
  assert.ok(Number.isNaN(m.columns.demand[9]));
  assert.equal(m.columns.solar[9], 0);
});

test('Bulgaria: current-year prices are refetched every six hours, not every run', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const at = (h) => ({ fetched: new Date(now - h * 3600000).toISOString(), version: 3 });
  assert.equal(priceStale(at(1), 2026, now), false);
  assert.equal(priceStale(at(7), 2026, now), true);
  assert.equal(priceStale(at(1000), 2023, now), false);
  assert.equal(priceStale(undefined, 2023, now), true);
});

test('Bulgaria story: lignite by hour, the evening, batteries and exports', async () => {
  const { storyFigures, EVENING } = await import('../site/js/bg/story.js');
  const cols = [...BG_COLUMNS, 'price'];
  // Two years and a month of quarter hours, from New Year 2024 in Sofia time.
  const startMs = Date.UTC(2023, 11, 31, 22);
  const length = 96 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Sofia', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const t = startMs + i * 900000;
    const hour = Number(hourOf.format(new Date(t)));
    const in2025 = t >= Date.UTC(2024, 11, 31, 22);
    const sunny = hour >= 11 && hour < 15;
    const evening = hour >= EVENING[0] && hour <= EVENING[1];
    columns.nuclear[i] = 2000;
    columns.solar[i] = sunny ? 3000 : 0;
    columns.demand[i] = 4000;
    // 2024: lignite 2 GW flat. 2025: batteries charge 2 GW at noon and give
    // 1.5 GW in the evening, when lignite drops to 0.5 GW.
    columns.lignite[i] = in2025 && evening ? 500 : 2000;
    columns.battery[i] = in2025 && evening ? 1500 : 0;
    columns.battery_charge[i] = in2025 && sunny ? -2000 : 0;
    columns.gas[i] = 200;
    // Exports 2.5 GW at noon, imports 0.5 GW otherwise.
    columns.exports[i] = sunny ? -2500 : 0;
    columns.imports[i] = sunny ? 0 : 500;
    columns.price[i] = sunny ? 5 : evening ? 200 : 100;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const y24 = f.rows.find((r) => r.year === 2024);
  const y25 = f.rows.find((r) => r.year === 2025);
  assert.ok(Math.abs(y24.ligTwh - 2 * 24 * 366 / 1000) < 1e-6);
  assert.ok(Math.abs(y24.eve.lig - 2) < 1e-9);
  assert.ok(Math.abs(y25.eve.lig - 0.5) < 1e-9);
  assert.ok(Math.abs(y25.eve.bat - 1.5) < 1e-9);
  assert.ok(Math.abs(y25.ligHour[19] - 0.5) < 1e-9 && Math.abs(y25.ligHour[3] - 2) < 1e-9);
  assert.ok(Math.abs(y25.chgHour[12] - 2) < 1e-9);
  assert.ok(Math.abs(y25.batTwh - 1.5 * 4 * 365 / 1000) < 1e-6);
  assert.equal(y24.batTwh, 0);
  // Lignite while exporting: the four sunny hours, at 2 GW.
  assert.ok(Math.abs(y24.ligExportingShare - 4 / 24) < 1e-9);
  // Exports of 2.5 GW cover 2 GW of lignite in those four hours.
  assert.equal(y24.ligCovered, 4 * 366);
  assert.ok(Math.abs(y25.priceHour[19] - 200) < 1e-9 && Math.abs(y25.mid.price - 5) < 1e-9);
  // Fossil (lignite + gas) under 1 GW only in 2025 evenings: 0.7 GW.
  assert.equal(y24.fosLow[1], 0);
  assert.equal(y25.fosLow[1], 4 * 365);
  assert.ok(Math.abs(y25.ligMin - 0.5) < 1e-9);
  assert.ok(f.batFirst > 96 * 366 - 8 && f.batFirst < 96 * 367);
  assert.ok(f.battery1Spell);
  // Load 4 GW against 2 GW nuclear, 2 GW lignite, 0.2 GW gas and 0.5 GW imports at 03:00.
  assert.ok(Math.abs(y24.gapHour[3] + 0.7) < 1e-9);
  // Solar only at midday here, so none after dark.
  assert.equal(y25.solDarkTwh, 0);
});

test('Bulgaria: an hour with every type at zero, and nuclear at zero, are missing', async () => {
  const { cleanBulgaria } = await import('../pipeline/build-bg.mjs');
  const col = (...v) => Float64Array.from(v);
  const columns = Object.fromEntries(BG_COLUMNS.map((k) => [k, col(0, 0, 0, 0)]));
  Object.assign(columns, { nuclear: col(2000, 0, 0, 0), lignite: col(1000, 0, 900, 120), gas: col(0, 0, 0, 190), wind_onshore: col(0, 0, 0, 300), demand: col(4000, 3800, 1500, 3400), exports: col(0, -16, 0, -1350) });
  cleanBulgaria(columns, 4);
  // Slot 3: 0.6 GW of generation less 1.35 GW of exports can't meet 3.4 GW of load.
  assert.ok(Number.isNaN(columns.lignite[3]) && Number.isNaN(columns.exports[3]));
  assert.equal(columns.nuclear[0], 2000);
  assert.ok(Number.isNaN(columns.lignite[1]) && Number.isNaN(columns.solar[1]));
  assert.equal(columns.demand[1], 3800);
  // Slot 2: lignite real, nuclear blank.
  assert.equal(columns.lignite[2], 900);
  assert.ok(Number.isNaN(columns.nuclear[2]));
});
