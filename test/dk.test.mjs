import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneration, parsePrices, priceUrl, generationUrl, retryAfter, DK_COLUMNS, PRICE_SWITCH_MS, PARSE_VERSION } from '../pipeline/sources/energinet.mjs';
import { mergeDenmark, isStale, chunkRange, chunkList } from '../pipeline/build-dk.mjs';
import { checkDataset } from '../pipeline/core/dataset.mjs';

const rec = (time, area, v = {}) => ({
  TimeUTC: time, PriceArea: area, GrossCon: 3000, OnshoreWindPower: 1000, OffshoreWindPower: 500,
  SolarPower: 0, HydroPower: null, Biomass: 300, Biogas: 50, Waste: 100, FossilGas: 80, FossilOil: 5, FossilHardCoal: 200,
  ExchangeGreatBelt: area === 'DK1' ? -600 : 590, ExchangeGermany: -400, ExchangeSweden: 300, ExchangeNorway: area === 'DK1' ? 900 : null,
  ExchangeNetherlands: null, ExchangeGreatBritain: null, ...v,
});

test('Denmark: DK1 and DK2 add up to one hourly grid, Great Belt left out', () => {
  const t = Date.UTC(2026, 0, 1);
  const records = [
    rec('2026-01-01T00:00:00', 'DK1'), rec('2026-01-01T00:00:00', 'DK2'),
    rec('2026-01-01T01:00:00', 'DK1', { ExchangeNorway: 2000 }), rec('2026-01-01T01:00:00', 'DK2'),
    // Hour 2 has only DK1, so it is missing, not half of Denmark.
    rec('2026-01-01T02:00:00', 'DK1'),
    // Germany's own zone is ignored.
    rec('2026-01-01T00:00:00', 'DE', { FossilHardCoal: 99999 }),
  ];
  const p = parseGeneration(records, t, t + 4 * 3600000);
  assert.equal(p.length, 4);
  assert.deepEqual(Object.keys(p.columns).sort(), [...DK_COLUMNS].sort());
  assert.equal(p.columns.coal[0], 400);
  assert.equal(p.columns.biomass[0], 700);
  assert.equal(p.columns.hydro[0], 0);
  assert.equal(p.columns.demand[0], 6000);
  // Net: Germany -800, Sweden +600, Norway +900 = +700 into Denmark.
  assert.equal(p.columns.net_no[0], 900);
  assert.equal(p.columns.net_de[0], -800);
  assert.equal(p.columns.imports[0], 700);
  assert.equal(p.columns.exports[0], 0);
  assert.equal(p.columns.imports[1], 1800);
  assert.equal(p.columns.coal[2], null);
  assert.equal(p.columns.coal[3], null);
});

test('Denmark: quarter-hour records add up to the hour', () => {
  const t = Date.UTC(2026, 10, 1);
  const records = [];
  for (const area of ['DK1', 'DK2']) {
    for (const m of ['00', '15', '30', '45']) records.push(rec(`2026-11-01T00:${m}:00`, area, { FossilHardCoal: 50, ExchangeGermany: -100, ExchangeSweden: 0 }));
    for (const m of ['00', '15']) records.push(rec(`2026-11-01T01:${m}:00`, area));
  }
  const p = parseGeneration(records, t, t + 2 * 3600000);
  assert.equal(p.columns.coal[0], 400);
  // Norway 4 x 900 into DK1, Germany 8 x -100: 2,800 MW in.
  assert.equal(p.columns.imports[0], 2800);
  // Half an hour only: left out.
  assert.equal(p.columns.coal[1], null);
});

