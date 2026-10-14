import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelope } from '../site/js/envelope.js';

test('envelope tracks the 24-hour low and high around each slot', () => {
  // Three days: a daily cycle from 0 to 47.
  const v = Float64Array.from({ length: 144 }, (_, i) => i % 48);
  const { low, high } = envelope(v);
  assert.equal(low[72], 0);
  assert.equal(high[72], 47);
});

test('envelope skips missing slots and smooths over days', () => {
  const v = new Float64Array(48 * 10).fill(5);
  v.fill(1, 48 * 5, 48 * 6);
  v[10] = NaN;
  const raw = envelope(v);
  assert.equal(raw.low[48 * 5 + 24], 1);
  assert.equal(raw.low[10], 5);
  const smooth = envelope(v, 5);
  assert.ok(smooth.low[48 * 5 + 24] > 1 && smooth.low[48 * 5 + 24] < 5);
});
