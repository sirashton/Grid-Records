import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentRecords } from '../site/js/recent.js';

// 200 days of half hours. Gas is 15 GW except for a 3-hour dip to 0.5 GW
// 10 days before the end, so the newest records are fossil spells.
function make() {
  const n = 200 * 48;
  const gas = new Float64Array(n).fill(15000);
  gas.fill(500, n - 480, n - 474);
  const zero = () => new Float64Array(n);
  return {
    startMs: Date.UTC(2026, 0, 1),
    length: n,
    meta: {},
    columns: { gas, coal: zero(), wind: new Float64Array(n).fill(5000), wind_emb: zero(), solar: zero(), nuclear: zero(), hydro: zero(), biomass: zero(), storage: zero(), imports: zero(), other: zero() },
  };
}

test('recentRecords reports the most demanding recent fossil record', () => {
  const recs = recentRecords(make(), { days: 30 });
  const fossil = recs.find((r) => r.kind === 'spell' && r.label === 'Fossil fuels');
  assert.equal(fossil.threshold, 1);
  assert.equal(fossil.slots, 6);
  assert.equal(fossil.live, false);
});

test('recentRecords includes recent single half-hour peaks', () => {
  const recs = recentRecords(make(), { days: 30, limit: 20 });
  const least = recs.find((r) => r.kind === 'peak' && r.label === 'Least fossil fuel');
  assert.equal(least.value, 0.5);
});

test('recentRecords takes another country\'s groups, series and total', async () => {
  const nz = await import('../site/js/nz/data.js');
  const n = 200 * 48;
  const coal = new Float64Array(n).fill(300);
  coal.fill(10, n - 480, n - 474);
  const data = { startMs: Date.UTC(2026, 0, 1), length: n, columns: { hydro: new Float64Array(n).fill(3000), coal } };
  const recs = recentRecords(data, {
    days: 30, limit: 20, series: nz.metricSeries, total: nz.generationTotal(data), greenFloor: 2000,
    watch: [{ label: 'Fossil fuels', members: ['coal'], mode: 'below', gw: [0.25, 0.1, 0.02] }],
    peaks: [{ label: 'Greenest half hour', members: ['hydro'], unit: 'pct', best: 'max' }],
  });
  const fossil = recs.find((r) => r.kind === 'spell');
  assert.equal(fossil.threshold, 0.02);
  assert.equal(fossil.slots, 6);
  const green = recs.find((r) => r.kind === 'peak');
  assert.ok(Math.abs(green.value - (3000 / 3010) * 100) < 1e-9);
});
