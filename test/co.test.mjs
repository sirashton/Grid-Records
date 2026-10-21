import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CO_COLUMNS, fuelColumn, plantColumn, parseMonth, plantMap, monthRange, dayStartMs } from '../pipeline/sources/xm.mjs';
import { mergeColombia, needsFetch } from '../pipeline/build-co.mjs';

const hours = (v) => Object.fromEntries(Array.from({ length: 24 }, (_, h) => [`Hour${String(h + 1).padStart(2, '0')}`, v === null ? '' : String(v)]));
const hourly = (date, code, v, extra = {}) => ({ Date: date, HourlyEntities: [{ Id: 'Recurso', Values: { code, ...extra, ...hours(v) } }] });
const plants = plantMap({ Items: [
  { Date: '2026-10-21', ListEntities: [{ Id: 'Sistema', Values: { Code: 'HYD', Type: 'HIDRAULICA', EnerSource: 'AGUA' } }] },
  { Date: '2026-10-21', ListEntities: [{ Id: 'Sistema', Values: { Code: 'TGAS', Type: 'TERMICA', EnerSource: 'GAS' } }] },
  { Date: '2026-10-21', ListEntities: [{ Id: 'Sistema', Values: { Code: 'SUN', Type: 'SOLAR', EnerSource: 'RAD SOLAR' } }] },
  { Date: '2026-10-21', ListEntities: [{ Id: 'Sistema', Values: { Code: 'CANE', Type: 'COGENERADOR', EnerSource: 'BAGAZO' } }] },
] });

test('XM fuel and plant names map to grid columns', () => {
  assert.equal(fuelColumn('CARBON'), 'coal');
  assert.equal(fuelColumn('GAS'), 'gas');
  assert.equal(fuelColumn('GLP'), 'gas');
  assert.equal(fuelColumn('BIOGAS'), 'biomass');
  assert.equal(fuelColumn('BAGAZO'), 'biomass');
  assert.equal(fuelColumn('ACPM'), 'oil');
  assert.equal(fuelColumn('COMBUSTOLEO'), 'oil');
  assert.equal(fuelColumn('JET-A1'), 'oil');
  assert.equal(fuelColumn('??'), null);
  assert.equal(plantColumn({ Type: 'HIDRAULICA', EnerSource: 'AGUA' }), 'hydro');
  assert.equal(plantColumn({ Type: 'EOLICA', EnerSource: 'VIENTO' }), 'wind');
  assert.equal(plantColumn({ Type: 'Solar', EnerSource: 'RAD SOLAR' }), 'solar');
  assert.equal(plantColumn({ Type: 'COGENERADOR', EnerSource: 'BAGAZO' }), 'biomass');
  assert.equal(plantColumn({ Type: 'TERMICA', EnerSource: 'CARBON' }), 'coal');
  assert.equal(plantColumn(undefined), null);
});

test('months and days in Colombia time', () => {
  assert.deepEqual(monthRange('202402'), { start: '2024-02-01', end: '2024-02-29', days: 29 });
  assert.equal(dayStartMs('2024-02-01'), Date.UTC(2024, 1, 1, 5));
});

test('parses a month of plant output into average MW by fuel', () => {
  const gene = { Items: [
    hourly('2024-02-01', 'HYD', 1000000),
    hourly('2024-02-01', 'TGAS', 300000),
    hourly('2024-02-01', 'SUN', null),
    hourly('2024-02-01', 'CANE', 20000),
    hourly('2024-02-01', 'TFL2', 50000),
    hourly('2024-02-01', 'GONE', 7000),
    hourly('2024-02-02', 'HYD', -500),
  ] };
  // The gas plant burned a quarter diesel by energy each hour.
  const fuel = { Items: [hourly('2024-02-01', 'TGAS', 300, { Name: 'GAS' }), hourly('2024-02-01', 'TGAS', 100, { Name: 'ACPM' })] };
  const p = parseMonth('202402', gene, fuel, plants);
  assert.equal(p.startMs, Date.UTC(2024, 1, 1, 5));
  assert.equal(p.length, 29 * 24);
  assert.deepEqual(Object.keys(p.columns), CO_COLUMNS);
  assert.equal(p.columns.hydro[0], 1000);
  assert.equal(p.columns.gas[5], 225 + 50);
  assert.equal(p.columns.oil[5], 75);
  assert.equal(p.columns.solar[0], 0);
  assert.equal(p.columns.biomass[0], 20);
  assert.equal(p.columns.other[23], 7);
  assert.deepEqual(p.unknown, [['GONE', 168]]);
  // A plant's negative net output reads as zero; a day nobody reported is missing.
  assert.equal(p.columns.hydro[24], 0);
  assert.equal(p.columns.hydro[48], null);
  assert.equal(p.days, 2);
});