test('Denmark: prices average the two zones and the quarter hours', () => {
  const t = Date.UTC(2026, 0, 1);
  const p = parsePrices([
    { TimeUTC: '2026-01-01T00:00:00', PriceArea: 'DK1', DayAheadPriceEUR: 40 },
    { TimeUTC: '2026-01-01T00:15:00', PriceArea: 'DK1', DayAheadPriceEUR: 60 },
    { TimeUTC: '2026-01-01T00:00:00', PriceArea: 'DK2', DayAheadPriceEUR: 100 },
    { HourUTC: '2026-01-01T01:00:00', PriceArea: 'DK1', SpotPriceEUR: 10 },
    { TimeUTC: '2026-01-01T00:00:00', PriceArea: 'DE', DayAheadPriceEUR: 1000 },
  ], t, t + 3 * 3600000);
  assert.deepEqual(p.columns.price, [66.67, 10, null]);
  assert.match(priceUrl(Date.UTC(2025, 0, 1), Date.UTC(2025, 1, 1)), /Elspotprices\?start=2025-01-01T00:00&end=2025-02-01T00:00&timezone=UTC/);
  assert.match(priceUrl(PRICE_SWITCH_MS, PRICE_SWITCH_MS + 864e5), /DayAheadPrices/);
  assert.match(generationUrl(t, t + 864e5), /GenerationProdTypeExchange\?start=2026-01-01T00:00&end=2026-01-02T00:00&timezone=UTC&filter=.*DK1.*&limit=0/);
});

test('Denmark: merge trims to the generation and passes the dataset checks', () => {
  const t = Date.UTC(2026, 0, 1);
  const gen = parseGeneration([rec('2026-01-01T01:00:00', 'DK1'), rec('2026-01-01T01:00:00', 'DK2')], t, t + 3 * 3600000);
  const prices = parsePrices([0, 1, 2, 3].map((h) => ({ TimeUTC: `2026-01-01T0${h}:00:00`, PriceArea: 'DK1', DayAheadPriceEUR: 50 + h })), t - 3600000, t + 5 * 3600000);
  const m = mergeDenmark([gen], [prices]);
  assert.equal(m.startMs, t + 3600000);
  assert.equal(m.length, 1);
  assert.equal(m.columns.price[0], 51);
  assert.deepEqual(checkDataset({ region: 'dk', timeZone: 'Europe/Copenhagen', stepMinutes: 60, ...m }), []);
  assert.equal(mergeDenmark([], [prices]), null);
});

test('Denmark: which months are fetched again', () => {
  const now = Date.UTC(2026, 9, 20, 12);
  const at = (ms) => ({ version: PARSE_VERSION, fetched: new Date(ms).toISOString() });
  assert.ok(isStale(null, '202610', 0, now));
  assert.ok(isStale(at(now - 30 * 60000), '202610', 0, now));
  assert.ok(!isStale(at(now - 10 * 60000), '202610', 0, now));
  assert.ok(!isStale(at(now - 3600000), '202609', 1, now));
  assert.ok(isStale(at(now - 2 * 864e5), '202608', 2, now));
  // Not final until June 2027: weekly.
  assert.ok(!isStale(at(now - 3 * 864e5), '202601', 9, now));
  assert.ok(isStale(at(now - 8 * 864e5), '202601', 9, now));
  // Fetched after 2024's Final version came out: never again.
  assert.ok(!isStale(at(Date.UTC(2025, 6, 1)), '202403', 30, now));
  assert.ok(isStale(at(Date.UTC(2025, 4, 1)), '202403', 30, now));
  assert.ok(isStale(at(now), '2025', 12, now) === false);
  assert.ok(isStale({ ...at(now), version: PARSE_VERSION - 1 }, '2015', 20, now));
});

