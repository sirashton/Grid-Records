import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fuelColumn, localToUtc, cellDay, springDay, fallDay, parseWorkbook, pageLinks, parseDashboard, rowsToPiece, TX_COLUMNS,
} from '../pipeline/sources/ercot.mjs';
import { mergeTexas } from '../pipeline/build-tx.mjs';
import { colIndex, parseSharedStrings, parseSheet, serialToMs } from '../pipeline/sources/xlsx.mjs';

const H = 3600000;
const Q = 900000;

test('maps ERCOT fuel names to columns', () => {
  assert.equal(fuelColumn('Coal'), 'coal');
  assert.equal(fuelColumn('Gas-CC'), 'gas');
  assert.equal(fuelColumn('Gas_CC'), 'gas');
  assert.equal(fuelColumn('Gas_GT'), 'gas');
  assert.equal(fuelColumn('Gas'), 'gas');
  assert.equal(fuelColumn(' Wind '), 'wind');
  assert.equal(fuelColumn('Other'), 'other');
  assert.equal(fuelColumn('Wnd'), 'wind');
  assert.equal(fuelColumn('Sun'), 'solar');
  assert.equal(fuelColumn('Oth'), 'other');
  assert.equal(fuelColumn('WSL'), '');
  assert.equal(fuelColumn('Unicorn'), null);
});

test('reads Central time, with the spring and fall clock changes', () => {
  assert.equal(springDay(2025), Date.UTC(2025, 2, 9));
  assert.equal(fallDay(2025), Date.UTC(2025, 10, 2));
  // Winter: UTC-6. Summer: UTC-5.
  assert.equal(localToUtc(Date.UTC(2025, 0, 15), 0), Date.UTC(2025, 0, 15, 6));
  assert.equal(localToUtc(Date.UTC(2025, 6, 1), 12 * 60), Date.UTC(2025, 6, 1, 17));
  // Spring: 02:00 to 02:59 never happened.
  const s = springDay(2025);
  assert.equal(localToUtc(s, 105), Date.UTC(2025, 2, 9, 7, 45));
  assert.equal(localToUtc(s, 120), null);
  assert.equal(localToUtc(s, 180), Date.UTC(2025, 2, 9, 8));
  // Fall: 01:00 to 01:59 happens twice, first in daylight time.
  const f = fallDay(2025);
  assert.equal(localToUtc(f, 60), Date.UTC(2025, 10, 2, 6));
  assert.equal(localToUtc(f, 60, true), Date.UTC(2025, 10, 2, 7));
  assert.equal(localToUtc(f, 120), Date.UTC(2025, 10, 2, 8));
});

test('reads dates as Excel serials or text', () => {
  assert.equal(cellDay(45658), Date.UTC(2025, 0, 1));
  assert.equal(cellDay('12/01/07'), Date.UTC(2007, 11, 1));
  assert.equal(cellDay('3/9/2025'), Date.UTC(2025, 2, 9));
  assert.equal(cellDay('Total'), null);
});

const dayIndex = (startMs, day, minutes, second) => Math.round((localToUtc(day, minutes, second) - startMs) / Q);

