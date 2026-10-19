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

test('new hydro adds water in step with the existing inflows, and the cheapest mix uses what each build saves', async () => {
  const { fleetFromDays, simulate, mixFrontier } = await import('../site/js/nz/lakes.js');
  const { buildCost, ASSUMPTIONS } = await import('../site/js/nz/firming.js');
  const days = Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), total: 100 }));
  const fleet = fleetFromDays(days);
  const n = 731;
  // Inflow covers 90 GWh a day in year one and 110 in year two, so the average is 100.
  const inputs = { first: '2000-01-01', days: n, inflowScale: 1, activeGwh: 2000, inflow: Array.from({ length: n }, (_, i) => (i < 366 ? 90 : 110)), wind: new Array(n).fill(0), solar: new Array(n).fill(0.5) };
  const l = { hydroMinGw: 0, hydroMaxGw: 10, load: { geothermal: 1, wind: 0.5, solar: 0.5, hydro: 0.5 } };
  // 1 GW of hydro at 50% adds 12 GWh a day on average, scaled with the inflows:
  // 10.8 in the dry year, which just covers its 10 GWh gap.
  assert.ok(simulate(inputs, fleet, {}, {}, l).short > 0);
  assert.equal(simulate(inputs, fleet, { hydro: 1 }, {}, l).short, 0);
  // More geothermal or hydro never needs more solar.
  const f = mixFrontier(inputs, fleet, { geothermal: 0.2, hydro: 0.2 }, {}, l);
  assert.equal(f.length, 5 * 3);
  for (const m of f) {
    const more = f.filter((x) => x.geothermal >= m.geothermal && x.hydro >= m.hydro);
    assert.ok(more.every((x) => x.solar <= m.solar + 1e-9));
  }
  // Geothermal and hydro stand in for batteries at the peak; solar doesn't.
  const need = { peakGw: 1.2, expectedFossil: 0 };
  assert.ok(Math.abs(buildCost(need, 2025, { solar: 1 }).batteryGw - (1.2 - ASSUMPTIONS.committedBatteryGw)) < 1e-9);
  assert.ok(Math.abs(buildCost(need, 2025, { geothermal: 0.5 }).batteryGw - (1.2 - ASSUMPTIONS.committedBatteryGw - 0.5 * ASSUMPTIONS.peakCredit.geothermal)) < 1e-9);
});

