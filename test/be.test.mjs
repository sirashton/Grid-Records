import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, BE_SOURCES, BE_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeBelgium, dropUnreportedGas } from '../pipeline/build-be.mjs';

const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });

test('Belgium: Energy-Charts types map to the dataset columns', () => {
  const t0 = Date.UTC(2015, 6, 1) / 1000;
  const m = parsePublicPower(response([t0, t0 + 3600], {
    Nuclear: [4800, 4700],
    'Fossil hard coal': [400, 0],
    'Fossil gas': [2100, 2300],
    'Wind offshore': [500, 600],
    'Hydro Run-of-River': [30, 30],
    'Hydro water reservoir': [5, 5],
    'Hydro pumped storage': [0, 900],
    'Hydro pumped storage consumption': [-800, 0],
    Waste: [250, 250],
    Others: [50, 50],
    Load: [9000, 9500],
    'Cross border electricity trading': [-500, 1500],
  }), { sources: BE_SOURCES, fillMinutes: 60 });
  assert.deepEqual(Object.keys(m.columns), BE_COLUMNS);
  assert.deepEqual(m.columns.nuclear, [4800, 4800, 4800, 4800, 4700, 4700, 4700, 4700]);
  assert.equal(m.columns.coal[4], 0);
  assert.equal(m.columns.hydro[0], 35);
  assert.equal(m.columns.other[0], 300);
  assert.equal(m.columns.pumped_storage[4], 900);
  assert.equal(m.columns.pumped_storage_charge[0], -800);
  assert.equal(m.columns.exports[0], -500);
  assert.equal(m.columns.imports[4], 1500);
});

test('Belgium: blank load readings are missing, nuclear at zero is real', () => {
  const t = Date.UTC(2018, 9, 1);
  const power = { startMs: t, length: 3, columns: { nuclear: [1000, 0, 0], gas: [3000, 3100, 3200], demand: [9000, 0, 9100] } };
  const prices = { startMs: t, length: 4, columns: { price: [80, 81, 82, 83] } };
  const m = mergeBelgium([power], [prices]);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.demand[1]));
  assert.equal(m.columns.nuclear[2], 0);
  assert.deepEqual([...m.columns.price], [80, 81, 82]);
});

test('Belgium story: the no-nuclear spell, the summer gap, gas and imports by hour', async () => {
  const { storyFigures } = await import('../site/js/be/story.js');
  const cols = [...BE_COLUMNS, 'price'];
  // Two years and a month of quarter hours from New Year 2024, Belgian time.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const length = 96 * (366 + 365 + 31);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const fmt = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Brussels', hour: 'numeric', month: 'numeric', year: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(startMs + i * 900000)).map((x) => [x.type, +x.value]));
    const summer = p.month >= 4 && p.month <= 9;
    const evening = p.hour >= 18 && p.hour < 22;
    // 2025's reactors are off from April to September; imports take 1.5 GW of
    // the 2 GW and gas the rest.
    const off = p.year === 2025 && summer;
    columns.nuclear[i] = off ? 0 : 2000;
    columns.gas[i] = (evening ? 3000 : 1000) + (off ? 500 : 0);
    columns.imports[i] = off ? 2500 : 1000;
    columns.demand[i] = 9000;
    columns.price[i] = evening ? 150 : 60;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  assert.equal(f.rows.map((r) => r.year).join(), '2024,2025,past365');
  const [y24, y25] = f.rows;
  assert.equal(y24.nucOff, 0);
  assert.equal(y25.nucOff, 183 * 24);
  assert.equal(f.nucOffSpell.end - f.nucOffSpell.start, 183 * 96);
  const [s24, s25] = f.summers;
  assert.equal(s24.year, 2024);
  assert.ok(Math.abs(s24.nuclear - s25.nuclear - 2) < 1e-9);
  assert.ok(Math.abs(s25.net - s24.net - 1.5) < 1e-9);
  assert.ok(Math.abs(s25.gas - s24.gas - 0.5) < 1e-9);
  assert.equal(f.summers.length, 2, 'the 2026 summer is not in the data');
  assert.equal(y24.gasHour[19], 3);
  assert.equal(y24.gasHour[3], 1);
  assert.equal(y24.byHour[19], 150);
  assert.equal(y24.gasMin, 1);
  assert.ok(Math.abs(y24.netImpTwh - 8.784) < 1e-9);
  assert.equal(y24.gasU05, 0);
});

test('Belgium: a day whose gas went unreported is blanked, a real low day is kept', () => {
  // Twenty days of quarter hours from midnight Belgian time. Load is always
  // 9 GW. Day 5 loses 2 GW of gas from the reports, so load runs 2 GW above
  // supply; on day 12 gas really falls and imports make up the difference.
  const days = 20;
  const length = 96 * days;
  const startMs = Date.UTC(2025, 3, 30, 22);
  const cols = Object.fromEntries(BE_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const day = Math.floor(i / 96);
    cols.demand[i] = 9000;
    cols.nuclear[i] = 2000;
    cols.gas[i] = day === 5 ? 500 : day === 12 ? 500 : 2500;
    cols.imports[i] = day === 12 ? 6500 : 4500;
  }
  const data = { startMs, length, columns: cols };
  assert.deepEqual(dropUnreportedGas(data), ['2025-05-06']);
  assert.ok(Number.isNaN(cols.gas[96 * 5]));
  assert.ok(Number.isNaN(cols.gas[96 * 6 - 1]));
  assert.equal(cols.gas[96 * 6], 2500);
  assert.equal(cols.gas[96 * 12], 500);
});