test('parses the split layout into MW, with spring blanks and fall extras', () => {
  const quarters = (v) => Array.from({ length: 96 }, () => v);
  const spring = springDay(2025);
  const fall = fallDay(2025);
  const springRow = quarters(100);
  for (let k = 8; k < 12; k++) springRow[k] = null;
  const fallRow = [...quarters(50), 10, 20, 30, 40];
  const sheets = [
    { name: 'Summary', rows: [['Fuel', 'Total'], ['Coal', 1]] },
    { name: 'Jan', rows: [['Date', 'Fuel', 'Settlement Type', 'Total', '0:15'], [45658, 'Coal', 'FINAL', 9600, ...quarters(1000)], [45658, 'Gas-CC', 'FINAL', 0, ...quarters(500)], [45658, 'Gas_GT', 'FINAL', 0, ...quarters(250)], [45658, 'WSL', 'FINAL', 0, ...quarters(-5)]] },
    { name: 'Mar', rows: [['Date', 'Fuel', 'Settlement Type', 'Total'], [spring / 864e5 + 25569, 'Wind', 'FINAL', 0, ...springRow]] },
    { name: 'Nov', rows: [['Date', 'Fuel', 'Settlement Type', 'Total'], [fall / 864e5 + 25569, 'Solar', 'FINAL', 0, ...fallRow]] },
  ];
  const p = parseWorkbook(sheets, 2025);
  assert.equal(p.startMs, Date.UTC(2025, 0, 1, 6));
  assert.equal(p.length, 365 * 96);
  assert.equal(p.days, 3);
  assert.deepEqual(p.unknown, []);
  // MWh per quarter hour times four is MW; gas adds its two kinds.
  assert.equal(p.columns.coal[0], 4000);
  assert.equal(p.columns.gas[0], 3000);
  assert.equal(p.columns.wind[0], 0);
  // A day no sheet lists stays missing.
  assert.equal(p.columns.coal[96], null);
  // Spring: 92 quarter hours, all 400 MW of wind.
  const sp = dayIndex(p.startMs, spring, 0);
  assert.equal(p.columns.wind.slice(sp, sp + 92).every((v) => v === 400), true);
  assert.equal(p.columns.wind[sp + 92], null);
  // Fall: the four extra cells are the second pass through 01:00 to 01:59.
  assert.equal(p.columns.solar[dayIndex(p.startMs, fall, 60, false)], 200);
  assert.equal(p.columns.solar[dayIndex(p.startMs, fall, 60, true)], 40);
  assert.equal(p.columns.solar[dayIndex(p.startMs, fall, 105, true)], 160);
  assert.equal(p.columns.solar[dayIndex(p.startMs, fall, 120)], 200);
  assert.equal(p.columns.solar.slice(dayIndex(p.startMs, fall, 0), dayIndex(p.startMs, fall, 0) + 100).filter((v) => v != null).length, 100);
});

test('parses the older combined date and fuel layouts', () => {
  const sheets = [
    { name: 'Dec07', rows: [['Date-Fuel', 'Daily MWH', '0:15'], ['12/01/07 - Coal', 0, ...Array(96).fill(2500)], ['12/01/07 - Hydro', 0, ...Array(96).fill(10)], ['12/01/07 - Mystery', 0, 1]] },
  ];
  const p = parseWorkbook(sheets, 2007);
  const i = dayIndex(p.startMs, Date.UTC(2007, 11, 1), 0);
  assert.equal(p.columns.coal[i], 10000);
  assert.equal(p.columns.hydro[i + 95], 40);
  assert.equal(p.columns.nuclear[i], 0);
  assert.deepEqual(p.unknown, ['Mystery']);
  const b = parseWorkbook([{ name: 'Jan', rows: [['Date-Fuel', 'Total'], ['01/01/16_Biomass', 0, ...Array(96).fill(30)]] }], 2016);
  assert.equal(b.columns.biomass[0], 120);
});

test('finds the workbook links on the Fuel Mix page', () => {
  const html = '<a href="/files/docs/2026/02/09/IntGenbyFuel2026.xlsx">2026</a> <a href="/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip">older</a>';
  const l = pageLinks(html);
  assert.equal(l.years[2026], 'https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx');
  assert.equal(l.previous, 'https://www.ercot.com/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip');
});

test('averages the dashboard into complete quarter hours, batteries in other', () => {
  const day = {};
  for (let m = 0; m < 20; m += 5) {
    day[`2026-10-19 00:${String(m).padStart(2, '0')}:00-0500`] = {
      'Natural Gas': { gen: 30000 + m * 100 }, Wind: { gen: 10000 }, Other: { gen: 100 },
      'Power Storage Discharging': { gen: 900 }, 'Power Storage Charging': { gen: -500 }, 'Power Storage': { gen: 400 },
    };
  }
  const rows = parseDashboard({ data: { today: day } });
  const q = Date.UTC(2026, 9, 19, 5);
  assert.deepEqual(Object.keys(rows).map(Number), [q]);
  assert.equal(rows[q].gas, 30500);
  assert.equal(rows[q].other, 1000);
  assert.equal(rows[q].wind, 10000);
  const piece = rowsToPiece(rows);
  assert.equal(piece.columns.coal[0], 0);
  assert.equal(piece.columns.biomass[0], null);
});

