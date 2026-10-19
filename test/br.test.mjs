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
    + row('02:00:00', 'Pequenas Usinas (MMGD)', 'FOTOVOLTAICA', 'Fotovoltaica', '7');
  const p = await parseGeneration(chunks(csv, 50), 2026, 9);
  assert.equal(p.startMs, Date.UTC(2026, 8, 1, 3));
  assert.equal(p.columns.hydro[0], 100.5);
  assert.equal(p.columns.wind[0], 40);
  // A fuel no plant reported in a present hour is zero.
  assert.equal(p.columns.coal[0], 0);
  assert.equal(p.columns.hydro[1], null);
  assert.equal(p.columns.solar_rooftop[2], 7);
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
  const load = { startMs: startMs + H, length: 4, columns: { demand: [9, 9, 9, 9] } };
  const m = mergeBrazil([gen, load]);
  assert.equal(m.length, 3);
  assert.ok(Number.isNaN(m.columns.solar_rooftop[0]));
  assert.equal(m.columns.solar_rooftop[2], 5);
  assert.ok(Number.isNaN(m.columns.demand[0]));
  assert.equal(m.columns.demand[1], 9);
  assert.ok(Number.isNaN(m.columns.wind_curtailed[0]));
});
