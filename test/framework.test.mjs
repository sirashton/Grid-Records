// The shared country framework: any step, any time zone, one dataset format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { summarise, formatDuration } from '../site/js/records.js';
import { yearStart, localYear, localDate } from '../site/js/core/calendar.js';
import { metricSeries, generationTotal, yearlyEnergy, dailyEnergy, decode, windowPoints } from '../site/js/core/dataset.js';
import { writeDataset, checkDataset } from '../pipeline/core/dataset.mjs';
import { stitch, runQueue, isStale } from '../pipeline/core/chunks.mjs';
import { encodeColumns, decodeColumns } from '../pipeline/encode.mjs';

const N = NaN;

test('local years start at local midnight', () => {
  assert.equal(yearStart(2025, 'UTC'), Date.UTC(2025, 0, 1));
  assert.equal(yearStart(2025, 'Europe/London'), Date.UTC(2025, 0, 1));
  // New Zealand is UTC+13 at New Year, Germany UTC+1, Queensland UTC+10.
  assert.equal(yearStart(2025, 'Pacific/Auckland'), Date.UTC(2024, 11, 31, 11));
  assert.equal(yearStart(2025, 'Europe/Berlin'), Date.UTC(2024, 11, 31, 23));
  assert.equal(yearStart(2025, 'Australia/Brisbane'), Date.UTC(2024, 11, 31, 14));
  assert.equal(localYear(Date.UTC(2024, 11, 31, 12), 'Pacific/Auckland'), 2025);
  assert.equal(localDate(Date.UTC(2024, 6, 1, 23, 30), 'Europe/Berlin'), '2024-07-02');
});

test('records work at a five-minute step', () => {
  // 12 five-minute slots is an hour.
  assert.equal(formatDuration(12, 5), '1 hour');
  assert.equal(formatDuration(3, 15), '45 minutes');
  const v = new Array(30).fill(1);
  // A 55-minute gap (11 slots) is bridged, a 65-minute one (13 slots) is not.
  v.fill(N, 5, 16);
  const bridged = summarise(v, 2, 'below', { startMs: 0, stepMinutes: 5 });
  assert.equal(bridged.count, 1);
  v.fill(N, 5, 18);
  const split = summarise(v, 2, 'below', { startMs: 0, stepMinutes: 5 });
  assert.equal(split.count, 2);
});

test('per-year bests use the country time zone', () => {
  // 10:00 to 12:00 UTC on 31 Dec 2024 straddles New Year in New Zealand (23:00 to 01:00).
  const startMs = Date.UTC(2024, 11, 31, 10);
  const s = summarise(new Array(8).fill(1), 2, 'below', { startMs, stepMinutes: 15, timeZone: 'Pacific/Auckland' });
  assert.deepEqual(s.perYear.map(([y, p]) => [y, p.end - p.start]), [[2024, 4], [2025, 4]]);
});

// A tiny country: coal, wind and a battery, at 15 minutes.
const country = {
  code: 'xx',
  timeZone: 'Europe/Berlin',
  endColumn: 'coal',
  fuels: {
    coal: { label: 'Coal', fossil: true },
    wind: { label: 'Wind', columns: ['wind_onshore', 'wind_offshore'], renewable: true },
    battery: { label: 'Battery', optional: true, inTotal: false },
    battery_charge: { label: 'Charging', abs: true, optional: true, inTotal: false, notGeneration: true },
  },
};
const data = {
  startMs: 0,
  stepMinutes: 15,
  length: 4,
  columns: {
    coal: Float64Array.from([1000, 500, N, 0]),
    wind_onshore: Float64Array.from([500, 500, 500, 1000]),
    wind_offshore: Float64Array.from([500, 1000, 500, 1000]),
    battery: Float64Array.from([N, 200, 0, 0]),
    battery_charge: Float64Array.from([N, 0, -300, 0]),
  },
};

