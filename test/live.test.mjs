import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extend, prune, recentFrom, lastFilled } from '../pipeline/core/recent.mjs';
import { listFiles, plan, addRows, halfHours, nameTime, FEEDS } from '../pipeline/sources/aemo-recent.mjs';
import { csvRows, nemTime } from '../pipeline/sources/aemo-mms.mjs';
import { nowWindows, windowSlots, agoText } from '../site/js/now-panel.js';

const MIN = 60000;
const DAY = 1440 * MIN;

test('a recent piece only adds slots after the archive ends', () => {
  const base = { startMs: 0, length: 3, columns: { a: Float64Array.from([1, 2, NaN]) } };
  const piece = { startMs: 30 * MIN, length: 4, columns: { a: [9, 9, 4, 5] } };
  const out = extend(base, piece, { stepMinutes: 30, columns: ['a'] });
  assert.equal(out.length, 5);
  assert.deepEqual(Array.from(out.columns.a), [1, 2, NaN, 4, 5]);
  // Nothing new: the archive stays as it is.
  assert.equal(extend(base, { startMs: 0, length: 2, columns: { a: [7, 7] } }, { stepMinutes: 30, columns: ['a'] }), base);
  assert.equal(extend(base, null, { stepMinutes: 30, columns: ['a'] }), base);
  assert.equal(lastFilled(out, ['a']), 5);
});

test('the recent window starts at the archive end, but no further back than the feed keeps', () => {
  assert.equal(recentFrom(10 * DAY, 20 * DAY, 56), 10 * DAY);
  assert.equal(recentFrom(0, 100 * DAY, 56), 44 * DAY);
  const state = { rows: { [DAY]: {}, [3 * DAY]: {} }, files: { a: { t: DAY }, b: { t: 3 * DAY } } };
  prune(state, 2 * DAY);
  assert.deepEqual(Object.keys(state.rows), [String(3 * DAY)]);
  assert.deepEqual(Object.keys(state.files), ['b']);
});

test('reads NEMWEB file names as NEM time', () => {
  assert.equal(nameTime('202610171245'), nemTime('2026/10/17 12:45:00'));
  assert.equal(nameTime('20261017'), nemTime('2026/10/17 00:00:00'));
  const html = '<A HREF="/Reports/Current/Dispatch_SCADA/PUBLIC_DISPATCHSCADA_202610171250_0000000543350206.zip">x</A>'
    + '<A HREF="/Reports/Current/Dispatch_SCADA/PUBLIC_DISPATCHSCADA_202610171245_0000000543349536.zip">x</A><A HREF="/Reports/Current/Dispatch_SCADA/DUPLICATE/">d</A>';
  const files = listFiles(html, FEEDS.scada);
  assert.deepEqual(files.map((f) => f.name), ['PUBLIC_DISPATCHSCADA_202610171245_0000000543349536.zip', 'PUBLIC_DISPATCHSCADA_202610171250_0000000543350206.zip']);
  assert.equal(files[0].url, 'https://nemweb.com.au/Reports/Current/Dispatch_SCADA/PUBLIC_DISPATCHSCADA_202610171245_0000000543349536.zip');
  const rooftop = listFiles('<a href="/Reports/Current/ROOFTOP_PV/ACTUAL/PUBLIC_ROOFTOP_PV_ACTUAL_MEASUREMENT_20261017223000_0000000543425265.zip">r</a><a href="/Reports/Current/ROOFTOP_PV/ACTUAL/PUBLIC_ROOFTOP_PV_ACTUAL_SATELLITE_20261017223000_0000000543425266.zip">s</a>', FEEDS.rooftop);
  assert.equal(rooftop.length, 1);
  assert.equal(rooftop[0].t, nemTime('2026/10/17 22:30:00'));
});

test('plans new files, and daily archives only before the 5-minute feed starts', () => {
  const day = (d) => ({ name: `D${d}`, url: '', t: nemTime(`2026/10/${d} 00:00:00`) });
  const five = (d, hm) => ({ name: `F${d}${hm}`, url: '', t: nemTime(`2026/10/${d} ${hm}:00`) });
  const listings = { scadaDaily: [day(14), day(15), day(16), day(17)], scada: [five(17, '12:45'), five(17, '12:50')] };
  const state = { files: { 'F1712:50': { t: 0 } }, rows: {} };
  const want = plan(listings, state, nemTime('2026/10/15 06:00:00'));
  assert.deepEqual(want.map((f) => f.name), ['F1712:45', 'D15', 'D16', 'D17']);
});

