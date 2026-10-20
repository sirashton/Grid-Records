import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuelColumn, brToUtc, fileGrid, eachRow, splitQuoted, parseGeneration, parseCurtailment, BR_COLUMNS } from '../pipeline/sources/ons.mjs';
import { mergeBrazil } from '../pipeline/build-br.mjs';

const H = 3600000;
const chunks = async function* (text, size = 7) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
};

test('maps ONS plant types and fuels to columns', () => {
  assert.equal(fuelColumn('HIDROELÉTRICA', 'Hidráulica', 'TIPO I'), 'hydro');
  assert.equal(fuelColumn('NUCLEAR', 'Nuclear', 'TIPO I'), 'nuclear');
  assert.equal(fuelColumn('EOLIELÉTRICA', 'Eólica', 'Conjunto de Usinas'), 'wind');
  assert.equal(fuelColumn('FOTOVOLTAICA', 'Fotovoltaica', 'TIPO I'), 'solar_utility');
  assert.equal(fuelColumn('FOTOVOLTAICA', 'Fotovoltaica', 'Pequenas Usinas (MMGD)'), 'solar_rooftop');
  assert.equal(fuelColumn('TÉRMICA', 'Gás', 'TIPO I'), 'gas');
  assert.equal(fuelColumn('TÉRMICA', 'Carvão', 'TIPO I'), 'coal');
  assert.equal(fuelColumn('TÉRMICA', 'Óleo Diesel', 'TIPO I'), 'oil');
  assert.equal(fuelColumn('TÉRMICA', 'Multi-Combustível Diesel/Óleo', 'TIPO I'), 'oil');
  assert.equal(fuelColumn('TÉRMICA', 'Biomassa', 'TIPO I'), 'biomass');
  assert.equal(fuelColumn('TÉRMICA', 'Resíduos Industriais', 'TIPO I'), 'other');
  assert.equal(fuelColumn('BOMBEAMENTO', 'Hidráulica', 'TIPO I'), '');
  assert.equal(fuelColumn('???', 'x', ''), null);
});

test('reads Brasília wall time, with and without daylight saving', () => {
  // Standard time is UTC-3.
  assert.equal(brToUtc('2026-09-01 00:00:00'), Date.UTC(2026, 8, 1, 3));
  // Summer time (UTC-2) in January 2018.
  assert.equal(brToUtc('2018-01-15 12:00:00'), Date.UTC(2018, 0, 15, 14));
  // Saving started at midnight on 4 November 2018: that hour never happened.
  assert.equal(brToUtc('2018-11-04 00:00:00'), null);
  // It ended at midnight on 17 February 2019: 23:00 on the 16th happened twice; take the first.
  assert.equal(brToUtc('2019-02-16 23:00:00'), Date.UTC(2019, 1, 17, 1));
  assert.equal(brToUtc('2019-02-17 00:00:00'), Date.UTC(2019, 1, 17, 3));
});

test('a file covers whole local months or years in UTC hours', () => {
  const sept = fileGrid(2026, 9);
  assert.equal(sept.startMs, Date.UTC(2026, 8, 1, 3));
  assert.equal(sept.length, 720);
  // 2018 lost an hour in November and gained one back in February.
  assert.equal(fileGrid(2018).length, 8760);
});

test('handles quoted fields that run over line breaks', async () => {
  assert.deepEqual(splitQuoted('a;"b;c";"d ""e"""'), ['a', 'b;c', 'd "e"']);
  const rows = [];
  await eachRow(chunks('x;note;v\r\n1;"two\nlines; here";3\n4;plain;5'), (f, ix) => rows.push([f[ix.x], f[ix.v]]));
  assert.deepEqual(rows, [['1', '3'], ['4', '5']]);
});

test('sums plants into hourly fuels; hours with no rows are missing', async () => {
  const head = 'din_instante;id_subsistema;nom_subsistema;id_estado;nom_estado;cod_modalidadeoperacao;nom_tipousina;nom_tipocombustivel;nom_usina;id_ons;ceg;val_geracao\n';
  const row = (t, mode, type, fuel, v) => `2026-09-01 ${t};NE;NORDESTE;BA;BAHIA;${mode};${type};${fuel};X;X;-;${v}\n`;
  const csv = head
    + row('00:00:00', 'TIPO I', 'HIDROELÉTRICA', 'Hidráulica', '100.5')
    + row('00:00:00', 'TIPO I', 'HIDROELÉTRICA', 'Hidráulica', '0E-8')
    + row('00:00:00', 'Conjunto de Usinas', 'EOLIELÉTRICA', 'Eólica', '40')
    + row('02:00:00', 'Pequenas Usinas (MMGD)', 'FOTOVOLTAICA', 'Fotovoltaica', '7')
    + row('02:00:00', 'TIPO I', 'HIDROELÉTRICA', 'Hidráulica', '130')
    + row('01:00:00', 'TIPO I', 'HIDROELÉTRICA', 'Hidráulica', '140')
    + row('03:00:00', 'TIPO I', 'TÉRMICA', 'Gás', '3');
  const p = await parseGeneration(chunks(csv, 50), 2026, 9);
  assert.equal(p.startMs, Date.UTC(2026, 8, 1, 3));
  assert.equal(p.columns.hydro[0], 100.5);
  assert.equal(p.columns.wind[0], 40);
  // A fuel no plant reported in a present hour is zero.
  assert.equal(p.columns.coal[0], 0);
  assert.equal(p.columns.hydro[1], 140);
  assert.equal(p.columns.hydro[4], null);
  assert.equal(p.columns.solar_rooftop[2], 7);
  // An hour where the plants read far less than usual is missing.
  assert.equal(p.columns.hydro[3], null);
  assert.deepEqual(p.unknown, []);
});

