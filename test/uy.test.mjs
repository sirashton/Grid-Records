import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstSheetRows, parseMonth, monthDates, UY_COLUMNS, PARSE_VERSION } from '../pipeline/sources/adme.mjs';
import { mergeUruguay, needsFetch } from '../pipeline/build-uy.mjs';

const cell = (v) => (typeof v === 'number'
  ? `<table:table-cell office:value-type="float" office:value="${v}" calcext:value-type="float"><text:p>${v}</text:p></table:table-cell>`
  : `<table:table-cell office:value-type="string"><text:p>${v}</text:p></table:table-cell>`);
const row = (cells) => `<table:table-row table:style-name="ro1">${cells.map(cell).join('')}</table:table-row>`;
const HEAD = ['Fecha', 'Salto Grande', 'Bonete', 'Baygorria', 'Palmar', 'Eólica', 'Solar', 'Térmica', 'Biomasa', 'Imp.Arg', 'Imp.Br.Riv', 'Imp.Br.Mel', 'Demanda'];
const sheet = (rows) => `<office:spreadsheet><table:table table:name="GPF">${rows.join('')}</table:table><table:table table:name="Eólica">${row(['x', 1])}</table:table></office:spreadsheet>`;

test('Uruguay: month dates and the Montevideo clock', () => {
  const d = monthDates('202602');
  assert.equal(d.from, '01/02/2026');
  assert.equal(d.to, '01/03/2026');
  assert.equal(monthDates('202612').to, '01/01/2027');
  assert.equal(d.days, 28);
  assert.equal(d.startMs, Date.UTC(2026, 1, 1, 3));
});

test('Uruguay: reads the first sheet, sums the hydro and imports, infers exports', () => {
  const xml = sheet([
    row(['Valores aproximados a partir de información del SCADA']),
    row(['Datos generación e intercambios. Resumen']),
    row(HEAD),
    row(['2026-10-01 00', 600, 20, 60, 90, 580, 1, 0, 97, 0, 0, 0, 1450]),
    `<table:table-row><table:table-cell office:value-type="string"><text:p>2026-10-01 01</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="100"/><table:table-cell office:value-type="float" office:value="0" table:number-columns-repeated="6"/><table:table-cell office:value-type="float" office:value="50"/><table:table-cell office:value-type="float" office:value="200"/><table:table-cell office:value-type="float" office:value="100" table:number-columns-repeated="2"/><table:table-cell office:value-type="float" office:value="1000"/></table:table-row>`,
    row(['2026-10-31 23', 500, 0, 0, 0, 900, 0, 300, 100, 0, 0, 0, 1200]),
  ]);
  const rows = firstSheetRows(xml);
  assert.equal(rows.length, 6);
  assert.equal(rows[4].length, 13);
  const p = parseMonth('202610', rows);
  assert.equal(p.startMs, Date.UTC(2026, 9, 1, 3));
  assert.equal(p.length, 31 * 24);
  assert.equal(p.hours, 3);
  assert.deepEqual(Object.keys(p.columns), UY_COLUMNS);
  assert.equal(p.columns.hydro_salto[0], 600);
  assert.equal(p.columns.hydro_negro[0], 170);
  assert.equal(p.columns.wind[0], 580);
  // 600 + 170 + 580 + 1 + 97 = 1448 supply against 1450 demand: no exports.
  assert.equal(p.columns.exports[0], -0);
  assert.equal(p.columns.imports[1], 400);
  assert.equal(p.columns.biomass[1], 50);
  // 100 + 50 + 400 = 550 supply against 1000 demand: still no exports.
  assert.equal(p.columns.exports[1], -0);
  // 500 + 900 + 300 + 100 = 1800 against 1200: 600 MW exported.
  assert.equal(p.columns.exports[743], -600);
  assert.equal(p.columns.thermal[743], 300);
  assert.equal(p.columns.wind[2], null, 'an hour not in the file is missing');
});

test('Uruguay: months stitch onto one hourly grid ending at the last generation', () => {
  const rowsOct = [HEAD, ['2026-10-31 23', 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 2]];
  const rowsNov = [HEAD, ['2026-11-01 00', 2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 4], ['2026-11-01 05', 3, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 6]];
  const m = mergeUruguay([parseMonth('202610', rowsOct), parseMonth('202611', rowsNov)]);
  assert.equal(m.startMs, Date.UTC(2026, 9, 1, 3));
  assert.equal(m.length, 31 * 24 + 6);
  assert.equal(m.columns.wind[31 * 24 - 1], 1);
  assert.equal(m.columns.wind[31 * 24 + 5], 3);
  assert.ok(Number.isNaN(m.columns.wind[31 * 24 + 1]));
});

test('Uruguay: the current month is refetched every run, settled months never', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  const entry = (ms) => ({ version: PARSE_VERSION, fetched: new Date(ms).toISOString() });
  assert.equal(needsFetch(entry(now - 10 * 60000), 0, now), false);
  assert.equal(needsFetch(entry(now - 30 * 60000), 0, now), true);
  assert.equal(needsFetch(entry(now - 2 * 864e5), 2, now), true);
  assert.equal(needsFetch(entry(now - 40 * 864e5), 10, now), false);
  assert.equal(needsFetch(undefined, 50, now), true);
  assert.equal(needsFetch({ version: PARSE_VERSION - 1, fetched: new Date(now).toISOString() }, 10, now), true);
});
