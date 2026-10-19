import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRows, buildRegistry, unitFlows, nemTime, slotOf, fuelColumn, tableLinks, PARSE_VERSION } from '../pipeline/sources/aemo-mms.mjs';
import { nemColumns, isStale } from '../pipeline/build-au.mjs';

test('reads NEM time as UTC+10 and puts interval ends in the half hour before', () => {
  const t = nemTime('2026/08/01 00:05:00');
  assert.equal(t, Date.UTC(2026, 6, 31, 14, 5));
  assert.equal(slotOf(t), Date.UTC(2026, 6, 31, 14, 0));
  assert.equal(slotOf(nemTime('2026/08/01 00:30:00')), Date.UTC(2026, 6, 31, 14, 0));
  assert.equal(slotOf(nemTime('2026/08/01 00:35:00')), Date.UTC(2026, 6, 31, 14, 30));
});

test('parses MMS CSV rows by their I-row header', async () => {
  const text = ['C,SETP.WORLD,X', 'I,DISPATCH,UNIT_SCADA,1,SETTLEMENTDATE,DUID,SCADAVALUE', 'D,DISPATCH,UNIT_SCADA,1,"2017/06/01 00:05:00",BARCSF1,7.5', 'C,"END OF REPORT",3'].join('\n');
  const rows = [];
  for await (const r of csvRows(text)) rows.push(r);
  assert.deepEqual(rows, [{ SETTLEMENTDATE: '2017/06/01 00:05:00', DUID: 'BARCSF1', SCADAVALUE: '7.5' }]);
});

test('maps AEMO energy sources to fuels', () => {
  assert.equal(fuelColumn('Black coal'), 'black_coal');
  assert.equal(fuelColumn('Brown coal'), 'brown_coal');
  assert.equal(fuelColumn('Natural Gas (Pipeline)'), 'gas');
  assert.equal(fuelColumn('Coal seam methane'), 'gas');
  assert.equal(fuelColumn('Coal mine waste gas'), 'gas');
  assert.equal(fuelColumn('Landfill biogas methane'), 'bioenergy');
  assert.equal(fuelColumn('Bagasse'), 'bioenergy');
  assert.equal(fuelColumn('Diesel oil'), 'liquid');
  assert.equal(fuelColumn('Battery Storage'), 'battery');
});

test('finds table links in old and new archive listings', () => {
  const html = '<A HREF="/D/PUBLIC_ARCHIVE%23GENUNITS_UNIT%23FILE01%23202608010000.zip">a</A><A HREF="/D/PUBLIC_ARCHIVE%23GENUNITS%23FILE01%23202608010000.zip">b</A><A HREF="/D/PUBLIC_DVD_GENUNITS_201501010000.zip">c</A>';
  assert.deepEqual(tableLinks(html, 'GENUNITS'), ['https://nemweb.com.au/D/PUBLIC_ARCHIVE%23GENUNITS%23FILE01%23202608010000.zip', 'https://nemweb.com.au/D/PUBLIC_DVD_GENUNITS_201501010000.zip']);
});

test('sorts units into fuels, charging and pumping', () => {
  const units = buildRegistry({
    dudetail: [
      { DUID: 'HPRG1', START_DATE: '2017/11/14', DISPATCHTYPE: 'GENERATOR', REGIONID: 'SA1', STATIONID: 'HORNSDPR' },
      { DUID: 'HPRL1', START_DATE: '2017/11/14', DISPATCHTYPE: 'LOAD', REGIONID: 'SA1', STATIONID: 'HORNSDPR' },
      { DUID: 'HPR1', START_DATE: '2024/09/12', DISPATCHTYPE: 'BIDIRECTIONAL', REGIONID: 'SA1', STATIONID: 'HORNSDPR' },
      { DUID: 'PUMP2', START_DATE: '2010/01/01', DISPATCHTYPE: 'LOAD', REGIONID: 'QLD1', STATIONID: 'WIVENHOE' },
      { DUID: 'W1', START_DATE: '2010/01/01', DISPATCHTYPE: 'GENERATOR', REGIONID: 'QLD1', STATIONID: 'WIVENHOE' },
      { DUID: 'RT_VIC1', START_DATE: '2010/01/01', DISPATCHTYPE: 'LOAD', REGIONID: 'VIC1', STATIONID: 'RT_VIC1' },
      { DUID: 'TULLYSM1', START_DATE: '2010/01/01', DISPATCHTYPE: 'GENERATOR', REGIONID: 'QLD1', STATIONID: 'TULLYSM' },
    ],
    dualloc: [['HPRG1', 'G1'], ['HPRL1', 'L1'], ['HPR1', 'B1'], ['PUMP2', 'P2'], ['W1', 'W1'], ['RT_VIC1', 'R'], ['TULLYSM1', 'T']].map(([DUID, GENSETID]) => ({ DUID, GENSETID })),
    genunits: [['G1', 'Battery Storage'], ['L1', ''], ['B1', 'Battery Storage'], ['P2', ''], ['W1', 'Hydro'], ['R', ''], ['T', '']].map(([GENSETID, CO2E_ENERGY_SOURCE]) => ({ GENSETID, CO2E_ENERGY_SOURCE })),
  });
  assert.equal(units.HPRG1.column, 'battery');
  assert.equal(units.HPRL1.column, 'battery_charge');
  assert.equal(units.PUMP2.column, 'pumping');
  assert.equal(units.RT_VIC1.column, null);
  assert.equal(units.TULLYSM1.column, 'other');
  assert.deepEqual(unitFlows(units.HPR1, 50), [['battery', 50]]);
  assert.deepEqual(unitFlows(units.HPR1, -40), [['battery_charge', 40]]);
  assert.deepEqual(unitFlows(units.W1, -2), [['hydro', 0]]);
  assert.deepEqual(unitFlows(units.RT_VIC1, 30), []);
});

test('sums regions for the whole market and weights price by demand', () => {
  const reg = (v, d, p) => {
    const c = {};
    for (const k of ['black_coal', 'brown_coal', 'gas', 'liquid', 'hydro', 'wind', 'solar', 'rooftop', 'bioenergy', 'other', 'battery', 'battery_charge', 'pumping']) c[k] = [v];
    c.demand = [d];
    c.price = [p];
    return c;
  };
  const out = nemColumns({ NSW1: reg(1, 300, 100), QLD1: reg(1, 100, 0), VIC1: reg(1, 0, 50), SA1: reg(1, 0, 50), TAS1: reg(NaN, 0, 50) }, 1);
  assert.ok(Number.isNaN(out.wind[0]));
  assert.equal(out.demand[0], 400);
  assert.equal(out.price[0], 75);
});

test('rechecks recent months but keeps old ones', () => {
  const now = Date.parse('2026-10-19T00:00:00Z');
  assert.equal(isStale({ fetched: '2026-10-18T00:00:00Z', missing: true }, 0, now), true);
  assert.equal(isStale({ fetched: '2026-10-18T00:00:00Z', version: PARSE_VERSION }, 1, now), false);
  assert.equal(isStale({ fetched: '2020-01-01T00:00:00Z', version: PARSE_VERSION }, 40, now), false);
});
