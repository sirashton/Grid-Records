import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopes, windowEnvelopes } from '../site/js/envelope.js';

test('the 100% band always contains the series', () => {
  const v = Float64Array.from({ length: 500 }, (_, i) => Math.sin(i / 7) * 10 + (i % 37 === 0 ? 30 : 0));
  const { min, max } = envelopes(v, 25);
  for (let i = 0; i < v.length; i++) assert.ok(min[i] <= v[i] && v[i] <= max[i]);
});

test('the 99% band ignores a rare spike that the 100% band includes', () => {
  const v = new Float64Array(1000).fill(5);
  for (let i = 0; i < 1000; i++) v[i] = 5 + (i % 10);
  v[500] = 100;
  const { max, hi, lo, min } = envelopes(v, 401);
  assert.equal(max[500], 100);
  assert.ok(hi[500] < 15);
  assert.ok(lo[500] >= min[500] && lo[500] < 6);
});

test('envelopes skip missing values', () => {
  const v = Float64Array.from([1, NaN, 3, NaN, 5]);
  const { min, max } = envelopes(v, 3);
  assert.equal(min[1], 1);
  assert.equal(max[1], 3);
  assert.ok(Number.isNaN(envelopes(Float64Array.from([NaN, NaN]), 1).min[0]));
});

test('half-hour envelopes reach the peaks that daily means hide', () => {
  // Ten days of a midday spike: daily means stay low, but the band must reach the spike.
  const v = Float64Array.from({ length: 480 }, (_, i) => (i % 48 === 24 ? 16 : 0));
  const centres = Array.from({ length: 10 }, (_, d) => d * 48 + 24);
  const { min, max, hi } = windowEnvelopes(v, centres, 48);
  for (let k = 0; k < 10; k++) {
    assert.ok(max[k] >= 16 && max[k] < 16.01);
    assert.ok(min[k] <= 0);
    assert.ok(hi[k] <= max[k]);
  }
});

test('half-hour envelopes contain every value in the window and skip gaps', () => {
  const v = Float64Array.from({ length: 2000 }, (_, i) => (i % 97 === 0 ? NaN : Math.sin(i / 13) * 5 + i / 200));
  const centres = Array.from({ length: 40 }, (_, k) => k * 50);
  const { min, max } = windowEnvelopes(v, centres, 100);
  centres.forEach((c, k) => {
    for (let j = Math.max(0, c - 100); j <= Math.min(1999, c + 100); j++) if (Number.isFinite(v[j])) assert.ok(min[k] <= v[j] && v[j] <= max[k]);
  });
});
