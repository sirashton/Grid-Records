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
  const power = { startMs: start, length: 3, columns: { nuclear: [2000, 2000, 2000], demand: [5000, 0, 5100], solar: [0, 0, 0] } };
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