test('lays the dashboard after the reports and ends at the last data', () => {
  const col = (n, v) => Array(n).fill(v);
  const year = { startMs: Date.UTC(2026, 0, 1, 6), length: 8, columns: Object.fromEntries(TX_COLUMNS.map((c) => [c, [...col(4, 1), ...col(4, null)]])) };
  const t = year.startMs + 6 * Q;
  const merged = mergeTexas([year], { [t]: { gas: 7 } });
  assert.equal(merged.length, 7);
  assert.equal(merged.columns.gas[3], 1);
  assert.ok(Number.isNaN(merged.columns.gas[4]));
  assert.equal(merged.columns.gas[6], 7);
  assert.ok(Number.isNaN(merged.columns.biomass[6]));
});

test('reads xlsx sheet XML with shared strings', () => {
  assert.equal(colIndex('A'), 0);
  assert.equal(colIndex('AA'), 26);
  const strings = parseSharedStrings('<sst><si><t>Coal</t></si><si><r><t>Ga</t></r><r><t>s</t></r></si></sst>');
  assert.deepEqual(strings, ['Coal', 'Gas']);
  const rows = parseSheet('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>2.5</v></c></row><row r="3"><c r="B3" t="s"><v>1</v></c></row></sheetData>', strings);
  assert.equal(rows[0][0], 'Coal');
  assert.equal(rows[0][1] ?? null, null);
  assert.equal(rows[0][2], 2.5);
  assert.equal(rows[1][1], 'Gas');
  assert.equal(serialToMs(45658), Date.UTC(2025, 0, 1));
});

test('Texas story: fossil by hour, the evening hump and the part year', async () => {
  const { storyFigures, BATTERIES } = await import('../site/js/tx/story.js');
  // Two years and nine months of quarter hours from New Year 2024, Central time.
  const startMs = Date.UTC(2024, 0, 1, 6);
  const length = 96 * (366 + 365 + 273);
  const columns = Object.fromEntries(TX_COLUMNS.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const hour = Number(hourOf.format(new Date(startMs + i * Q)));
    const sunny = hour >= 9 && hour < 17;
    // Gas runs 20 GW, less 10 GW while the sun is up, plus 10 GW from 19:00 to 21:59.
    columns.gas[i] = 20000 - (sunny ? 10000 : 0) + (hour >= 19 && hour < 22 ? 10000 : 0);
    columns.coal[i] = 5000;
    columns.solar[i] = sunny ? 10000 : 0;
    columns.wind[i] = 10000;
    columns.other[i] = hour === 20 ? 2000 : 0;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  const y24 = f.rows.find((r) => r.year === 2024);
  assert.equal(f.rows.map((r) => r.year).join(), '2024,2025,past365');
  // Within a little: the hours around the two clock changes can be one off.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.05, `${a} vs ${b}`);
  near(y24.noon.fossil, 15);
  near(y24.evening.fossil, 35);
  near(y24.night.fossil, 25);
  near(y24.hourly.other[20], 2);
  assert.equal(y24.fosMin, 15);
  assert.equal(y24.otherMax, 2);
  // Fossil above its noon level from 15:00: none while the sun is up, 10 GW at
  // 17:00-18:59, 20 GW at 19:00-21:59 and 10 GW at 22:00-23:59 (hourly GW, so GWh).
  assert.equal(y24.medianHump.gwh, 10 * 2 + 20 * 3 + 10 * 2);
  assert.equal(y24.medianHump.peak, 20);
  assert.equal(y24.batteries.length, BATTERIES.length);
  assert.equal(y24.batteries[3].days, y24.days);
  // Hours under 20 GW of fossil: the eight sunny hours a day.
  near(y24.under[2] / 8, 366);
  // January to September, 2026 included.
  assert.deepEqual(f.part.map((p) => p.year), [2024, 2025, 2026]);
  assert.ok(Math.abs(f.part[2].gen - f.part[1].gen) < 1);
});
