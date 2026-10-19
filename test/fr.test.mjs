import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FR_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeFrance } from '../pipeline/build-fr.mjs';

test('France: blank nuclear and load readings are missing, not zero', () => {
  const t = Date.UTC(2024, 5, 1);
  const power = { startMs: t, length: 3, columns: { nuclear: [45000, 0, 44000], demand: [52000, 30, 51000], solar: [0, 0, 0] } };
  const m = mergeFrance([power], []);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.nuclear[1]));
  assert.ok(Number.isNaN(m.columns.demand[1]));
  assert.equal(m.columns.nuclear[2], 44000);
  // Solar really is zero at night.
  assert.equal(m.columns.solar[1], 0);
  assert.ok(FR_COLUMNS.includes('nuclear'));
});

test('France story: the noon dip, export hours and fossil hours', async () => {
  const { storyFigures, DIP_DAY } = await import('../site/js/fr/story.js');
  const cols = [...FR_COLUMNS, 'price'];
  // Two years and a month of quarter hours, from New Year 2024 in French time.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const length = 96 * (366 + 365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const hour = Number(hourOf.format(new Date(startMs + i * 900000)));
    const sunny = hour >= 11 && hour < 16;
    // 2025 dips 5 GW at noon; 2024 runs flat.
    const in2025 = startMs + i * 900000 >= Date.UTC(2024, 11, 31, 23);
    columns.nuclear[i] = in2025 && sunny ? 35000 : 40000;
    columns.solar[i] = sunny ? 15000 : 0;
    columns.gas[i] = sunny ? 500 : 3000;
    columns.exports[i] = sunny ? -16000 : -5000;
    columns.price[i] = sunny ? 20 : 80;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  const y24 = f.rows.find((r) => r.year === 2024);
  const y25 = f.rows.find((r) => r.year === 2025);
  assert.equal(y24.dipDays, 0);
  assert.equal(y25.dipDays, 365);
  assert.ok(Math.abs(y25.dip - 5) < 1e-9 && y25.dip > DIP_DAY);
  assert.ok(Math.abs(y25.springDip - 5) < 1e-9);
  // Five sunny hours a day exporting over 15 GW with fossil under 1 GW.
  assert.equal(y25.expHigh, 365 * 5);
  assert.equal(y25.fosU1, 365 * 5);
  assert.equal(Math.round(y25.byHour[13]), 20);
  assert.ok(Math.abs(y24.nucTwh - 40 * 24 * 366 / 1000) < 1e-6);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
});
