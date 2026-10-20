import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, parsePrices, PL_SOURCES, PL_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergePoland } from '../pipeline/build-pl.mjs';

const t0 = Date.UTC(2015, 0, 5) / 1000;
const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });
const opts = { sources: PL_SOURCES, fillMinutes: 60 };

test('hourly readings fill their four quarter hours', () => {
  const m = parsePublicPower(response([t0, t0 + 3600], {
    'Fossil hard coal': [7390, 7336],
    'Wind onshore': [2559, 2485],
    Load: [14212, 14037],
    'Cross border electricity trading': [-527, 202],
  }), opts);
  assert.equal(m.startMs, t0 * 1000);
  assert.equal(m.length, 8);
  assert.deepEqual(m.columns.coal, [7390, 7390, 7390, 7390, 7336, 7336, 7336, 7336]);
  assert.deepEqual(m.columns.demand.slice(0, 4), [14212, 14212, 14212, 14212]);
  assert.deepEqual(m.columns.exports.slice(0, 5), [-527, -527, -527, -527, 0]);
  assert.deepEqual(m.columns.imports.slice(3, 5), [0, 202]);
  // Types Poland didn't list yet (solar, batteries) count as zero.
  assert.equal(m.columns.solar[0], 0);
  assert.deepEqual(Object.keys(m.columns), PL_COLUMNS);
});

test('switches from hourly to 15-minute readings without gaps or overlaps', () => {
  const ts = [t0, t0 + 3600, t0 + 4500, t0 + 5400];
  const m = parsePublicPower(response(ts, { 'Fossil hard coal': [1, 2, 3, 4], Solar: [0, 0, 0, 0], 'Battery Consumption': [-5, -5, -6, -7], Battery: [0, 1, 2, 3] }), opts);
  assert.deepEqual(m.columns.coal, [1, 1, 1, 1, 2, 3, 4]);
  // Charging is negative, discharge positive.
  assert.deepEqual(m.columns.battery_charge, [-5, -5, -5, -5, -5, -6, -7]);
  assert.deepEqual(m.columns.battery, [0, 0, 0, 0, 1, 2, 3]);
});

test('does not fill across a gap longer than an hour', () => {
  const m = parsePublicPower(response([t0, t0 + 3 * 3600], { 'Fossil hard coal': [1, 2], Solar: [0, 0] }), opts);
  assert.deepEqual(m.columns.coal.slice(0, 5), [1, 1, 1, 1, null]);
  assert.equal(m.columns.coal[12], 2);
});

test('prices fill hours and keep blanks missing', () => {
  const p = parsePrices({ unix_seconds: [t0, t0 + 3600, t0 + 7200], price: [40.12, null, -3] });
  assert.equal(p.length, 12);
  assert.deepEqual(p.columns.price.slice(0, 5), [40.1, 40.1, 40.1, 40.1, null]);
  assert.equal(p.columns.price[8], -3);
});

test('merges generation and prices, ending at the last generation slot', () => {
  const t = Date.UTC(2024, 5, 1);
  const power = { startMs: t, length: 2, columns: { coal: [5, 6] } };
  const prices = { startMs: t, length: 4, columns: { price: [10, 11, 12, 13] } };
  const m = mergePoland([power], [prices, { startMs: NaN, length: 0, columns: {} }]);
  assert.equal(m.startMs, t);
  assert.equal(m.length, 2);
  assert.deepEqual([...m.columns.price], [10, 11]);
  assert.equal(m.columns.coal[1], 6);
  assert.ok(Number.isNaN(m.columns.solar[0]));
});

