import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvRows, buildRegistry, unitFlows, nemTime, slotOf, fuelColumn, tableLinks, PARSE_VERSION } from '../pipeline/sources/aemo-mms.mjs';
import { nemColumns, isStale, outputColumns } from '../pipeline/build-au.mjs';

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
  assert.equal(isStale({ fetched: '2026-10-17T00:00:00Z', missing: true }, 0, now), true);
  assert.equal(isStale({ fetched: '2026-10-18T12:00:00Z', version: PARSE_VERSION }, 1, now), false);
  assert.equal(isStale({ fetched: '2020-01-01T00:00:00Z', version: PARSE_VERSION }, 40, now), false);
});

test('writes the shared column names, with charging as negative MW', () => {
  const cols = {};
  for (const k of ['black_coal', 'brown_coal', 'gas', 'liquid', 'hydro', 'wind', 'solar', 'rooftop', 'bioenergy', 'other', 'battery', 'battery_charge', 'pumping', 'demand', 'price']) cols[k] = Float64Array.from([5, NaN]);
  const out = outputColumns(cols);
  assert.equal(out.coal[0], 5);
  assert.equal(out.lignite[0], 5);
  assert.equal(out.solar_rooftop[0], 5);
  assert.equal(out.battery_charge[0], -5);
  assert.equal(out.pumped_storage_charge[0], -5);
  assert.ok(Number.isNaN(out.battery_charge[1]));
});

test('Australia story: the noon coal dip, negative prices, the evening and the battery sizing', async () => {
  const { storyFigures, LEVELS, DIP_SHARE } = await import('../site/js/au/story.js');
  const au = (await import('../site/js/countries/au.js')).default;
  const cols = ['coal', 'lignite', 'gas', 'oil', 'hydro', 'wind', 'solar_utility', 'solar_rooftop', 'biomass', 'other', 'battery', 'battery_charge', 'pumped_storage_charge', 'demand', 'price'];
  // Two years and a month of half hours, from New Year 2024 in NEM time (UTC+10).
  const startMs = Date.UTC(2023, 11, 31, 14);
  const length = 48 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = Math.floor(((startMs + i * 18e5 + 10 * 36e5) % 864e5) / 36e5);
    const noon = hour >= 11 && hour <= 14;
    const evening = hour >= 17 && hour <= 20;
    // Coal runs 15 GW at night and turns down to 9 GW at noon; gas peaks at 3 GW in the evening over a 0.3 GW floor.
    columns.coal[i] = noon ? 6000 : 10000;
    columns.lignite[i] = noon ? 3000 : 5000;
    columns.gas[i] = evening ? 3000 : 300;
    columns.solar_rooftop[i] = noon ? 12000 : 0;
    columns.wind[i] = 4000;
    columns.hydro[i] = 1500;
    columns.battery[i] = evening ? 1000 : 0;
    columns.battery_charge[i] = noon ? -1000 : 0;
    columns.demand[i] = 22000;
    columns.price[i] = noon ? -20 : evening ? 200 : 60;
  }
  // One half hour where the units report almost nothing is a gap, not a record.
  columns.coal[48 * 100] = 0;
  columns.lignite[48 * 100] = 0;
  columns.gas[48 * 100] = 40;
  columns.wind[48 * 100] = 0;
  columns.hydro[48 * 100] = 0;
  const data = { startMs, length, stepMinutes: 30, columns };
  const f = storyFigures(data, length, au, LEVELS.nem);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const y25 = f.rows.find((r) => r.year === 2025);
  assert.equal(f.lastFuel, 'coal');
  assert.equal(y25.days, 365);
  assert.ok(Math.abs(y25.coalHour[13] - 9) < 1e-9 && Math.abs(y25.coalHour[3] - 15) < 1e-9);
  // Fossil dips 6 GW from night to noon, more than DIP_SHARE, every day.
  assert.ok(Math.abs(y25.dip - 6) < 1e-9 && 6 / 15.3 > DIP_SHARE);
  assert.equal(y25.dipDays, 365);
  assert.ok(Math.abs(y25.coalMin - 9) < 1e-9);
  // Four hours a day below zero, with 9 GW of coal running through them.
  assert.equal(y25.negHours, 4 * 365);
  assert.ok(Math.abs(y25.coalAtNeg - 9) < 1e-9);
  assert.equal(y25.negPrice, -20);
  assert.ok(Math.abs(y25.priceHour[13] + 20) < 1e-9);
  // The evening, 4pm to 9pm: gas 3 GW for four of the five hours, batteries 1 GW.
  assert.ok(Math.abs(y25.eveningGas - (0.3 + 4 * 3) / 5) < 1e-9);
  assert.ok(Math.abs(y25.eveningBat - 0.8) < 1e-9);
  assert.equal(y25.eveningPrice, (60 + 4 * 200) / 5);
  assert.equal(y25.middayPrice, (2 * 60 + 4 * -20) / 6);
  // Gas above the 0.5 GW floor: 2.5 GW for four hours, 10 GWh a day, within every fleet.
  assert.ok(Math.abs(y25.gasDays[0].gwh - 10) < 1e-9);
  assert.deepEqual(y25.batteriesGas.map((b) => b.days), [365, 365, 365, 365]);
  // Fossil above the day's floor of 9.3 GW: 6 GW for 16 hours and 8.7 GW for four, 130.8 GWh; only the 30 GW, 120 GWh fleet is close, and it is still short.
  assert.ok(Math.abs(y25.rampDays[0].gwh - 130.8) < 1e-9);
  assert.ok(Math.abs(y25.rampDays[0].peak - 8.7) < 1e-9);
  assert.deepEqual(y25.batteriesRamp.map((b) => b.days), [0, 0, 0, 0]);
  assert.ok(Math.abs(y25.rampTwh - 130.8 * 365 / 1000) < 1e-9);
  // Fossil never under 8 GW, and the gap in 2024 is not a record.
  assert.equal(y25.fossilLowHours, 0);
  assert.equal(f.fossilLowSpell, null);
  const y24 = f.rows.find((r) => r.year === 2024);
  assert.ok(Math.abs(y24.coalMin - 9) < 1e-9);
  assert.ok(Math.abs(f.lowest.gw - 9.3) < 1e-9);
  assert.ok(Math.abs(y24.coalTwh - ((9 * 4 + 15 * 20) * 366 - 7.5) / 1000) < 1e-6);
  // Every item that is coming names a source that was opened.
  const { COMING, SOURCES } = await import('../site/js/au/sources.js');
  for (const [, , key] of COMING) assert.ok(SOURCES[key], `no source ${key}`);
});

