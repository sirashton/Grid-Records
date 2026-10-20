import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyFigures, facts, GAS_FLOOR, WIND_HIGH, BATTERIES, HEAVY_DAYS } from '../site/js/story.js';

// Four half hours on 31 Dec 2023 and four on 1 Jan 2024.
const startMs = Date.UTC(2023, 11, 31, 22);
const cols = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Float64Array.from(v)]));
const data = {
  startMs,
  length: 8,
  columns: cols({
    coal: [500, 500, 500, 500, 0, 0, 100, 0],
    gas: [500, 500, 500, 500, 4000, 6000, 4000, NaN],
    wind: [1000, 1000, 1000, 1000, 6000, 4000, 6000, 1000],
    wind_emb: [0, 0, 0, 0, 0, 0, 0, 0],
    solar: [0, 0, 0, 0, 0, 0, 0, 0],
    nuclear: [0, 0, 0, 0, 0, 0, 0, 0],
    storage: [0, 0, 0, 0, -500, 0, 0, 0],
  }),
};

test('facts finds the last real coal output and the best half hours', () => {
  const f = facts(data);
  assert.equal(f.lastCoal, 3);
  assert.equal(f.wind.v, 6000);
  assert.equal(f.fossil.v, 1000);
});

// Two years and a month of half hours from New Year 2024, UK time. Gas runs
// at 3 GW at night and 12 GW from 16:00 to 20:00; wind is 20 GW on the first
// ten days of each month (gas drops to 1.5 GW then) and 5 GW otherwise.
test('GB story: gas by hour and wind band, the floor, heavy days and battery sizing', () => {
  const names = ['gas', 'coal', 'nuclear', 'wind', 'wind_emb', 'solar', 'hydro', 'biomass', 'imports', 'storage', 'other'];
  const start = Date.UTC(2024, 0, 1);
  const length = 48 * (366 + 365 + 30);
  const columns = Object.fromEntries(names.map((c) => [c, new Float64Array(length)]));
  const clock = new Intl.DateTimeFormat('en', { timeZone: 'Europe/London', hour: 'numeric', day: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const parts = Object.fromEntries(clock.formatToParts(new Date(start + i * 18e5)).map((p) => [p.type, Number(p.value)]));
    const evening = parts.hour >= 16 && parts.hour < 20;
    const windy = parts.day <= 10;
    columns.wind[i] = windy ? 20000 : 5000;
    columns.gas[i] = windy ? 1500 : evening ? 12000 : 3000;
    columns.nuclear[i] = 5000;
    columns.imports[i] = 2000;
    columns.solar[i] = evening ? 0 : 1000;
  }
  const d = { startMs: start, length, stepMinutes: 30, columns };
  const f = storyFigures(d, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const y = f.rows.find((r) => r.year === 2025);
  assert.equal(y.days, 365);
  // Gas by local hour: 3 GW or 1.5 GW outside the evening, 12 GW or 1.5 GW in it.
  const windyDays = 120;
  const calmDays = 365 - windyDays;
  assert.ok(Math.abs(y.gasHour[3] - (windyDays * 1.5 + calmDays * 3) / 365) < 1e-9);
  assert.ok(Math.abs(y.gasHour[18] - (windyDays * 1.5 + calmDays * 12) / 365) < 1e-9);
  // Wind bands: the top band holds the windy days at 1.5 GW, so that is the floor.
  const top = y.bands.at(-1);
  assert.equal(top.from, 20);
  assert.equal(top.hours, windyDays * 24);
  assert.equal(top.min, 1.5);
  assert.equal(top.gas, 1.5);
  assert.equal(y.gasMin, 1.5);
  assert.ok(WIND_HIGH <= 20);
  assert.ok(Math.abs(y.windyTwh - (windyDays * 24 * 1.5) / 1000) < 1e-9);
  assert.equal(y.windyHours, windyDays * 24);
  // Calm days burn 20 h at 3 GW and 4 h at 12 GW: 108 GWh a day, 24.6 TWh a year in all.
  const calmGwh = 20 * 3 + 4 * 12;
  assert.ok(Math.abs(y.gasTwh - (calmDays * calmGwh + windyDays * 24 * 1.5) / 1000) < 1e-9);
  // The October clock change gives one calm day an extra hour at 3 GW.
  assert.equal(y.heavy.days, HEAVY_DAYS);
  assert.ok(Math.abs(y.heavy.gasGwh - (calmGwh + 3 / HEAVY_DAYS)) < 1e-9);
  assert.equal(y.heavy.windGw, 5);
  assert.equal(y.light.windGw, 20);
  assert.ok(Math.abs(y.light.gasGwh - 36) < 1e-9);
  // Hours under the levels: windy days are under 2 GW and 5 GW; calm nights are under 5 GW.
  assert.equal(y.gasU1, 0);
  assert.equal(y.gasU2, windyDays * 24);
  assert.equal(y.gasU5, windyDays * 24 + calmDays * 20);
  assert.equal(GAS_FLOOR, 2);
  // Gas above the floor: a calm day needs 20 × 1 + 4 × 10 = 60 GWh with a 10 GW peak (61 on the
  // 25-hour day, 59 on the 23-hour one); a windy day nothing.
  assert.equal(y.gasDays.length, 365);
  assert.equal(y.gasDays[0].gwh, 0);
  assert.ok(Math.abs(y.gasDays.at(-1).gwh - 61) < 1e-9);
  assert.ok(Math.abs(y.gasDays.at(-1).peak - 10) < 1e-9);
  assert.ok(Math.abs(y.aboveTwh - (calmDays * 60) / 1000) < 1e-9);
  // Today's fleet covers only the windy days; a 15 GW, 30 GWh fleet lacks energy; the larger ones cover every day.
  assert.deepEqual(y.batteries.map((b) => b.days), BATTERIES.map(([gw, gwh]) => (gw >= 10 && gwh >= 60 ? 365 : windyDays)));
  // Supply is gas, nuclear, wind, solar and imports.
  assert.ok(Math.abs(y.supplyTwh - (y.gasTwh + y.windTwh + y.solarTwh + y.impTwh + (5 * 8760) / 1000)) < 1e-6);
  // The longest spell with gas under 2 GW runs the ten windy days of a month.
  assert.equal(f.gas2Spell.end - f.gas2Spell.start, 10 * 48);
  assert.equal(f.fossil1Spell, null);
  assert.equal(f.facts.lastCoal, -1);
});
