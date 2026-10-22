import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuelColumn, dayStartMs, estDate, parseFuelYear, addDemand, parseGeneratorDay, dayUrl, yearUrls } from '../pipeline/sources/ieso.mjs';
import { mergeOntario, needsFetch } from '../pipeline/build-on.mjs';

const fuelTotal = (fuel, v) => `<FuelTotal><Fuel>${fuel}</Fuel><EnergyValue><OutputQuality>0</OutputQuality><Output>${v}</Output></EnergyValue></FuelTotal>`;
const hour = (h, totals) => `<HourlyData><Hour>${h}</Hour>${totals.join('')}</HourlyData>`;
const year = (days) => `<Document><DocBody><DeliveryYear>2025</DeliveryYear>${days.map(([d, hs]) => `<DailyData><Day>${d}</Day>${hs.join('')}</DailyData>`).join('')}</DocBody></Document>`;
const generator = (name, fuel, outputs) => `<Generator><GeneratorName>${name}</GeneratorName><FuelType>${fuel}</FuelType><Outputs>${outputs.map((v, i) => `<Output><Hour>${i + 1}</Hour><EnergyMW>${v}</EnergyMW></Output>`).join('')}</Outputs><Capabilities><Capability><Hour>1</Hour><EnergyMW>9999</EnergyMW></Capability></Capabilities></Generator>`;

test('IESO fuels map to grid columns, and hours are Eastern Standard Time', () => {
  assert.equal(fuelColumn('NUCLEAR'), 'nuclear');
  assert.equal(fuelColumn('BIOFUEL'), 'biomass');
  assert.equal(fuelColumn('OTHER'), 'battery');
  assert.equal(fuelColumn('CONTROL ACTIONS'), null);
  assert.equal(dayStartMs('2025-07-01'), Date.UTC(2025, 6, 1, 5));
  assert.equal(estDate(Date.UTC(2025, 6, 2, 4, 59)), '2025-07-01');
  assert.equal(dayUrl('2026-10-21', '2026-10-22'), 'https://reports-public.ieso.ca/public/GenOutputCapability/PUB_GenOutputCapability_20261021.xml');
  assert.equal(dayUrl('2026-10-22', '2026-10-22'), 'https://reports-public.ieso.ca/public/GenOutputCapability/PUB_GenOutputCapability.xml');
  assert.match(yearUrls(2025, 2026).fuel, /PUB_GenOutputbyFuelHourly_2025\.xml$/);
  assert.match(yearUrls(2026, 2026).demand, /PUB_Demand\.csv$/);
});

test('parses a year of fuel totals and demand onto the hourly grid', () => {
  const xml = year([
    ['2025-01-01', [hour(1, [fuelTotal('NUCLEAR', 9000), fuelTotal('GAS', 1500), fuelTotal('OTHER', 20)]), hour(2, [fuelTotal('NUCLEAR', 9100), fuelTotal('GAS', '')])]],
    ['2025-01-02', [hour(24, [fuelTotal('GAS', 800), fuelTotal('CONTROL ACTIONS', 0)])]],
  ]);
  const p = parseFuelYear(xml);
  assert.equal(p.startMs, Date.UTC(2025, 0, 1, 5));
  assert.equal(p.length, 48);
  assert.equal(p.columns.nuclear[0], 9000);
  assert.equal(p.columns.gas[0], 1500);
  assert.equal(p.columns.battery[0], 20);
  assert.equal(p.columns.wind[0], 0, 'a fuel left out of a reported hour is 0');
  assert.equal(p.columns.gas[1], null, 'a blank output is missing');
  assert.equal(p.columns.nuclear[2], null, 'an hour not in the file is missing');
  assert.equal(p.columns.gas[47], 800);
  addDemand(p, '\\\\Hourly Demand Report,,,\nDate,Hour,Market Demand,Ontario Demand\n2025-01-01,1,19489,16526\n2025-01-02,24,17000,14000\n2026-01-01,1,1,1\n');
  assert.equal(p.columns.demand[0], 16526);
  assert.equal(p.columns.demand[47], 14000);
  assert.equal(p.columns.demand[1], null);
});

test('sums the generator report by fuel for the hours it has reached', () => {
  const xml = `<IMODocument><IMODocBody><Date>2026-10-22</Date><Generators>${generator('BRUCEA-G2', 'NUCLEAR', [818, 819])}${generator('BRUCEB-G5', 'NUCLEAR', [800, 801])}${generator('ONEIDA ENERGY STORAGE', 'OTHER', [39, ''])}</Generators></IMODocBody></IMODocument>`;
  const p = parseGeneratorDay(xml);
  assert.equal(p.startMs, Date.UTC(2026, 9, 22, 5));
  assert.equal(p.columns.nuclear[0], 1618);
  assert.equal(p.columns.nuclear[1], 1620);
  assert.equal(p.columns.battery[0], 39);
  assert.equal(p.columns.battery[1], 0);
  assert.equal(p.columns.gas[1], 0);
  assert.equal(p.columns.nuclear[2], null, 'hours not reached yet stay missing');
});

test('merges the yearly files with the recent days, yearly figures first', () => {
  const y = parseFuelYear(year([['2026-10-20', Array.from({ length: 24 }, (_, h) => hour(h + 1, [fuelTotal('NUCLEAR', 100)]))]]));
  const day = (d, v, n) => parseGeneratorDay(`<IMODocBody><Date>${d}</Date>${generator('N', 'NUCLEAR', Array(n).fill(v))}</IMODocBody>`);
  const m = mergeOntario([y], [day('2026-10-21', 200, 24), day('2026-10-20', 999, 24), day('2026-10-22', 300, 6)]);
  assert.equal(m.length, 54);
  assert.equal(m.columns.nuclear[0], 100);
  assert.equal(m.columns.nuclear[24], 200);
  assert.equal(m.columns.nuclear[53], 300);
  assert.ok(Number.isNaN(m.columns.demand[0]));
});

test('refetches the current year every few hours and settled years never', () => {
  const now = Date.UTC(2026, 9, 22, 12);
  const entry = (fetched) => ({ version: 1, fetched: new Date(fetched).toISOString() });
  assert.equal(needsFetch(undefined, 2020, 2026, now), true);
  assert.equal(needsFetch(entry(now - 3600000), 2026, 2026, now), false);
  assert.equal(needsFetch(entry(now - 4 * 3600000), 2026, 2026, now), true);
  assert.equal(needsFetch(entry(Date.UTC(2026, 0, 5)), 2025, 2026, now), true);
  assert.equal(needsFetch(entry(Date.UTC(2026, 2, 1)), 2025, 2026, now), false);
  assert.equal(needsFetch(entry(Date.UTC(2020, 0, 1)), 2019, 2026, now), false);
  assert.equal(needsFetch({ ...entry(now), version: 0 }, 2019, 2026, now), true);
});
