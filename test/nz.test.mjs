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

test('reads the older files, which count trading periods by the clock on daylight saving days', () => {
  // 5 Oct 1997: saving starts, 48 periods with 2am to 3am (TP5, TP6) empty.
  const row = (date, vals) => `ARA,ARA2201,MRPL,aratiatia,Hydro,Hydro,${date},${vals.join(',')}`;
  const start = parseGenerationMonth([header(48), row('1997-10-05', Array.from({ length: 48 }, (_, i) => (i === 4 || i === 5 ? '' : (i + 1) * 500)))].join('\n'));
  assert.equal(start.length, 46);
  assert.deepEqual(start.columns.hydro.slice(3, 6), [4, 7, 8]);
  assert.equal(start.columns.hydro[45], 48);
  // 15 Mar 1998: saving ends, 48 periods; the repeated hour is missing.
  const end = parseGenerationMonth([header(48), row('1998-03-15', Array.from({ length: 48 }, (_, i) => (i + 1) * 500))].join('\n'));
  assert.equal(end.length, 50);
  assert.deepEqual(end.columns.hydro.slice(5, 9), [6, null, null, 7]);
  assert.equal(end.columns.hydro[49], 48);
});

test('leaves periods that no plant reported missing, not zero', () => {
  const row = (fuel, vals) => `ARA,ARA2201,MRPL,aratiatia,${fuel},Hydro,2026-07-01,${vals.join(',')}`;
  const vals = Array.from({ length: 48 }, (_, i) => (i === 10 || i === 11 ? '' : 1000));
  const m = parseGenerationMonth([header(48), row('Hydro', vals), row('Coal', vals.map((v) => (v === '' ? '' : 0)))].join('\n'));
  assert.equal(m.columns.hydro[10], null);
  assert.equal(m.columns.coal[11], null);
  assert.equal(m.columns.coal[12], 0);
  assert.equal(m.columns.hydro[12], 2);
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

test('adds up NZ years in NZ time and works out the renewable share', async () => {
  const { yearlyEnergy, metricSeries } = await import('../site/js/nz/data.js');
  // Two whole NZ years from New Year 2024 (UTC+13), hydro 3 GW and gas 1 GW throughout.
  const startMs = Date.UTC(2024, 0, 1) - 13 * 3600000;
  const length = (366 + 365) * 48 + 48;
  const col = (v) => new Float64Array(length).fill(v);
  const columns = { hydro: col(3000), gas: col(1000), battery: col(50) };
  const data = { columns, length, startMs };
  const rows = yearlyEnergy(data);
  assert.deepEqual(rows.map((r) => r.year), [2024, 2025, 'past365']);
  assert.ok(Math.abs(rows[0].twh.hydro - 3 * 24 * 366 / 1000) < 1e-6);
  assert.ok(Math.abs(rows[1].renewablePct - 75) < 1e-9);
  assert.equal(metricSeries(data, ['gas'], { unit: 'pct' })[0], 25);
});

test('sizes the dry-year need from hydro shortfalls and finds when renewables get cheaper', async () => {
  const { needs, yearCosts, projection, crf } = await import('../site/js/nz/firming.js');
  assert.ok(Math.abs(crf(0.06, 30) - 0.07265) < 1e-4);
  const row = (year, hydro, fossil) => ({ year, twh: { hydro }, fossil, coverage: 1 });
  // Average hydro 23 TWh; the latest year was 1 TWh wet and used 2 TWh of fossil.
  const rows = [row(2001, 21, 6), row(2002, 25, 3), row(2003, 23, 4), { ...row('past365', 24, 2) }];
  const fossil = new Float64Array(1000).fill(0.5);
  const n = needs(rows, fossil, 1000);
  assert.equal(n.normalFossil, 3);
  assert.equal(n.driest.year, 2001);
  assert.equal(n.driest.fossil, 5);
  assert.equal(n.expectedFossil, 3);
  assert.equal(n.peakGw, 0.5);
  // Fuel cost rises with the carbon price; renewables don't.
  const lo = yearCosts(n, 2025, { carbon: 50, surplusValue: 0 });
  const hi = yearCosts(n, 2025, { carbon: 200, surplusValue: 0 });
  assert.ok(hi.keep > lo.keep);
  assert.equal(hi.renewables.wind.cost, lo.renewables.wind.cost);
  // Valuing the spare 2 TWh at $20/MWh takes $40m a year off.
  const sv = yearCosts(n, 2025, { carbon: 50, surplusValue: 20 });
  assert.ok(Math.abs(lo.renewables.wind.cost - sv.renewables.wind.cost - 40) < 1e-6);
  // Imported gas raises the cost of keeping fossil, not of renewables.
  const lng = yearCosts(n, 2025, { carbon: 50, surplusValue: 0, gasPrice: 25 });
  const gasTwh = n.byYear.reduce((s, r) => s + Math.min(r.fossil, n.normalFossil), 0) / n.byYear.length;
  assert.ok(Math.abs(lng.keep - lo.keep - gasTwh * 7.5 * 11) < 1e-6);
  assert.equal(lng.renewables.solar.cost, lo.renewables.solar.cost);
  const p = projection(n, { carbon: 500, surplusValue: 40 });
  assert.equal(p.crossover.geothermal, 2025);
});

test('the lake model only burns fossil fuel when the lakes run dry, and sizes builds to avoid it', async () => {
  const { fleetFromDays, simulate, minimumBuild, dryYearWeather } = await import('../site/js/nz/lakes.js');
  // Two years of 100 GWh demand a day; no geothermal, wind or solar yet.
  const days = Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), total: 100 }));
  const fleet = fleetFromDays(days);
  const n = 731;
  // Inflow covers 90 GWh a day in year one and 110 in year two; wind blows at 50% throughout.
  const inputs = { first: '2000-01-01', days: n, inflowScale: 1, activeGwh: 2000, inflow: Array.from({ length: n }, (_, i) => (i < 366 ? 90 : 110)), wind: new Array(n).fill(0.5), solar: new Array(n).fill(0) };
  const lo = { hydroMinGw: 0, hydroMaxGw: 10, load: { geothermal: 0.9, wind: 0.5, solar: 0.2 } };
  const r = simulate(inputs, fleet, {}, {}, lo);
  // 10 GWh a day short of water: the lakes run dry, then year two refills them.
  assert.ok(r.years.get(2000) > 0);
  assert.equal(r.years.get(2001) ?? 0, 0);
  // Enough wind to cover the 10 GWh a day gap: 10 / (0.5 × 24) GW, less what storage carries.
  const gw = minimumBuild(inputs, fleet, 'wind', {}, 40, lo);
  assert.ok(gw > 0 && gw <= 10 / 12 + 0.01);
  assert.equal(simulate(inputs, fleet, { wind: gw }, {}, lo).short, 0);
  const w = dryYearWeather({ ...inputs, wind: Array.from({ length: n }, (_, i) => (i < 366 ? 0.4 : 0.6)) }, 1);
  assert.deepEqual(w.years, [2000]);
  assert.ok(Math.abs(w.windPct + 20) < 1e-9);
});
