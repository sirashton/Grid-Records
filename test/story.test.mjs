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

// All of 2023 (17520 half hours) then 100 half hours of 2024. Gas runs at
// 1000 MW in 2023 and 9000 MW in 2024; wind is a steady 1000 MW.
function longData() {
  const n = 17520 + 100;
  const gas = new Float64Array(n).fill(1000).fill(9000, 17520);
  gas[5] = NaN;
  return {
    startMs: Date.UTC(2023, 0, 1),
    length: n,
    columns: { gas, coal: new Float64Array(n), wind: new Float64Array(n).fill(1000), storage: new Float64Array(n).fill(-200) },
  };
}

test('yearlyMix gives complete years plus the past 365 days, ignoring negative storage', () => {
  const rows = yearlyMix(longData());
  assert.deepEqual(rows.map((r) => r.year), [2023, 'past365']);
  assert.equal(rows[0].shares.gas, 50);
  assert.equal(rows[0].shares.hydro, 0);
  // Past 365 days: 17420 slots at 1000 MW gas and 100 at 9000 MW.
  const gas = 17420 * 1000 + 100 * 9000;
  assert.ok(Math.abs(rows[1].shares.gas - (gas / (gas + 17520 * 1000)) * 100) < 1e-9);
});

test('yearlyHoursBelow counts half hours under each threshold, per year and for the past 365 days', () => {
  const rows = yearlyHoursBelow(longData(), ['gas', 'coal'], [5000]);
  assert.deepEqual(rows.map((r) => [r.year, r.hours[0]]), [[2023, 17519 / 2], ['past365', 17420 / 2]]);
});

test('monthlyShares gives one point per month', () => {
  const out = monthlyShares(data, { fossil: ['gas', 'coal'] });
  assert.equal(out.fossil.length, 2);
  assert.equal(out.fossil[0][1], 50);
});

test('facts finds the last real coal output and the best half hours', () => {
  const f = facts(data);
  assert.equal(f.lastCoal, 3);
  assert.equal(f.wind.v, 6000);
  assert.equal(f.fossil.v, 1000);
});