test('Australia story: a state with no coal follows gas, and a part year is left out', async () => {
  const { storyFigures, LEVELS } = await import('../site/js/au/story.js');
  const au = (await import('../site/js/countries/au.js')).default;
  const cols = ['coal', 'lignite', 'gas', 'oil', 'hydro', 'wind', 'solar_utility', 'solar_rooftop', 'biomass', 'other', 'battery', 'battery_charge', 'pumped_storage_charge', 'demand', 'price'];
  // From July 2024, so 2024 is a part year, to the end of 2025.
  const startMs = Date.UTC(2024, 5, 30, 14);
  const length = 48 * (184 + 365);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = Math.floor(((startMs + i * 18e5 + 10 * 36e5) % 864e5) / 36e5);
    columns.gas[i] = hour >= 18 && hour <= 21 ? 380 : 80;
    columns.wind[i] = 1200;
    columns.solar_rooftop[i] = hour >= 9 && hour <= 15 ? 1000 : 0;
    columns.demand[i] = 1400;
    columns.price[i] = 50;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 30, columns }, length, au, LEVELS.sa);
  assert.deepEqual(f.rows.map((r) => r.year), [2025, 'past365']);
  assert.equal(f.lastFuel, 'gas');
  const y25 = f.rows[0];
  assert.ok(Math.abs(y25.fosMin - 0.08) < 1e-9);
  // Under 100 MW for 20 hours a day, and under 10% of generation all day.
  assert.equal(y25.fossilLowHours, 20 * 365);
  assert.equal(y25.fossilShare10Hours, 20 * 365);
  assert.ok(f.fossilLowSpell && f.fossilLowSpell.end - f.fossilLowSpell.start === 40);
  // Gas above the 50 MW floor: 30 MW for 20 hours and 330 MW for four, 1.92 GWh; within the 0.5 GW, 2 GWh fleet and above.
  assert.ok(Math.abs(y25.gasDays[0].gwh - (0.03 * 20 + 0.33 * 4)) < 1e-9);
  assert.deepEqual(y25.batteriesGas.map((b) => b.days), [0, 365, 365, 365]);
});
