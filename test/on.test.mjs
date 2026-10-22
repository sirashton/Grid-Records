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

test('story figures: gas share, the nightly floor, exports and spells', async () => {
  const { storyFigures } = await import('../site/js/on/story.js');
  const { ON_COLUMNS } = await import('../pipeline/sources/ieso.mjs');
  // Two years and a month of hours from New Year 2024, Eastern Standard Time.
  const startMs = Date.UTC(2024, 0, 1, 5);
  const length = 24 * (366 + 365 + 31);
  const columns = Object.fromEntries(ON_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = i % 24;
    const y2024 = i < 366 * 24;
    const evening = hour >= 16 && hour < 21;
    columns.nuclear[i] = 9000;
    columns.hydro[i] = 3000;
    // 2024: gas 0.5 GW at night and 2 GW in the evening. 2025: 3 GW all day.
    columns.gas[i] = y2024 ? (evening ? 2000 : 500) : 3000;
    columns.battery[i] = !y2024 && evening ? 500 : 0;
    // Demand 12 GW: in 2025 Ontario net exports 3 GW (3.5 GW in the evening).
    columns.demand[i] = 12000;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 60, columns }, length);
  assert.equal(f.rows.map((r) => r.year).join(), '2024,2025,past365');
  const [y24, y25] = f.rows;
  assert.ok(Math.abs(y25.gasShare - 3 / 15) < 1e-9, `${y25.gasShare}`);
  assert.equal(y24.floor, 0.5);
  assert.equal(y25.floor, 3);
  assert.equal(y24.gasMax, 2);
  assert.equal(y25.under[2], 0);
  assert.equal(y24.under[1], 366 * 19);
  // In 2025 every hour exports at least as much as gas runs.
  assert.ok(Math.abs(y25.gasInExportShare - 1) < 1e-9);
  assert.ok(Math.abs(y25.twh.netx - (3 * 365 * 24 + 0.5 * 365 * 5) / 1000) < 1e-6);
  assert.equal(y25.batMax, 0.5);
  assert.equal(y25.batEvening, 1, 'all discharge falls in 15:00 to 20:59');
  assert.equal(y24.hourly.gas[17], 2);
  assert.equal(f.months.length, 25);
  // The longest spell under 1 GW is a 2024 night: 19 hours (21:00 to 15:59).
  assert.equal(f.under1Spell.end - f.under1Spell.start, 19);
  assert.deepEqual(f.under1ByYear.map(([y]) => y), [2024]);
  assert.equal(f.over2Now.end, length);
});
