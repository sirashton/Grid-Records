import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNesoGenMix } from '../pipeline/sources/neso-genmix.mjs';
import { classifyBatteries } from '../pipeline/sources/elexon-bmunits.mjs';
import { pnToDay, b1610ToDay } from '../pipeline/sources/elexon-battery.mjs';
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