test('works out the story figures: coal by hour, the floor, prices and the evening rise', async () => {
  const { storyFigures, COAL_FLOOR } = await import('../site/js/pl/story.js');
  const cols = [...PL_COLUMNS, 'price'];
  // Two years and a month of quarter hours, from New Year 2024 in Polish time.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const length = 96 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Warsaw', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    // Local winter hour; the summer hour is one later, which the figures follow.
    const hour = Number(hourOf.format(new Date(startMs + i * 900000)));
    const sunny = hour >= 11 && hour < 15;
    const evening = hour >= 18 && hour <= 20;
    columns.solar[i] = sunny ? 10000 : 0;
    // Coal is 6 GW at midday, 8.5 GW in the evening and 8 GW otherwise.
    columns.coal[i] = sunny ? 4000 : evening ? 6500 : 6000;
    columns.lignite[i] = 2000;
    columns.exports[i] = sunny ? -2000 : 0;
    columns.price[i] = sunny ? -10 : evening ? 200 : 100;
  }
  const data = { startMs, length, stepMinutes: 15, columns };
  const f = storyFigures(data, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const [y24] = f.rows;
  assert.equal(y24.coalMin, 6);
  assert.equal(y24.coalMax, 8.5);
  assert.equal(y24.ligMin, 2);
  assert.equal(y24.hcMin, 4);
  // Four sunny hours a day under 7 GW, all with the sun up; never under the floor.
  assert.equal(y24.coalLow, 366 * 4);
  assert.equal(y24.coalLowSunShare, 1);
  assert.equal(y24.coalLow5, 0);
  assert.equal(y24.coalHour[12], 6);
  assert.equal(y24.coalHour[19], 8.5);
  assert.equal(y24.ligHour[3], 2);
  // A day burns 6*4 + 8.5*3 + 8*17 = 185.5 GWh, 24 of it while exporting.
  const dayGwh = 6 * 4 + 8.5 * 3 + 8 * 17;
  assert.ok(Math.abs(y24.coalTwh - (366 * dayGwh) / 1000) < 1e-9);
  assert.ok(Math.abs(y24.coalMonth[0] - (31 * dayGwh) / 1000) < 1e-9);
  assert.ok(Math.abs(y24.ligMonth[0] - (31 * 48) / 1000) < 1e-9);
  assert.ok(Math.abs(y24.coalExportingShare - 24 / dayGwh) < 1e-9);
  assert.equal(y24.coalSolarHi, 6);
  assert.ok(Math.abs(y24.coalWindLo - dayGwh / 24) < 1e-9);
  assert.ok(Number.isNaN(y24.coalWindHi));
  // The lowest quarter hour is the first sunny one of New Year's Day.
  assert.equal(Number(hourOf.format(new Date(startMs + y24.coalMinAt * 900000))), 11);
  assert.equal(y24.midday, -10);
  assert.equal(y24.evening, 200);
  assert.equal(y24.byHour[19], 200);
  assert.equal(y24.solarCapture, -10);
  assert.equal(y24.negHours, 366 * 4);
  // The evening rise: from the 11:00 low of 6 GW, 2 GW for 6 hours and 2.5 GW for 3: 19.5 GWh, peak 2.5 GW.
  assert.equal(y24.riseDays.length, 366);
  assert.ok(Math.abs(y24.riseDays[0].gwh - 19.5) < 1e-9);
  assert.ok(Math.abs(y24.riseDays[0].peak - 2.5) < 1e-9);
  assert.equal(y24.riseDays[0].solar, 40);
  assert.ok(Math.abs(y24.riseTwh - (366 * 19.5) / 1000) < 1e-9);
  // 5 GW and 20 GWh covers every day and the solar could charge it; 5 GW and 10 GWh covers none.
  assert.deepEqual(y24.batteries.map((b) => b.days), [0, 0, 366, 366]);
  assert.deepEqual(y24.batteries.map((b) => b.charged), [0, 0, 366, 366]);
  // Above the 5 GW floor a day burns 1*4 + 3.5*3 + 3*17 = 65.5 GWh, more than any fleet
  // (the clock-change days have an hour more or less, so check the median day).
  assert.equal(COAL_FLOOR, 5);
  assert.ok(Math.abs(y24.floorDays[183].gwh - 65.5) < 1e-9);
  assert.ok(Math.abs(y24.floorDays[183].peak - 3.5) < 1e-9);
  assert.deepEqual(y24.batteries.map((b) => b.floorDays), [0, 0, 0, 0]);
  const [below0] = f.bands;
  assert.equal(below0.coal, 6);
  assert.equal(below0.lignite, 2);
  assert.equal(below0.exports, 2);
  assert.equal(below0.solar, 10);
  assert.equal(f.monthly[0].month, '2024-01');
  // Coal is 6 of 16 GW in sunny hours and all of it otherwise.
  assert.ok(Math.abs(f.monthly[0].coalPct - ((6 * 4 + 8.5 * 3 + 8 * 17) / (16 * 4 + 8.5 * 3 + 8 * 17)) * 100) < 1e-9);
  assert.equal(f.coalLowSpell.end - f.coalLowSpell.start, 16);
  assert.equal(f.coalFloorSpell, null);
});
