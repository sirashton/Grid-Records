import { test } from 'node:test';
import assert from 'node:assert/strict';
import { facilityFuel, waToUtc, parseListing, parseScada, parseSeries, DATASETS } from '../pipeline/sources/aemo-wa.mjs';
import { mergeWa } from '../pipeline/build-wa.mjs';

const HALF = 1800000;

test('maps WA facility codes to fuels', () => {
  assert.equal(facilityFuel('COLLIE_G1'), 'coal');
  assert.equal(facilityFuel('BW2_BLUEWATERS_G1'), 'coal');
  assert.equal(facilityFuel('NEWGEN_KWINANA_CCG1'), 'gas');
  assert.equal(facilityFuel('PINJAR_GT11'), 'gas');
  assert.equal(facilityFuel('WEST_KALGOORLIE_GT2'), 'oil');
  assert.equal(facilityFuel('YANDIN_WF1'), 'wind');
  assert.equal(facilityFuel('ALINTA_WWF'), 'wind');
  assert.equal(facilityFuel('MERSOLAR_PV1'), 'solar_utility');
  assert.equal(facilityFuel('BOONANARRING_PV_ESR'), 'solar_utility');
  assert.equal(facilityFuel('COLLIE_BESS2'), 'battery');
  assert.equal(facilityFuel('KWINANA_ESR2'), 'battery');
  assert.equal(facilityFuel('TAMALA_PARK'), 'biomass');
  assert.equal(facilityFuel('ALCOA_KW_IL'), '');
  assert.equal(facilityFuel('ENELX_DSP_R0002'), '');
  assert.equal(facilityFuel('MYSTERY'), null);
});

test('reads WA market time (UTC+8) in both date styles', () => {
  assert.equal(waToUtc('2006-09-20 00:00:00'), Date.UTC(2006, 8, 19, 16));
  assert.equal(waToUtc('"19/10/2026 07:55:00"'), Date.UTC(2026, 9, 18, 23, 55));
});

test('parses the IIS directory listing', () => {
  const html = '<br> 4/23/2015 11:09 AM      1684350 <A HREF="/public/public-data/datafiles/facility-scada/facility-scada-2006-09.csv">facility-scada-2006-09.csv</A><br>'
    + ' 9/2/2026  8:30 AM     30821507 <A HREF="/public/public-data/datafiles/facility-scada/temp.txt">temp.txt</A>';
  const [f, ...rest] = parseListing(html, DATASETS.scadaOld);
  assert.equal(rest.length, 0);
  assert.equal(f.year, 2006);
  assert.equal(f.month, 9);
  assert.equal(f.size, 1684350);
  assert.equal(f.url, 'https://data.wa.aemo.com.au/public/public-data/datafiles/facility-scada/facility-scada-2006-09.csv');
});

test('half-hourly facility energy becomes MW by fuel', () => {
  const csv = [
    'Trading Date,Interval Number,Trading Interval,Participant Code,Facility Code,Energy Generated (MWh),EOI Quantity (MW),Extracted At',
    '"2006-09-19",33,2006-09-20 00:00:00,"X","COLLIE_G1",150,,"2015-03-30 14:00:00"',
    '"2006-09-19",33,2006-09-20 00:00:00,"X","MUJA_G5",50,,',
    '"2006-09-19",33,2006-09-20 00:00:00,"X","PINJAR_GT1",-0.5,,',
    '"2006-09-19",33,2006-09-20 00:00:00,"X","ALCOA_KW_IL",99,,',
    '"2006-09-19",34,2006-09-20 00:30:00,"X","COLLIE_G1",100,,',
  ].join('\r\n');
  const p = parseScada(csv, { fiveMinute: false });
  assert.equal(p.startMs, Date.UTC(2006, 8, 19, 16));
  assert.equal(p.length, 2);
  assert.deepEqual(p.columns.coal, [400, 200]);
  assert.deepEqual(p.columns.gas, [0, 0], 'own use is floored at zero');
  assert.deepEqual(p.unknown, []);
});

