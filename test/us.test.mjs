import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halfList, halfInfo, parseUtc, parseHalf, addHalves, splitCsv } from '../pipeline/sources/eia930.mjs';
import { needsFetch } from '../pipeline/build-us.mjs';

const HEAD = ['Balancing Authority', 'Data Date', 'Hour Number', 'Local Time at End of Hour', 'UTC Time at End of Hour', 'Demand (MW)', 'Net Generation (MW)', 'Total Interchange (MW)', 'Demand (MW) (Adjusted)', 'Net Generation (MW) (Adjusted)', 'Total Interchange (MW) (Adjusted)',
  'Net Generation (MW) from Natural Gas', 'Net Generation (MW) from Battery Storage', 'Net Generation (MW) from Solar without Integrated Battery Storage', 'Net Generation (MW) from Solar with Integrated Battery Storage',
  'Net Generation (MW) from Natural Gas (Adjusted)', 'Net Generation (MW) from Battery Storage (Adjusted)', 'Region'];
const utc = (ms) => {
  const d = new Date(ms);
  const h = d.getUTCHours();
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()} ${h % 12 || 12}:00:00 ${h < 12 ? 'AM' : 'PM'}`;
};
// One row: hour beginning at `ms`, so stamped at its end.
const row = (ba, ms, { gas, gasAdj = '', battery = '', solar = 0, ti = 0 }) => [ba, '', '', '', `"${utc(ms + 3600000)}"`, '', '', '', 1000, 1000, ti, gas, battery, solar, 0, gasAdj, '', 'X'].join(',');

test('US: half-years, file names and EIA time stamps', () => {
  assert.deepEqual(halfList(Date.UTC(2019, 7, 1)), ['2019H2', '2019H1', '2018H2']);
  assert.equal(halfInfo('2024H1').file, 'EIA930_BALANCE_2024_Jan_Jun.csv');
  assert.equal(halfInfo('2024H1').length, 182 * 24);
  assert.equal(parseUtc('10/24/2026 12:00:00 AM'), Date.UTC(2026, 9, 24, 0));
  assert.equal(parseUtc('10/24/2026 1:00:00 PM'), Date.UTC(2026, 9, 24, 13));
  assert.deepEqual(splitCsv('"a,b",1,,"x""y"'), ['a,b', '1', '', 'x"y']);
});

test('US: sums balancing authorities, splits charging, adds the files across the boundary', () => {
  const jul = Date.UTC(2025, 6, 1);
  // Two balancing authorities. Around the 1 July boundary, A's hours are in
  // the first file and B's in the second, as each file runs by local date.
  const h1 = [HEAD.map((h) => `"${h}"`).join(',')];
  const h2 = [HEAD.map((h) => `"${h}"`).join(',')];
  for (let k = -3; k < 3; k++) {
    const ms = jul + k * 3600000;
    (k < 1 ? h1 : h2).push(row('A', ms, { gas: 100, gasAdj: 110, battery: k === 0 ? -20 : 5, solar: -1, ti: -50 }));
    (k < -1 ? h1 : h2).push(row('B', ms, { gas: 200, battery: 30, ti: 20 }));
  }
  const a = parseHalf('2025H1', h1.join('\n'));
  const b = parseHalf('2025H2', h2.join('\n'));
  const m = addHalves([a, b]);
  const at = (ms) => Math.round((ms - m.startMs) / 3600000);
  for (let k = -3; k < 3; k++) {
    const i = at(jul + k * 3600000);
    // Adjusted gas wins over raw: 110 for A plus 200 for B.
    assert.equal(m.columns.gas[i], 310, `gas at ${k}`);
    assert.equal(m.columns.solar[i], 0, 'night solar below zero counts as zero');
    assert.equal(m.columns.battery[i], k === 0 ? 30 : 35);
    assert.equal(m.columns.battery_charge[i], k === 0 ? -20 : 0);
    assert.equal(m.columns.imports[i], 30);
    assert.equal(m.columns.exports[i], 0);
    assert.equal(m.columns.demand[i], 2000);
  }
  assert.ok(Number.isNaN(m.columns.gas[at(jul + 5 * 3600000)]), 'hours nobody reported are missing');
  assert.equal(m.dropped, 0);
});

test('US: drops hours too few balancing authorities reported', () => {
  const jan = Date.UTC(2025, 0, 1);
  const lines = [HEAD.map((h) => `"${h}"`).join(',')];
  for (let k = 0; k < 4; k++) for (const ba of 'ABCDEFGHIJ') if (!(k === 2 && ba < 'C')) lines.push(row(ba, jan + k * 3600000, { gas: 10 }));
  const m = addHalves([parseHalf('2025H1', lines.join('\n'))]);
  const at = (k) => Math.round((jan + k * 3600000 - m.startMs) / 3600000);
  assert.equal(m.columns.gas[at(1)], 100);
  assert.ok(Number.isNaN(m.columns.gas[at(2)]), 'eight of ten reported');
  assert.equal(m.dropped, 1);
});

test('US: the current half-year refetches each run, the last one daily', () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const e = (ago) => ({ version: 3, fetched: new Date(now - ago).toISOString() });
  assert.equal(needsFetch(e(10 * 60000), 0, now), false);
  assert.equal(needsFetch(e(30 * 60000), 0, now), true);
  assert.equal(needsFetch(e(2 * 864e5), 1, now), true);
  assert.equal(needsFetch(e(40 * 864e5), 5, now), false);
});
