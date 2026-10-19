import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FR_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeFrance } from '../pipeline/build-fr.mjs';

test('France: blank nuclear and load readings are missing, not zero', () => {
  const t = Date.UTC(2024, 5, 1);
  const power = { startMs: t, length: 3, columns: { nuclear: [45000, 0, 44000], demand: [52000, 30, 51000], solar: [0, 0, 0] } };
  const m = mergeFrance([power], []);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.nuclear[1]));
  assert.ok(Number.isNaN(m.columns.demand[1]));
  assert.equal(m.columns.nuclear[2], 44000);
  // Solar really is zero at night.
  assert.equal(m.columns.solar[1], 0);
  assert.ok(FR_COLUMNS.includes('nuclear'));
});
