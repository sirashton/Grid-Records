import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenerationMonth, nzMidnight, fuelColumn, PARSE_VERSION } from '../pipeline/sources/emi-generation.mjs';
import { monthList, isStale } from '../pipeline/build-nz.mjs';

const tps = (n, v) => Array.from({ length: n }, () => v).join(',');
const header = (n) => `Site_Code,POC_Code,Nwk_Code,Gen_Code,Fuel_Code,Tech_Code,Trading_date,${Array.from({ length: n }, (_, i) => `TP${i + 1}`).join(',')}`;

test('finds midnight NZ time in UTC, in summer and winter', () => {
  assert.equal(nzMidnight('2026-07-01'), Date.UTC(2026, 5, 30, 12));
  assert.equal(nzMidnight('2026-01-15'), Date.UTC(2026, 0, 14, 11));
});

test('sums plants by fuel and converts kWh per half hour to MW', () => {
  const csv = [
    header(48),
    `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-07-01,${tps(48, 40000)}`,
    `OHA,OHA2201,MRPL,ohaaki,Hydro,Hydro,2026-07-01,${tps(48, 10000)}`,
    `HLY,HLY2201,GENE,huntly_main,Coal,Thrml,2026-07-01,${tps(48, 125000)}`,
    `WKM,WKM2201,CTCT,wairakei,Geo,Geo,2026-07-01,${tps(48, 50)}`,
    `RUA,BRB0331,MERI,ruakaka_bess,Electrical energy,Batt,2026-07-01,${tps(48, 1000)}`,
  ].join('\n');
  const m = parseGenerationMonth(csv);
  assert.equal(m.startMs, Date.UTC(2026, 5, 30, 12));
  assert.equal(m.length, 48);
  assert.equal(m.columns.hydro[0], 100);
  assert.equal(m.columns.coal[47], 250);
  assert.equal(m.columns.geothermal[0], 0.1);
  assert.equal(m.columns.battery[0], 2);
  assert.equal(m.columns.wind[0], 0);
});

test('handles the 46 and 50 period days at daylight saving changes', () => {
  // Saving starts on 27 Sept 2026 (46 periods) and ends on 5 April 2026 (50).
  const start = parseGenerationMonth([header(50), `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-09-26,${tps(48, 1000)}`,
    `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-09-27,${tps(46, 2000)},,`,
    `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-09-28,${tps(48, 3000)},,`].join('\n'));
  assert.equal(start.length, 48 + 46 + 48);
  assert.equal(start.columns.hydro[48 + 45], 4);
  assert.equal(start.columns.hydro[48 + 46], 6);
  const end = parseGenerationMonth([header(50), `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-04-05,${tps(50, 1000)}`].join('\n'));
  assert.equal(end.length, 50);
  assert.equal(end.columns.hydro[49], 2);
});

test('leaves days with no rows missing', () => {
  const m = parseGenerationMonth([header(48), `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-07-01,${tps(48, 1000)}`,
    `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,2026-07-03,${tps(48, 1000)}`].join('\n'));
  assert.equal(m.length, 144);
  assert.equal(m.columns.hydro[60], null);
  assert.equal(m.columns.hydro[100], 2);
});

test('maps EMI fuel codes to columns', () => {
  assert.deepEqual(['Hydro', 'HYD', 'Geo', 'GEO', 'Wind', 'WIN', 'Solar', 'SOL', 'Gas', 'Gas&Oil', 'Coal', 'Coal/Gas', 'Wood', 'Diesel', 'Electrical energy (batteries)', 'ELE', '??']
    .map(fuelColumn), ['hydro', 'hydro', 'geothermal', 'geothermal', 'wind', 'wind', 'solar', 'solar', 'gas', 'gas', 'coal', 'coal', 'bioenergy', 'diesel', 'battery', 'battery', 'other']);
});

test('lists months newest first and refreshes only recent ones', () => {
  assert.deepEqual(monthList('2025-11', Date.UTC(2026, 1, 10)), ['202602', '202601', '202512', '202511']);
  const now = Date.UTC(2026, 9, 17);
  const old = { fetched: new Date(now - 3 * 864e5).toISOString(), version: PARSE_VERSION };
  assert.equal(isStale(old, 0, now), true);
  assert.equal(isStale(old, 10, now), false);
  assert.equal(isStale({ ...old, missing: true }, 10, now), false);
  assert.equal(isStale(null, 10, now), true);
  assert.equal(isStale({ ...old, version: 1 }, 10, now), true);
});
