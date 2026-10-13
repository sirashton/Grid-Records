import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearlyMix, monthlyShares, yearlyHoursBelow, facts } from '../site/js/story.js';

// Four half hours on 31 Dec 2023 and four on 1 Jan 2024.
const startMs = Date.UTC(2023, 11, 31, 22);
const cols = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Float64Array.from(v)]));
const data = {
  startMs,
  length: 8,
  columns: cols({
    coal: [500, 500, 500, 500, 0, 0, 100, 0],
    gas: [500, 500, 500, 500, 4000, 6000, 4000, NaN],
    wind: [1000, 1000, 1000, 1000, 6000, 4000, 6000, 1000],
    wind_emb: [0, 0, 0, 0, 0, 0, 0, 0],
    solar: [0, 0, 0, 0, 0, 0, 0, 0],
    nuclear: [0, 0, 0, 0, 0, 0, 0, 0],
    storage: [0, 0, 0, 0, -500, 0, 0, 0],
  }),
};

test('yearlyMix splits by calendar year and ignores negative storage and missing slots', () => {
  const [y23, y24] = yearlyMix(data);
  assert.equal(y23.year, 2023);
  assert.equal(y23.shares.coal, 25);
  assert.equal(y23.shares.wind, 50);
  assert.equal(y24.year, 2024);
  assert.ok(Math.abs(y24.shares.wind - (16000 / 30100) * 100) < 1e-9);
  assert.equal(y24.shares.hydro, 0);
});

test('monthlyShares gives one point per month', () => {
  const out = monthlyShares(data, { fossil: ['gas', 'coal'] });
  assert.equal(out.fossil.length, 2);
  assert.equal(out.fossil[0][1], 50);
});

test('yearlyHoursBelow counts half hours under each threshold', () => {
  const rows = yearlyHoursBelow(data, ['gas', 'coal'], [5000, 1001]);
  assert.deepEqual(rows.map((r) => r.hours), [[2, 2], [1, 0]]);
});

test('facts finds the last real coal output and the best half hours', () => {
  const f = facts(data);
  assert.equal(f.lastCoal, 3);
  assert.equal(f.wind.v, 6000);
  assert.equal(f.fossil.v, 1000);
});