test('Denmark: chunks are Danish years and this year\'s months, newest first', () => {
  const h = 3600000;
  assert.deepEqual(chunkRange('2024'), [Date.UTC(2024, 0, 1) - h, Date.UTC(2025, 0, 1) - h]);
  assert.deepEqual(chunkRange('202603'), [Date.UTC(2026, 2, 1) - h, Date.UTC(2026, 3, 1) - h]);
  const list = chunkList(2015, Date.UTC(2026, 9, 20, 12));
  assert.deepEqual(list.slice(0, 3), ['202610', '202609', '202608']);
  assert.equal(list[9], '202601');
  assert.equal(list[10], '2025');
  assert.equal(list.at(-1), '2015');
  // Chunks meet with no gap: the end of 2025 is the start of January 2026.
  assert.equal(chunkRange('2025')[1], chunkRange('202601')[0]);
  // At 23:30 UTC on New Year's Eve it is already the new year in Denmark.
  assert.deepEqual(chunkList(2025, Date.UTC(2025, 11, 31, 23, 30)), ['202601', '2025']);
  assert.equal(retryAfter('{"error":"Rate limit is exceeded. Try again in 23 seconds."}'), 23);
  assert.equal(retryAfter('', '7'), 7);
  assert.equal(retryAfter('nope', null), null);
});

test('Denmark story: winter fossil, wind bands, imports by border', async () => {
  const { storyFigures, WIND_BANDS } = await import('../site/js/dk/story.js');
  const cols = [...DK_COLUMNS, 'price'];
  // Two whole Danish years (2024, 2025) and a month, hourly.
  const startMs = Date.UTC(2023, 11, 31, 23);
  const length = 24 * (366 + 365 + 31);
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const monthOf = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Copenhagen', month: 'numeric' });
  for (let i = 0; i < length; i++) {
    const m = Number(monthOf.format(new Date(startMs + i * 3600000)));
    const winter = m >= 11 || m <= 3;
    const windy = i % 2 === 0;
    // Coal 300 MW in winter, none in summer; gas 100 MW always.
    columns.coal[i] = winter ? 300 : 0;
    columns.gas[i] = 100;
    columns.wind_onshore[i] = windy ? 6000 : 500;
    columns.demand[i] = 4000;
    columns.net_no[i] = windy ? -1000 : 1500;
    columns.net_de[i] = windy ? -2000 : 0;
    const net = columns.net_no[i] + columns.net_de[i];
    columns.imports[i] = Math.max(0, net);
    columns.exports[i] = Math.min(0, net);
    columns.price[i] = windy ? -5 : 80;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 60, columns }, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const y = f.rows[1];
  assert.equal(y.hours, 8760);
  assert.ok(Math.abs(y.twh.gas - 0.876) < 1e-9);
  assert.ok(Math.abs(y.fosMin - 0.1) < 1e-9);
  assert.ok(Math.abs(y.fosMinWinter - 0.4) < 1e-9);
  // All coal is in winter; gas is spread evenly.
  // 151 days, less the hour lost to summer time in March.
  const winterH = (31 + 28 + 31 + 30 + 31) * 24 - 1;
  const want = (0.4 * winterH) / (0.4 * winterH + 0.1 * (8760 - winterH));
  assert.ok(Math.abs(y.winterShare - want) < 0.003);
  // Calm hours (0.5 GW) in the first band, windy ones (6 GW) in the top band, with the same fossil.
  assert.equal(y.windHours[0], 4380);
  assert.equal(y.windHours[WIND_BANDS.length - 1], 4380);
  assert.ok(Math.abs(y.windFos[0] - y.windFos.at(-1)) < 1e-3);
  assert.ok(Math.abs(y.impBy.net_no - (1.5 * 4380) / 1000) < 1e-9);
  assert.ok(Math.abs(y.expBy.net_de - (2 * 4380) / 1000) < 1e-9);
  assert.equal(y.impHours, 4380);
  assert.ok(Math.abs(y.calm.imports - 1.5) < 1e-9);
  // Wind beat demand in the windy hours, which were also the export hours.
  assert.equal(y.windyHours, 4380);
  assert.ok(Math.abs(y.fosExportingShare - 0.5) < 0.01);
  // Fossil is under 0.2 GW only in the coal-free months.
  assert.equal(y.fosLow, 8760 - winterH);
  assert.equal(y.coalOn, winterH);
  assert.ok(f.coalOffSpell);
});