test('turns 5-minute unit output, prices and rooftop solar into half hours', async () => {
  const units = { WF1: { region: 'SA1', type: 'GENERATOR', column: 'wind' }, BAT1: { region: 'SA1', type: 'BIDIRECTIONAL', column: 'battery' } };
  const state = { files: {}, rows: {} };
  const scada = ['I,DISPATCH,UNIT_SCADA,1,SETTLEMENTDATE,DUID,SCADAVALUE'];
  for (let m = 5; m <= 30; m += 5) {
    const t = `"2026/10/18 10:${String(m).padStart(2, '0')}:00"`;
    scada.push(`D,DISPATCH,UNIT_SCADA,1,${t},WF1,${m * 10}`, `D,DISPATCH,UNIT_SCADA,1,${t},BAT1,-20`);
  }
  // The next half hour has only started.
  scada.push('D,DISPATCH,UNIT_SCADA,1,"2026/10/18 10:35:00",WF1,500');
  const rows = async (text) => { const out = []; for await (const r of csvRows(text)) out.push(r); return out; };
  addRows(state, 'scada', await rows(scada.join('\n')), units);
  // The same intervals again, from the daily archive, don't double up.
  addRows(state, 'scadaDaily', await rows(scada.join('\n')), units);
  addRows(state, 'dispatch', await rows(['I,DISPATCH,PRICE,1,SETTLEMENTDATE,REGIONID,INTERVENTION,RRP', 'D,DISPATCH,PRICE,1,"2026/10/18 10:05:00",SA1,0,40', 'D,DISPATCH,PRICE,1,"2026/10/18 10:10:00",SA1,0,60', 'D,DISPATCH,PRICE,1,"2026/10/18 10:10:00",SA1,1,999',
    'I,DISPATCH,REGIONSUM,1,SETTLEMENTDATE,REGIONID,INTERVENTION,TOTALDEMAND', 'D,DISPATCH,REGIONSUM,1,"2026/10/18 10:05:00",SA1,0,1500'].join('\n')), units);
  addRows(state, 'rooftop', await rows(['I,ROOFTOP,ACTUAL,2,INTERVAL_DATETIME,REGIONID,POWER,TYPE', 'D,ROOFTOP,ACTUAL,2,"2026/10/18 10:30:00",SA1,800,MEASUREMENT', 'D,ROOFTOP,ACTUAL,2,"2026/10/18 10:30:00",SA1N,1,MEASUREMENT'].join('\n')), units);
  const piece = halfHours(state, nemTime('2026/10/18 10:00:00'));
  assert.equal(piece.startMs, nemTime('2026/10/18 10:00:00'));
  assert.equal(piece.length, 1);
  const sa = piece.regions.SA1;
  assert.equal(sa.wind[0], 175);
  assert.equal(sa.battery_charge[0], 20);
  assert.equal(sa.battery[0], 0);
  assert.equal(sa.rooftop[0], 800);
  assert.equal(sa.price[0], 50);
  assert.equal(sa.demand[0], 1500);
  assert.equal(piece.regions.NSW1.wind[0], 0);
});

test('live countries get a Live time frame; the others end at the latest data', () => {
  const live = nowWindows({ live: true });
  assert.deepEqual(Object.keys(live), ['live', 'day', 'week', 'year']);
  assert.equal(live.day.span, 'Past 24 hours');
  const late = nowWindows({ live: false });
  assert.deepEqual(Object.keys(late), ['day', 'week', 'month', 'year']);
  assert.equal(late.day.span, 'Latest 24 hours');
  assert.equal(windowSlots(live.live, 15), 1);
  assert.equal(windowSlots(live.day, 15), 96);
  assert.equal(windowSlots(late.year, 30), 48 * 365);
});

test('says how old the data is', () => {
  assert.equal(agoText(0, 20 * MIN), '20 minutes ago');
  assert.equal(agoText(0, 3.4 * 60 * MIN), '3 hours ago');
  assert.equal(agoText(0, 3 * DAY + MIN), '3 days ago');
  assert.equal(agoText(0, 30 * 1000), 'just now');
});
