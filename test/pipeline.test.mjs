import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNesoGenMix } from '../pipeline/sources/neso-genmix.mjs';
import { classifyBatteries } from '../pipeline/sources/elexon-bmunits.mjs';
import { pnToDay, b1610ToDay, daysToFetch, mergeStores } from '../pipeline/sources/elexon-battery.mjs';
import { encodeColumns, decodeColumns } from '../pipeline/encode.mjs';

const day = Date.UTC(2026, 9, 12);

test('parses the NESO generation mix onto a regular grid with gaps', () => {
  const csv = [
    'DATETIME,GAS,COAL,NUCLEAR,WIND,WIND_EMB,HYDRO,IMPORTS,BIOMASS,OTHER,SOLAR,STORAGE,GENERATION',
    '2009-01-01T00:00:00,8367.0,15037.0,7099.0,248.0,62.0,246,2518.0,0.0,0.0,0.0,0,33577.0',
    '2009-01-01T01:00:00,8000.0,15000.0,7000.0,250.0,60.0,240,2500.0,0.0,0.0,0.0,0,33000.0',
  ].join('\n');
  const { startMs, length, columns } = parseNesoGenMix(csv);
  assert.equal(startMs, Date.UTC(2009, 0, 1));
  assert.equal(length, 3);
  assert.deepEqual([...columns.gas], [8367, NaN, 8000]);
  assert.equal(columns.neso_bess, undefined);
});

test('treats half hours with gas, hydro and other all zero as missing', () => {
  const csv = [
    'DATETIME,GAS,COAL,NUCLEAR,WIND,HYDRO,OTHER,SOLAR',
    '2026-07-07T09:30:00,1526,0,2955,6565,10,415,11062',
    '2026-07-07T10:00:00,0,0,2949,6434,0,0,11971',
    '2026-07-07T10:30:00,2114,0,2956,6163,0,657,13006',
  ].join('\n');
  const { columns, stats } = parseNesoGenMix(csv);
  assert.deepEqual([...columns.gas], [1526, NaN, 2114]);
  assert.ok(Number.isNaN(columns.wind[1]));
  assert.equal(stats.dropouts, 1);
});

test('zeroes coal after the last coal station closed', () => {
  const csv = [
    'DATETIME,GAS,COAL,NUCLEAR,WIND,HYDRO,OTHER,SOLAR',
    '2024-09-30T23:30:00,9000,120,4000,5000,300,200,0',
    '2024-10-01T00:00:00,9000,0,4000,5000,300,200,0',
    '2024-10-01T00:30:00,9000,133,4000,5000,300,200,0',
  ].join('\n');
  const { columns, stats } = parseNesoGenMix(csv);
  assert.deepEqual([...columns.coal], [120, 0, 0]);
  assert.equal(stats.coalBlips, 1);
});

test('classifies battery units by name and by National Grid id', () => {
  const units = [
    { nationalGridBmUnit: 'BLWNB-1', elexonBmUnit: 'T_BLWNB-1', bmUnitName: 'Thornton Battery', fuelType: 'OTHER', generationCapacity: '200', demandCapacity: '-200' },
    { nationalGridBmUnit: 'XYZWB-1', elexonBmUnit: 'E_XYZWB-1', bmUnitName: 'Some Site', fuelType: null, generationCapacity: '50', demandCapacity: '-49' },
    { nationalGridBmUnit: 'KTHRS-1', elexonBmUnit: 'T_KTHRS-1', bmUnitName: 'Keith Storage 1', fuelType: null, generationCapacity: '0', demandCapacity: '-2.5' },
    { nationalGridBmUnit: 'DINO-1', elexonBmUnit: 'T_DINO-1', bmUnitName: 'Dinorwig pumped storage', fuelType: 'PS', generationCapacity: '300', demandCapacity: '-300' },
    { nationalGridBmUnit: 'ABCDB-1', elexonBmUnit: 'T_ABCDB-1', bmUnitName: 'Wind farm', fuelType: 'WIND', generationCapacity: '50', demandCapacity: '0' },
  ];
  assert.deepEqual(classifyBatteries(units).map((b) => [b.ng, b.reason]), [['BLWNB-1', 'name'], ['XYZWB-1', 'id']]);
});

