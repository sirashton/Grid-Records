import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, BE_SOURCES, BE_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeBelgium } from '../pipeline/build-be.mjs';

const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });

test('Belgium: Energy-Charts types map to the dataset columns', () => {
  const t0 = Date.UTC(2015, 6, 1) / 1000;
  const m = parsePublicPower(response([t0, t0 + 3600], {
    Nuclear: [4800, 4700],
    'Fossil hard coal': [400, 0],
    'Fossil gas': [2100, 2300],
    'Wind offshore': [500, 600],
    'Hydro Run-of-River': [30, 30],
    'Hydro water reservoir': [5, 5],
    'Hydro pumped storage': [0, 900],
    'Hydro pumped storage consumption': [-800, 0],
    Waste: [250, 250],
    Others: [50, 50],
    Load: [9000, 9500],
    'Cross border electricity trading': [-500, 1500],
  }), { sources: BE_SOURCES, fillMinutes: 60 });
  assert.deepEqual(Object.keys(m.columns), BE_COLUMNS);
  assert.deepEqual(m.columns.nuclear, [4800, 4800, 4800, 4800, 4700, 4700, 4700, 4700]);
  assert.equal(m.columns.coal[4], 0);
  assert.equal(m.columns.hydro[0], 35);
  assert.equal(m.columns.other[0], 300);
  assert.equal(m.columns.pumped_storage[4], 900);
  assert.equal(m.columns.pumped_storage_charge[0], -800);
  assert.equal(m.columns.exports[0], -500);
  assert.equal(m.columns.imports[4], 1500);
});

test('Belgium: blank load readings are missing, nuclear at zero is real', () => {
  const t = Date.UTC(2018, 9, 1);
  const power = { startMs: t, length: 3, columns: { nuclear: [1000, 0, 0], gas: [3000, 3100, 3200], demand: [9000, 0, 9100] } };
  const prices = { startMs: t, length: 4, columns: { price: [80, 81, 82, 83] } };
  const m = mergeBelgium([power], [prices]);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.demand[1]));
  assert.equal(m.columns.nuclear[2], 0);
  assert.deepEqual([...m.columns.price], [80, 81, 82]);
});
