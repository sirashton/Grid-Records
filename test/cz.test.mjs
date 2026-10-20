import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPower, CZ_SOURCES, CZ_COLUMNS } from '../pipeline/sources/energy-charts.mjs';
import { mergeCzechia } from '../pipeline/build-cz.mjs';

const response = (ts, types) => ({ unix_seconds: ts, production_types: Object.entries(types).map(([name, data]) => ({ name, data })) });

test('Czechia: Energy-Charts types map to the dataset columns', () => {
  const t0 = Date.UTC(2016, 0, 5) / 1000;
  const m = parsePublicPower(response([t0, t0 + 3600], {
    Nuclear: [3900, 3910],
    'Fossil brown coal / lignite': [5200, 5100],
    'Fossil hard coal': [400, 410],
    'Wind onshore': [100, 120],
    'Other renewables': [50, 50],
    Biomass: [300, 300],
    Load: [8000, 8100],
    'Cross border electricity trading': [-1500, 200],
  }), { sources: CZ_SOURCES, fillMinutes: 60 });
  assert.deepEqual(Object.keys(m.columns), CZ_COLUMNS);
  assert.deepEqual(m.columns.lignite, [5200, 5200, 5200, 5200, 5100, 5100, 5100, 5100]);
  assert.equal(m.columns.wind[0], 100);
  assert.equal(m.columns.biomass[0], 350);
  assert.equal(m.columns.exports[0], -1500);
  assert.equal(m.columns.imports[4], 200);
  assert.ok(!CZ_COLUMNS.includes('wind_offshore'));
});

test('Czechia: blank nuclear, lignite and load readings are missing, not zero', () => {
  const t = Date.UTC(2024, 5, 1);
  const power = { startMs: t, length: 3, columns: { nuclear: [3900, 0, 3800], lignite: [4000, 0, 250], demand: [7000, 0, 7100], solar: [0, 0, 0] } };
  const prices = { startMs: t, length: 4, columns: { price: [80, 81, 82, 83] } };
  const m = mergeCzechia([power], [prices]);
  assert.equal(m.length, 3);
  for (const c of ['nuclear', 'lignite', 'demand']) assert.ok(Number.isNaN(m.columns[c][1]), c);
  // Lignite really does fall to a few hundred MW now.
  assert.equal(m.columns.lignite[2], 250);
  assert.equal(m.columns.solar[1], 0);
  assert.deepEqual([...m.columns.price], [80, 81, 82]);
});

test('Czechia story: lignite floor, exports, levels and the closure gap', async () => {
  const { storyFigures, closureGap, LIG_LEVELS } = await import('../site/js/cz/figures.js');
  const cols = [...CZ_COLUMNS, 'price'];
  // One year and a month of quarter hours, from New Year 2025 in Czech time.
  const startMs = Date.UTC(2024, 11, 31, 23);
  const length = 96 * (365 + 30);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', hour: 'numeric', hourCycle: 'h23' });
  for (let i = 0; i < length; i++) {
    const hour = Number(hourOf.format(new Date(startMs + i * 900000)));
    const sunny = hour >= 10 && hour < 16;
    // Lignite 2 GW at midday (six hours), 5 GW otherwise; exports 1 GW at
    // midday and 2 GW otherwise.
    columns.lignite[i] = sunny ? 2000 : 5000;
    columns.nuclear[i] = 4000;
    columns.solar[i] = sunny ? 3000 : 0;
    columns.exports[i] = sunny ? -1000 : -2000;
    columns.demand[i] = 7000;
    columns.price[i] = sunny ? -5 : 100;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 15, columns }, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2025, 'past365']);
  const y = f.rows[0];
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.equal(y.hours, 365 * 24);
  assert.ok(near(y.ligTwh, (2 * 6 + 5 * 18) * 365 / 1000));
  assert.equal(y.ligMin, 2);
  assert.equal(y.ligMax, 5);
  assert.equal(y.ligDayMinMedian, 2);
  assert.ok(near(y.ligHour[12], 2) && near(y.ligHour[3], 5));
  // Always exporting: all lignite is burnt while exporting.
  assert.equal(y.ligExportingShare, 1);
  assert.equal(y.impHours, 0);
  assert.ok(near(y.netExpTwh, (1 * 6 + 2 * 18) * 365 / 1000));
  // Above 3 GW: the 18 night hours, 2 GW each over the level, of which exports match 2 GW.
  const l3 = y.levels[LIG_LEVELS.indexOf(3)];
  assert.equal(l3.hours, 18 * 365);
  assert.ok(near(l3.twh, 2 * 18 * 365 / 1000));
  assert.ok(near(l3.exportedTwh, l3.twh));
  // Above 1.5 GW: every hour. Midday is 0.5 GW over, all exported; night is
  // 3.5 GW over against 2 GW of exports.
  const g = closureGap(y, 1.5);
  assert.equal(g.hours, 24 * 365);
  assert.ok(near(g.exportedShare, (0.5 * 6 + 2 * 18) / (0.5 * 6 + 3.5 * 18)));
  // Above 4 GW: 1 GW over at night, all matched by 2 GW of exports.
  const g4 = closureGap(y, 4);
  assert.ok(near(g4.twh, 18 * 365 / 1000) && near(g4.exportedShare, 1));
  // Halfway between levels interpolates.
  const g35 = closureGap(y, 3.25);
  assert.ok(near(g35.twh, 1.75 * 18 * 365 / 1000));
  // Negative prices at midday, with lignite still at 2 GW.
  assert.equal(y.negPriceHours, 6 * 365);
  assert.ok(near(y.ligNegPriceTwh, 2 * 6 * 365 / 1000));
  // Lignite never under 2 GW, so the record spell below 2 GW is none, below 2.5 GW is six hours.
  const sp = Object.fromEntries(f.ligSpells.map((s) => [s.gw, s.spell]));
  assert.equal(sp[2], null);
  assert.equal(sp[2.5].slots, 24);
});