test('stitches months and ends at the last hour with data', () => {
  const piece = (ym, filled) => {
    const { start, days } = monthRange(ym);
    const length = days * 24;
    const col = Array.from({ length }, (_, i) => (i < filled ? 100 : null));
    return { startMs: dayStartMs(start), length, columns: Object.fromEntries(CO_COLUMNS.map((c) => [c, col])) };
  };
  const m = mergeColombia([piece('202601', 31 * 24), piece('202602', 10)]);
  assert.equal(m.startMs, Date.UTC(2026, 0, 1, 5));
  assert.equal(m.length, 31 * 24 + 10);
  assert.equal(m.columns.hydro.at(-1), 100);
});

test('refetches the current month each run and recent months daily', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const ago = (min) => ({ version: 1, fetched: new Date(now - min * 60000).toISOString() });
  assert.equal(needsFetch(undefined, 0, now), true);
  assert.equal(needsFetch(ago(10), 0, now), false);
  assert.equal(needsFetch(ago(30), 0, now), true);
  assert.equal(needsFetch(ago(30), 2, now), false);
  assert.equal(needsFetch(ago(25 * 60), 2, now), true);
  assert.equal(needsFetch(ago(25 * 60), 40, now), false);
});

test('Colombia story: drought years, the noon dip and the nights', async () => {
  const { storyFigures } = await import('../site/js/co/story.js');
  // Two years and a bit of hours from New Year 2024, Colombia time.
  const startMs = Date.UTC(2024, 0, 1, 5);
  const length = 24 * (366 + 365 + 31);
  const columns = Object.fromEntries(CO_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = i % 24;
    const y2024 = i < 366 * 24;
    const sunny = hour >= 8 && hour < 16;
    columns.hydro[i] = 6000;
    // 2024 is a drought year: 3 GW of gas all day. 2025: 1 GW, half of it at noon.
    columns.gas[i] = y2024 ? 3000 : sunny ? 500 : 1000;
    columns.coal[i] = 500;
    columns.solar[i] = sunny ? 1000 : 0;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 60, columns }, length);
  assert.equal(f.rows.map((r) => r.year).join(), '2024,2025,past365');
  const [y24, y25] = f.rows;
  // Hydro 6 GW, solar a third of a GW on average, fossil 3.5 GW.
  assert.ok(Math.abs(y24.fosShare - 3.5 / (9.5 + 1 / 3)) < 1e-9, `${y24.fosShare}`);
  assert.equal(y24.fosMin, 3.5);
  assert.equal(y25.fosMin, 1);
  assert.equal(y25.noon.fossil, 1);
  assert.equal(y25.night.fossil, 1.5);
  // Nights run 19:00 to 04:59: ten hours at 1.5 GW.
  assert.equal(y25.medianNight, 15);
  assert.equal(y25.under[2], 365 * 24);
  assert.equal(y25.under[1], 0);
  assert.equal(f.months[0].year, 2024);
  assert.equal(f.months.length, 25);
  assert.ok(Math.abs(f.months[0].fos - 3.5) < 1e-9);
  assert.equal(f.under1Spell, null);
  assert.equal(f.over3Spell.end - f.over3Spell.start, 366 * 24);
});
