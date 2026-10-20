import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeneration, parsePrices, priceUrl, generationUrl, DK_COLUMNS, PRICE_SWITCH_MS } from '../pipeline/sources/energinet.mjs';
import { mergeDenmark, isStale, monthRange } from '../pipeline/build-dk.mjs';
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
  const at = (ms) => ({ version: 1, fetched: new Date(ms).toISOString() });
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
  assert.deepEqual(monthRange('202412'), [Date.UTC(2024, 11, 1), Date.UTC(2025, 0, 1)]);
});