test('curtailment averages the two half hours of not-realised generation', async () => {
  const csv = 'id_subsistema;din_instante;val_geracao;val_geracaonaorealizadaapurada\n'
    + 'NE;2026-09-01 00:00:00;10;30\nNE;2026-09-01 00:30:00;10;10\nN;2026-09-01 00:30:00;5;\n';
  const p = await parseCurtailment(chunks(csv), 2026, 9, 'wind_curtailed');
  assert.equal(p.columns.wind_curtailed[0], 20);
  assert.equal(p.columns.wind_curtailed[1], null);
});

test('merge ends at the last hour with generation and leaves rooftop solar missing before ONS estimated it', () => {
  const startMs = Date.UTC(2023, 0, 1, 3);
  const cols = (o) => Object.fromEntries(BR_COLUMNS.map((c) => [c, o[c] ?? [0, 0, 0, 0]]));
  const gen = { startMs, length: 4, columns: cols({ hydro: [1, 2, 3, null], wind_curtailed: [], solar_curtailed: [], demand: [], solar_rooftop: [0, 0, 5, null] }) };
  for (const c of ['nuclear', 'coal', 'gas', 'oil', 'other', 'biomass', 'wind', 'solar_utility']) gen.columns[c] = [0, 0, 0, null];
  const load = { startMs: startMs + H, length: 4, columns: { demand: [9, 1, 9, 9] } };
  const m = mergeBrazil([gen, load]);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.solar_rooftop[0]));
  assert.equal(m.columns.solar_rooftop[2], 5);
  assert.ok(Number.isNaN(m.columns.demand[0]));
  assert.equal(m.columns.demand[1], 9);
  assert.ok(Number.isNaN(m.columns.demand[2]));
  assert.ok(Number.isNaN(m.columns.wind_curtailed[0]));
});

test('story figures: the flat fossil fleet, the midday sag, held back shares and battery sizing', async () => {
  const { storyFigures, FOSSIL_FLOOR, BATTERIES } = await import('../site/js/br/story.js');
  // Two years and a month of hours from New Year 2023 in Brasília (UTC-3, no saving since 2019).
  const startMs = Date.UTC(2023, 0, 1, 3);
  const length = 24 * (365 + 366 + 30);
  const columns = Object.fromEntries(BR_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const hour = i % 24;
    const in2024 = i >= 24 * 365;
    columns.hydro[i] = hour >= 10 && hour < 14 ? 25000 : 40000;
    // Gas 4 GW round the clock, 3 GW at midday in 2024; other thermal 2 GW always.
    columns.gas[i] = in2024 && hour >= 10 && hour < 13 ? 3000 : 4000;
    columns.other[i] = 2000;
    columns.wind[i] = 10000;
    columns.wind_curtailed[i] = hour === 10 ? 5000 : 0;
    columns.solar_curtailed[i] = NaN;
    columns.solar_rooftop[i] = hour === 11 ? 20000 : 0;
    columns.demand[i] = 50000;
  }
  const data = { startMs, length, stepMinutes: 60, columns };
  const f = storyFigures(data, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2023, 2024, 'past365']);
  const [y23, y24] = f.rows;
  // 6 GW all day in 2023: no sag, never under 5 GW, 3 GW above the floor for 24 hours.
  assert.equal(y23.fosMin, 6);
  assert.equal(y23.sag, 0);
  assert.equal(y23.fosLow, 0);
  assert.equal(y23.gasMin, 4);
  assert.equal(y23.otherMin, 2);
  assert.equal(y23.fosHour[10], 6);
  assert.equal(y23.heldHour[10], 5);
  assert.ok(Number.isNaN(y23.heldHour[11]) === false && y23.heldHour[11] === 0);
  assert.equal(y23.days.length, 365);
  assert.ok(Math.abs(y23.days[0].gwh - (6 - FOSSIL_FLOOR) * 24) < 1e-9);
  assert.ok(Math.abs(y23.aboveTwh - ((6 - FOSSIL_FLOOR) * 24 * 365) / 1000) < 1e-9);
  // 5 GWh held back a day never covers 72 GWh of fossil above the floor.
  assert.equal(y23.heldCovers, 0);
  assert.ok(Math.abs(y23.windHeldPct - (5000 / (10000 * 24 + 5000)) * 100) < 1e-9);
  assert.ok(Number.isNaN(y23.solarHeldPct));
  assert.ok(Math.abs(y23.heldTwh - (5 * 365) / 1000) < 1e-9);
  // January 2023 fossil: 6 GW for 31 days.
  assert.ok(Math.abs(y23.fosMonth[0] - (6 * 24 * 31) / 1000) < 1e-9);
  // 2024 sags 1 GW from 10:00 to 12:59 against the evening.
  assert.ok(Math.abs(y24.sag - 1) < 1e-9);
  assert.equal(y24.fosMin, 5);
  assert.equal(y24.fosLow, 0);
  // Only the 80 GWh and 160 GWh fleets hold a day's 69 GWh above the floor, at a 3 GW peak above it.
  assert.deepEqual(y24.batteries.map((b) => b.days), [0, 0, 366, 366]);
  assert.deepEqual(y24.batteries.map((b) => b.charged), [0, 0, 0, 0]);
  assert.equal(BATTERIES.length, 4);
  assert.equal(f.fossilHighSpell, null);
  // Fossil never under 5 GW, so no low spell, and no floor spell.
  assert.equal(f.fossilLowSpell, null);
  assert.equal(f.fossilFloorSpell, null);
});