test('PN segments average to MW per slot, split into discharge and charge', () => {
  const recs = [
    // Unit A ramps 0 -> 100 MW over the first half of slot 0, then holds 100.
    { nationalGridBmUnit: 'A', timeFrom: '2026-10-12T00:00:00Z', timeTo: '2026-10-12T00:15:00Z', levelFrom: 0, levelTo: 100 },
    { nationalGridBmUnit: 'A', timeFrom: '2026-10-12T00:15:00Z', timeTo: '2026-10-12T00:30:00Z', levelFrom: 100, levelTo: 100 },
    // Unit B charges at 40 MW all of slot 0.
    { nationalGridBmUnit: 'B', timeFrom: '2026-10-12T00:00:00Z', timeTo: '2026-10-12T00:30:00Z', levelFrom: -40, levelTo: -40 },
    // Not a battery.
    { nationalGridBmUnit: 'C', timeFrom: '2026-10-12T00:00:00Z', timeTo: '2026-10-12T00:30:00Z', levelFrom: 500, levelTo: 500 },
  ];
  const d = pnToDay(recs, new Set(['A', 'B']), day);
  assert.equal(d.dis[0], 75);
  assert.equal(d.chg[0], -40);
  assert.equal(d.dis[1], null);
});

test('B1610 uses the latest settlement run and converts MWh to MW', () => {
  const recs = [
    { bmUnit: 'A', halfHourEndTime: '2026-10-12T00:30:00', settlementRunType: 'II', quantity: 10 },
    { bmUnit: 'A', halfHourEndTime: '2026-10-12T00:30:00', settlementRunType: 'SF', quantity: 12 },
    { bmUnit: 'B', halfHourEndTime: '2026-10-12T00:30:00', settlementRunType: 'SF', quantity: -5 },
  ];
  const d = b1610ToDay(recs, new Set(['A', 'B']), day);
  assert.equal(d.dis[0], 24);
  assert.equal(d.chg[0], -10);
});

test('encoding round-trips values and missing slots', () => {
  const cols = { a: Float64Array.from([100, 120, NaN, NaN, 90]), b: Float64Array.from([-5, 0, 5, 30000, -30000 + 30000]) };
  const { names, missing, gz } = encodeColumns(cols, 5);
  const out = decodeColumns(gz, names, 5, missing);
  assert.deepEqual([...out.a], [100, 120, NaN, NaN, 90]);
  assert.deepEqual([...out.b], [-5, 0, 5, 30000, 0]);
});

test('only new days and stale recent days are refetched', () => {
  const now = Date.UTC(2026, 9, 13, 12);
  const h = (n) => new Date(now - n * 3600000).toISOString();
  const store = { days: {
    '2026-10-13': { fetched: h(1) },
    '2026-10-12': { fetched: h(20) },
    '2026-10-10': { fetched: h(1) },
    '2026-09-01': {},
  } };
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const src = { refreshDays: 7, refreshHours: 12 };
  const from = Date.UTC(2026, 8, 1);
  const days = daysToFetch(store, src, now, from).map(iso);
  assert.deepEqual(days.slice(0, 3), ['2026-10-12', '2026-10-11', '2026-10-09']);
  assert.ok(!days.includes('2026-10-13') && !days.includes('2026-10-10') && !days.includes('2026-09-01'));
  assert.equal(daysToFetch(store, { refreshDays: 2, refreshHours: 0 }, now, Date.UTC(2026, 9, 12)).length, 2);
});

test('merges two battery stores, keeping fetched and fresher days', () => {
  const a = { days: {
    '2020-01-01': { dis: [], chg: [] },
    '2026-10-01': { dis: [1], chg: [0], fetched: '2026-10-02T00:00:00Z' },
    '2026-10-02': { dis: [5], chg: [0], fetched: '2026-10-03T00:00:00Z' },
  } };
  const b = { days: {
    '2020-01-01': { dis: [2], chg: [0], fetched: '2026-10-10T00:00:00Z' },
    '2026-10-01': { dis: [3], chg: [0], fetched: '2026-10-05T00:00:00Z' },
    '2026-10-02': { dis: [], chg: [] },
    '2019-06-01': { dis: [4], chg: [0], fetched: '2026-10-10T00:00:00Z' },
  } };
  const m = mergeStores(a, b);
  assert.deepEqual(m.days['2020-01-01'].dis, [2]);
  assert.deepEqual(m.days['2026-10-01'].dis, [3]);
  assert.deepEqual(m.days['2026-10-02'].dis, [5]);
  assert.deepEqual(m.days['2019-06-01'].dis, [4]);
});
