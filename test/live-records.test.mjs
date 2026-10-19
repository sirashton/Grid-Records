// The Live records page: which running spells count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveRecords, freshness, behindText, thresholdText } from '../site/js/core/live-records.js';

const N = NaN;
const country = {
  code: 'xx',
  timeZone: 'UTC',
  live: true,
  endColumn: 'coal',
  fuels: { coal: { label: 'Coal', fossil: true }, wind: { label: 'Wind' } },
  presets: {
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [1, 0], pct: [] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [2], pct: [] },
    custom: { label: 'Custom group…', members: ['coal'], mode: 'below', gw: [1], pct: [], editable: true },
  },
};
const make = (coal, wind) => ({ startMs: 0, stepMinutes: 60, length: coal.length, columns: { coal: Float64Array.from(coal), wind: Float64Array.from(wind) } });
const opts = { minMinutes: 60, streakDays: 1 };

test('a running spell longer than any before it is a record', () => {
  // Coal-free for 2 hours, then 3 hours and counting; wind never reaches 2 GW.
  const d = make([5000, 0, 0, 5000, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]);
  const r = liveRecords(d, country, opts);
  assert.equal(r.breaking.length, 1);
  const [c] = r.breaking;
  assert.equal(c.preset, 'coal');
  assert.equal(c.threshold, 0, 'the hardest bar being beaten');
  assert.equal(c.slots, 3);
  assert.equal(c.recordSlots, 2);
  assert.equal(r.close.length, 0);
  assert.equal(r.nearest, null);
});

test('close to the record, nearest, and streaks', () => {
  // Coal-free 5 hours, then 4 and counting: 80% of the record.
  const coal = [5000, 0, 0, 0, 0, 0, 5000, 0, 0, 0, 0];
  const d = make(coal, coal.map(() => 0));
  const r = liveRecords(d, country, opts);
  assert.deepEqual(r.close.map((c) => [c.preset, c.slots, c.recordSlots]), [['coal', 4, 5]]);
  // At 3 of 5 it is only the nearest.
  const d2 = make([5000, 0, 0, 0, 0, 0, 5000, 0, 0, 0], coal.slice(0, 10).map(() => 0));
  const r2 = liveRecords(d2, country, opts);
  assert.equal(r2.close.length, 0);
  assert.equal(r2.nearest.slots, 3);
  // A record running for over a day is a streak.
  const long = [5000, 0, 5000, ...new Array(30).fill(0)];
  const r3 = liveRecords(make(long, long.map(() => 0)), country, opts);
  assert.equal(r3.streaks.length, 1);
  assert.equal(r3.breaking.length, 0);
});

test('spells that ended, or run from the start of the data, do not count', () => {
  // The only spell started with the data: nothing to beat.
  assert.equal(liveRecords(make([0, 0, 0], [0, 0, 0]), country, opts).breaking.length, 0);
  // The spell ended before the data did.
  const r = liveRecords(make([5000, 0, 0, 0, 5000], [0, 0, 0, 0, 0]), country, opts);
  assert.deepEqual([r.breaking.length, r.close.length], [0, 0]);
  // Trailing missing data past the end column is ignored.
  const r2 = liveRecords(make([5000, 0, 5000, 0, 0, N], [0, 0, 0, 0, 0, 0]), country, opts);
  assert.equal(r2.breaking[0].slots, 2);
});

test('freshness: live countries that fall far behind show as latest data', () => {
  const d = make(new Array(10).fill(0), new Array(10).fill(0));
  const end = 10 * 3600000;
  assert.equal(freshness(d, country, 10, end + 3600000).live, true);
  assert.equal(freshness(d, country, 10, end + 7 * 3600000).live, false);
  assert.equal(freshness(d, { ...country, live: false }, 10, end).live, false);
  assert.equal(behindText(40 * 60000), '40 minutes');
  assert.equal(behindText(3 * 3600000), '3 hours');
  assert.equal(behindText(19 * 86400000), '19 days');
});

test('thresholds in words', () => {
  const c = { label: 'Fossil fuels', mode: 'below', unit: 'gw', threshold: 20 };
  assert.equal(thresholdText(c, country), 'Fossil fuels under 20 GW');
  assert.equal(thresholdText({ ...c, threshold: 0, label: 'Coal' }, country), 'No coal');
  assert.equal(thresholdText({ ...c, mode: 'above', unit: 'pct', threshold: 80, label: 'Renewables' }, country), 'Renewables at 80% of generation or more');
  assert.equal(thresholdText({ ...c, threshold: 0.5 }, { smallInMw: true }), 'Fossil fuels under 500 MW');
});