test('NZ story: the floor, the evening, the batteries and the lakes', async () => {
  const { storyFigures, storageFigures, FLOOR, BATTERIES, THERMAL_COST } = await import('../site/js/nz/story.js');
  // Two whole NZ years from New Year 2024 (UTC+13) plus a month, half hourly.
  const startMs = Date.UTC(2024, 0, 1) - 13 * 3600000;
  const length = (366 + 365 + 31) * 48;
  const cols = ['hydro', 'geothermal', 'wind', 'solar', 'bioenergy', 'gas', 'coal', 'diesel', 'battery'];
  const columns = Object.fromEntries(cols.map((c) => [c, new Float64Array(length)]));
  const hourOf = new Intl.DateTimeFormat('en', { timeZone: 'Pacific/Auckland', hour: 'numeric', hourCycle: 'h23' });
  const in2025 = (i) => startMs + i * 1800000 >= Date.UTC(2025, 0, 1) - 13 * 3600000;
  for (let i = 0; i < length; i++) {
    const hour = Number(hourOf.format(new Date(startMs + i * 1800000)));
    const evening = hour >= 17 && hour < 21;
    // 2024: 400 MW of gas all day and 200 MW of coal on top in the evening.
    // 2025: 100 MW of gas, nothing else.
    columns.gas[i] = in2025(i) ? 100 : 400;
    columns.coal[i] = !in2025(i) && evening ? 200 : 0;
    columns.hydro[i] = 3000;
    columns.wind[i] = hour === 12 ? 900 : 300;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 30, columns }, length);
  const y24 = f.rows.find((r) => r.year === 2024);
  const y25 = f.rows.find((r) => r.year === 2025);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  assert.ok(Math.abs(y24.night - 0.4) < 1e-9 && Math.abs(y24.evening - 0.6) < 1e-9);
  assert.ok(Math.abs(y24.gasTwh - 0.4 * 24 * 366 / 1000) < 1e-6);
  assert.ok(Math.abs(y24.coalTwh - 0.2 * 4 * 366 / 1000) < 1e-6);
  // The evening coal is the only fossil fuel above each day's minimum.
  assert.ok(Math.abs(y24.aboveDayMin - y24.coalTwh) < 1e-6);
  assert.ok(Math.abs(y24.fosHour[18] - 0.6) < 1e-9 && Math.abs(y24.fosHour[3] - 0.4) < 1e-9);
  assert.ok(Math.abs(y24.fosMin - 0.4) < 1e-9);
  // A 2024 day is 0.3 GW above the floor all day and 0.5 GW for four hours: 8 GWh,
  // peak 0.5 GW. The median day, since the clock-change days are an hour short or long.
  const mid = y24.days[Math.floor(y24.days.length / 2)];
  assert.ok(Math.abs(mid.gwh - ((0.4 - FLOOR) * 24 + 0.2 * 4)) < 1e-9);
  assert.ok(Math.abs(mid.peak - 0.5) < 1e-9);
  // 2 GW and 8 GWh just covers a normal day; the 25-hour clock-change day needs more.
  assert.deepEqual(y24.batteries.slice(0, 3).map((b) => b.days), [0, 0, 0]);
  assert.ok(y24.batteries[3].days >= 364);
  assert.equal(y24.fossilDays, 366);
  // 2025 sits on the floor: nothing above it, so even the smallest fleet covers every day.
  assert.ok(Math.abs(y25.aboveDayMin) < 1e-9);
  assert.deepEqual(y25.batteries.map((b) => b.days), BATTERIES.map(() => 365));
  assert.equal(y25.fossilDays, 0);
  // May to August is 123 of 365 days of a flat year.
  assert.ok(Math.abs(y25.winterShare - 123 / 365) < 1e-9);
  // Coal is off from the last 2024 evening onward: a spell longer than a year,
  // three hours longer than the fossil-under-250 MW spell that starts at New Year.
  assert.ok(f.coalSpell.end - f.coalSpell.start > 365 * 48);
  assert.equal((f.coalSpell.end - f.coalSpell.start) - (f.spells[0.25].end - f.spells[0.25].start), 6);
  assert.ok(Math.abs(f.peaks.wind.gw - 0.9) < 1e-9);
  assert.equal(f.peaks.battery, null);

  // The lakes: 2024 held 1,000 GWh, 2025 held 4,000 GWh.
  const days = 366 + 365;
  const lakes = { first: '2024-01-01', days, storage: Array.from({ length: days }, (_, k) => (k < 366 ? 1000 : 4000)) };
  const s = storageFigures({ startMs, length, stepMinutes: 30, columns }, length, lakes, 2024);
  assert.equal(s.from, 2024);
  assert.equal(s.to, 2025);
  assert.ok(Math.abs(s.bands[0].fossil - (0.4 + 0.2 * 4 / 24)) < 1e-9);
  assert.equal(s.bands[1].hours, 0);
  assert.ok(Math.abs(s.bands[3].fossil - 0.1) < 1e-9);
  assert.equal(s.bands[3].hours, 365 * 24);
  assert.equal(storageFigures({ startMs, length, stepMinutes: 30, columns }, length, null), null);
  // Fuel and carbon: gas at $14/GJ, 7.5 GJ/MWh, 0.0531 t/GJ and $39.25/t, plus $5.
  assert.ok(Math.abs(THERMAL_COST.gas - (7.5 * (14 + 0.0531 * 39.25) + 5)) < 1e-9);
  assert.ok(THERMAL_COST.coalFloor > THERMAL_COST.coal && THERMAL_COST.lng > THERMAL_COST.gas);
});
