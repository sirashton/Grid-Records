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

test('Uruguay: story figures count thermal by year, month, hour and trade', async () => {
  const { storyFigures } = await import('../site/js/uy/story.js');
  // Two years and a month of hours from New Year 2024, Uruguay time (UTC-3).
  const startMs = Date.UTC(2024, 0, 1, 3);
  const length = 24 * (366 + 365 + 31);
  const columns = Object.fromEntries(UY_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    const t = new Date(startMs + i * 3600000 - 3 * 3600000);
    const y = t.getUTCFullYear();
    const evening = t.getUTCHours() >= 18 && t.getUTCHours() < 22;
    // 2024 is wet: thermal is off and 500 MW is exported. 2025 is dry:
    // thermal runs 200 MW, 600 MW in the evening, and 100 MW is imported.
    columns.hydro_salto[i] = y === 2024 ? 1500 : 600;
    columns.wind[i] = 500;
    columns.thermal[i] = y === 2024 ? 0 : evening ? 600 : 200;
    columns.imports[i] = y === 2024 ? 0 : 100;
    columns.demand[i] = y === 2024 ? 1500 : 1400 + (evening ? 400 : 0);
    columns.exports[i] = -Math.max(0, columns.hydro_salto[i] + columns.wind[i] + columns.thermal[i] + columns.imports[i] - columns.demand[i]);
  }
  const f = storyFigures({ startMs, length, stepMinutes: 60, columns }, length);
  assert.equal(f.rows.map((r) => r.year).join(), '2024,2025,past365');
  const [y24, y25] = f.rows;
  assert.equal(y24.off, 366 * 24);
  assert.equal(y24.offShare, 1);
  assert.equal(y25.off, 0);
  assert.equal(y25.high[0], 365 * 24);
  assert.equal(y25.high[1], 365 * 4);
  assert.ok(Math.abs(y25.thermalHour[19] - 0.6) < 1e-9);
  assert.ok(Math.abs(y25.thermalHour[3] - 0.2) < 1e-9);
  // 2025 generates 1,300 MW plus imports of 100 against demand of 1,400, so it
  // never exports; all its thermal runs while importing.
  assert.equal(y25.twh.thermalExported, 0);
  assert.ok(Math.abs(y25.twh.thermalImporting - y25.twh.thermal) < 1e-9);
  assert.ok(Math.abs(y24.twh.exports - 0.5 * 366 * 24 / 1000) < 1e-9);
  assert.ok(Math.abs(y25.demMax - 1.8) < 1e-9);
  assert.equal(f.months.length, 25);
  assert.equal(f.months[0].thermal, 0);
  assert.equal(f.offSpell.end - f.offSpell.start, 366 * 24);
  assert.equal(f.on05Spell.end - f.on05Spell.start, 4);
});