test('series come from the country config', () => {
  assert.deepEqual([...metricSeries(data, country, ['wind'])], [1, 1.5, 1, 2]);
  assert.deepEqual([...generationTotal(data, country)], [2000, 2000, N, 2000]);
  assert.deepEqual([...metricSeries(data, country, ['coal'], { unit: 'pct' })], [50, 25, N, 0]);
  // Optional columns count as zero where missing; charging counts by size.
  assert.deepEqual([...metricSeries(data, country, ['battery'])], [0, 0.2, 0, 0]);
  assert.deepEqual([...metricSeries(data, country, ['battery_charge'])], [0, 0, 0.3, 0]);
});

test('yearly and daily energy use the step and time zone', () => {
  // Two full Berlin days at 15 minutes, 1 GW of wind throughout.
  const startMs = yearStart(2024, 'Europe/Berlin');
  const n = 96 * 2;
  const d = { startMs, stepMinutes: 15, length: n, columns: { coal: new Float64Array(n), wind_onshore: new Float64Array(n).fill(1000), wind_offshore: new Float64Array(n) } };
  const days = dailyEnergy(d, country, n, 5);
  assert.deepEqual(days.map((r) => [r.date, r.total]), [['2024-01-01', 24], ['2024-01-02', 24]]);
  assert.equal(yearlyEnergy(d, country).length, 0); // no whole year yet
  assert.equal(windowPoints(d, metricSeries(d, country, ['wind']), 1).length, 96);
});

test('writeDataset checks the rules and writes a file the browser decodes', async () => {
  const dir = await mkdtemp(`${tmpdir()}/ds-`);
  const length = 3;
  const columns = { lignite: Float64Array.from([40000, 40100, N]), battery_charge: Float64Array.from([0, -5, -10]) };
  const { meta } = await writeDataset(dir, { region: 'de', timeZone: 'Europe/Berlin', stepMinutes: 15, startMs: 900000 * 1000, length, columns }, { log: () => {} });
  assert.equal(meta.version, 1);
  assert.deepEqual(meta.base, { lignite: 40000 });
  assert.deepEqual(meta.lastSlot, { lignite: 1, battery_charge: 2 });
  const raw = gunzipSync(await readFile(`${dir}/series.bin.gz`));
  const decoded = decode(new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), JSON.parse(await readFile(`${dir}/meta.json`, 'utf8')));
  assert.deepEqual([...decoded.lignite], [40000, 40100, N]);
  assert.deepEqual([...decoded.battery_charge], [0, -5, -10]);

  const bad = (over) => () => checkDataset({ region: 'de', timeZone: 'Europe/Berlin', stepMinutes: 15, startMs: 0, length, columns, ...over });
  assert.throws(bad({ stepMinutes: 7 }), /stepMinutes/);
  assert.throws(bad({ startMs: 60000 }), /multiple of the step/);
  assert.throws(bad({ timeZone: 'Mars/Olympus' }), /time zone/);
  assert.throws(bad({ length: 4 }), /has 3 slots/);
  assert.match(bad({ columns: { coal: Float64Array.from([1, -100, 0]) } })().join(), /wrong sign/);
});

test('the encoder still writes GB and NZ files as before', () => {
  const columns = { gas: Float64Array.from([N, 20000, 20010]) };
  const { base, gz } = encodeColumns(columns, 3);
  assert.deepEqual(base, {});
  assert.deepEqual([...decodeColumns(gz, ['gas'], 3, { gas: [[0, 1]] }).gas], [N, 20000, 20010]);
});

test('stitch lays pieces onto one grid', () => {
  const out = stitch([
    { startMs: 3600000, length: 2, columns: { a: [3, 4] } },
    { startMs: 0, length: 2, columns: { a: [1, null] } },
  ], { stepMinutes: 30, columns: ['a', 'b'] });
  assert.equal(out.startMs, 0);
  assert.deepEqual([...out.columns.a], [1, N, 3, 4]);
  assert.deepEqual([...out.columns.b], [N, N, N, N]);
});

test('runQueue stops at the deadline and counts failures as left', async () => {
  const seen = [];
  const r = await runQueue([1, 2, 3], async (x) => { seen.push(x); if (x === 2) throw new Error('no'); }, { concurrency: 1, log: () => {} });
  assert.deepEqual(r, { done: 2, left: 1 });
  assert.deepEqual(await runQueue([1], async () => {}, { deadline: 0 }), { done: 0, left: 1 });
  assert.equal(isStale(null, 0, 0), true);
});