test('5-minute energy is averaged per half hour, with storage split by sign', () => {
  const rows = ['Dispatch Interval,Facility Code,Average MWh,Extracted At'];
  for (let m = 0; m < 30; m += 5) {
    const t = `01/10/2023 08:${String(m).padStart(2, '0')}:00`;
    rows.push(`"${t}","YANDIN_WF1",${m < 15 ? 10 : 20},`);
    rows.push(`"${t}","KWINANA_ESR1",${m < 15 ? 5 : -5},`);
    rows.push(`"${t}","NEW_THING",1,`);
  }
  const p = parseScada(rows.join('\n'), { fiveMinute: true });
  assert.equal(p.startMs, Date.UTC(2023, 9, 1, 0));
  assert.deepEqual(p.columns.wind, [180]);
  assert.deepEqual(p.columns.battery, [30]);
  assert.deepEqual(p.columns.battery_charge, [-30]);
  assert.deepEqual(p.columns.other, [12]);
  assert.deepEqual(p.unknown, ['NEW_THING']);
});

test('rooftop and demand series in both formats', () => {
  const old = parseSeries('Trading Date,Interval Number,Trading Interval,Estimated DPV Generation (MW),Extracted At\n"2020-11-03",45,2020-11-04 06:00:00,48.7,"x"\n"2020-11-03",46,2020-11-04 06:30:00,50,', 'solar_rooftop');
  assert.deepEqual(old.columns.solar_rooftop, [48.7, 50]);
  const rows = ['Timestamp,Estimated DPV Generation(MW),Extracted At'];
  for (let m = 25; m >= 0; m -= 5) rows.push(`"19/10/2026 07:${String(m).padStart(2, '0')}:00",${m},`);
  const fresh = parseSeries(rows.join('\n'), 'solar_rooftop');
  assert.deepEqual(fresh.columns.solar_rooftop, [12.5]);
  const drows = ['Dispatch Interval,Operational Demand,Unscheduled Operational Demand,Operational Withdrawal,Extracted At'];
  for (let m = 55; m >= 30; m -= 5) drows.push(`"19/10/2026 07:${m}:00",${m < 45 ? 1800 : 1822},1790,-15.91,`);
  drows.push('"19/10/2026 07:25:00",1700,1690,-1,');
  const dem = parseSeries(drows.join('\n'), 'demand');
  assert.equal(dem.length, 2);
  assert.equal(dem.columns.demand[0], null, 'one reading of six is too few');
  assert.equal(dem.columns.demand[1], 1811);
});

test('merging puts every dataset on the facility grid', () => {
  const t0 = Date.UTC(2020, 0, 1);
  const gen = (startMs, n, v) => ({ kind: 'scadaOld', startMs, length: n, columns: { coal: Array(n).fill(v) } });
  const merged = mergeWa([
    gen(t0, 4, 100),
    { kind: 'scada', startMs: t0 + 2 * HALF, length: 3, columns: { coal: [7, 7, 7] } },
    { kind: 'rooftopOld', startMs: t0 + HALF, length: 2, columns: { solar_rooftop: [1, 1] } },
    { kind: 'rooftop', startMs: t0 + 2 * HALF, length: 1, columns: { solar_rooftop: [2] } },
    { kind: 'demand', startMs: t0 - HALF, length: 10, columns: { demand: Array(10).fill(5) } },
  ]);
  assert.equal(merged.startMs, t0);
  assert.equal(merged.length, 5);
  assert.deepEqual([...merged.columns.coal], [100, 100, 7, 7, 7]);
  assert.deepEqual([...merged.columns.solar_rooftop].map((v) => (Number.isNaN(v) ? null : v)), [null, 1, 2, null, null]);
  assert.deepEqual([...merged.columns.demand], [5, 5, 5, 5, 5]);
});
