import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meets, findSpells, recordProgression, summarise, formatDuration, logLadder, topSpells } from '../site/js/records.js';

const N = NaN;

test('finds spells below a threshold', () => {
  const v = [5, 1, 1, 5, 1, 1, 1, 5];
  assert.deepEqual(findSpells(v, 2, 'below'), [{ start: 1, end: 3 }, { start: 4, end: 7 }]);
});

test('above is inclusive of the threshold', () => {
  assert.deepEqual(findSpells([1, 2, 3, 1], 2, 'above'), [{ start: 1, end: 3 }]);
});

test('spells running to the end of the series are closed', () => {
  assert.deepEqual(findSpells([5, 1, 1], 2, 'below'), [{ start: 1, end: 3 }]);
});

test('missing slots break spells unless bridged', () => {
  const v = [1, 1, N, 1, 1, N, N, 1];
  assert.deepEqual(findSpells(v, 2, 'below'), [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 8 }]);
  assert.deepEqual(findSpells(v, 2, 'below', { maxGap: 1 }), [{ start: 0, end: 5 }, { start: 7, end: 8 }]);
  assert.deepEqual(findSpells(v, 2, 'below', { maxGap: 2 }), [{ start: 0, end: 8 }]);
});

test('a failing value after a gap still ends the spell', () => {
  assert.deepEqual(findSpells([1, N, 5, 1], 2, 'below', { maxGap: 3 }), [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
});

test('record progression keeps only spells that beat all earlier ones', () => {
  const spells = [{ start: 0, end: 2 }, { start: 3, end: 4 }, { start: 5, end: 9 }, { start: 10, end: 12 }];
  assert.deepEqual(recordProgression(spells), [{ start: 0, end: 2 }, { start: 5, end: 9 }]);
});

test('top spells are longest first with earlier ties first', () => {
  const spells = [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 9 }];
  assert.deepEqual(topSpells(spells, 2), [{ start: 6, end: 9 }, { start: 0, end: 2 }]);
});

test('summarise reports the record, the current spell and per-year bests', () => {
  const startMs = Date.UTC(2024, 11, 31, 23, 0);
  const v = [1, 1, 5, 1, 1, 1, N];
  const s = summarise(v, 2, 'below', { startMs });
  assert.deepEqual(s.record, { start: 3, end: 6 });
  assert.deepEqual(s.current, { start: 3, end: 6 });
  assert.equal(s.count, 2);
  assert.equal(s.totalSlots, 5);
  assert.deepEqual(s.perYear.map(([y]) => y), [2024, 2025]);
});

test('per-year bests clip a spell that crosses New Year to each year', () => {
  // 23:00 on 31 Dec: slots 0-1 are in 2024, slots 2-5 in 2025, all below.
  const startMs = Date.UTC(2024, 11, 31, 23, 0);
  const s = summarise([1, 1, 1, 1, 1, 1], 2, 'below', { startMs });
  const [[y24, a], [y25, b]] = s.perYear;
  assert.equal(y24, 2024);
  assert.deepEqual([a.start, a.end], [0, 2]);
  assert.equal(y25, 2025);
  assert.deepEqual([b.start, b.end], [2, 6]);
  assert.deepEqual(b.spell, { start: 0, end: 6 });
});

test('formats durations', () => {
  assert.equal(formatDuration(1), '30 minutes');
  assert.equal(formatDuration(3), '1 hour 30 minutes');
  assert.equal(formatDuration(48 * 3 + 9), '3 days 4 hours');
  assert.equal(formatDuration(48), '1 day');
});

test('builds a 1-2-5 ladder', () => {
  assert.deepEqual(logLadder(0.5, 10), [0.5, 1, 2, 5, 10]);
  assert.deepEqual(logLadder(1, 50), [1, 2, 5, 10, 20, 50]);
});

test('a zero threshold means none at all', () => {
  assert.equal(meets(0, 0, 'below'), true);
  assert.equal(meets(0.001, 0, 'below'), false);
  assert.equal(meets(0.1, 0.1, 'below'), false);
  assert.deepEqual(findSpells([0.2, 0, 0, 0.1], 0, 'below'), [{ start: 1, end: 3 }]);
});

test('pastYear is the longest spell in the last 365 days, clipped to them', () => {
  const year = 365 * 48;
  // A long spell that starts before the window, then a short one inside it.
  const v = new Float64Array(year + 1000).fill(5);
  for (let i = 500; i < 2000; i++) v[i] = 1;
  for (let i = year + 500; i < year + 600; i++) v[i] = 1;
  const s = summarise(v, 2, 'below', { startMs: Date.UTC(2024, 0, 1) });
  const from = v.length - year;
  assert.deepEqual([s.pastYear.start, s.pastYear.end], [from, 2000]);
  assert.deepEqual([s.pastYear.spell.start, s.pastYear.spell.end], [500, 2000]);
});
