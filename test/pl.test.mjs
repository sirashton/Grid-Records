import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, parsePrices, PL_SOURCES, PL_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergePoland } from '../pipeline/build-pl.mjs';

const t0 = Date.UTC(2015, 0, 5) / 1000;
const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });
const opts = { sources: PL_SOURCES, fillMinutes: 60 };

test('hourly readings fill their four quarter hours', () => {
  const m = parsePublicPower(response([t0, t0 + 3600], {
    'Fossil hard coal': [7390, 7336],
    'Wind onshore': [2559, 2485],
    Load: [14212, 14037],
    'Cross border electricity trading': [-527, 202],
  }), opts);
  assert.equal(m.startMs, t0 * 1000);
  assert.equal(m.length, 8);
  assert.deepEqual(m.columns.coal, [7390, 7390, 7390, 7390, 7336, 7336, 7336, 7336]);
  assert.deepEqual(m.columns.demand.slice(0, 4), [14212, 14212, 14212, 14212]);
  assert.deepEqual(m.columns.exports.slice(0, 5), [-527, -527, -527, -527, 0]);
  assert.deepEqual(m.columns.imports.slice(3, 5), [0, 202]);
  // Types Poland didn't list yet (solar, batteries) count as zero.
  assert.equal(m.columns.solar[0], 0);
  assert.deepEqual(Object.keys(m.columns), PL_COLUMNS);
});

test('switches from hourly to 15-minute readings without gaps or overlaps', () => {
  const ts = [t0, t0 + 3600, t0 + 4500, t0 + 5400];
  const m = parsePublicPower(response(ts, { 'Fossil hard coal': [1, 2, 3, 4], Solar: [0, 0, 0, 0], 'Battery Consumption': [-5, -5, -6, -7], Battery: [0, 1, 2, 3] }), opts);
  assert.deepEqual(m.columns.coal, [1, 1, 1, 1, 2, 3, 4]);
  // Charging is negative, discharge positive.
  assert.deepEqual(m.columns.battery_charge, [-5, -5, -5, -5, -5, -6, -7]);
  assert.deepEqual(m.columns.battery, [0, 0, 0, 0, 1, 2, 3]);
});

test('does not fill across a gap longer than an hour', () => {
  const m = parsePublicPower(response([t0, t0 + 3 * 3600], { 'Fossil hard coal': [1, 2], Solar: [0, 0] }), opts);
  assert.deepEqual(m.columns.coal.slice(0, 5), [1, 1, 1, 1, null]);
  assert.equal(m.columns.coal[12], 2);
});

test('prices fill hours and keep blanks missing', () => {
  const p = parsePrices({ unix_seconds: [t0, t0 + 3600, t0 + 7200], price: [40.12, null, -3] });
  assert.equal(p.length, 12);
  assert.deepEqual(p.columns.price.slice(0, 5), [40.1, 40.1, 40.1, 40.1, null]);
  assert.equal(p.columns.price[8], -3);
});

test('merges generation and prices, ending at the last generation slot', () => {
  const t = Date.UTC(2024, 5, 1);
  const power = { startMs: t, length: 2, columns: { coal: [5, 6] } };
  const prices = { startMs: t, length: 4, columns: { price: [10, 11, 12, 13] } };
  const m = mergePoland([power], [prices, { startMs: NaN, length: 0, columns: {} }]);
  assert.equal(m.startMs, t);
  assert.equal(m.length, 2);
  assert.deepEqual([...m.columns.price], [10, 11]);
  assert.equal(m.columns.coal[1], 6);
  assert.ok(Number.isNaN(m.columns.solar[0]));
});
