import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEria, combineAreas, decodeText, csvCells, cellNumber, fiscalYear, joinPieces, lastFilled, areaStats } from '../pipeline/sources/jp-areas.mjs';
import { isStale } from '../pipeline/build-jp.mjs';

const H = 3600000;
// Layouts as the operators publish them (header rows copied from the files).
const TEPCO = `単位[MW平均],,,供給力
DATE,TIME,エリア需要,原子力,火力(LNG),火力(石炭),火力(石油),火力(その他),水力,地熱,バイオマス,太陽光発電実績,太陽光出力制御量,風力発電実績,風力出力制御量,揚水,蓄電池,連系線,その他,合計
2026/9/1,0:00,26392,1290,10333,6201,383,1775,1689,0,540,0,0,76,0,-639,8,4490,246,26392
2026/9/1,0:30,25530,1290,10280,6225,341,1759,1681,0,540,0,0,77,0,-1215,10,4282,261,25531
2026/9/1,1:00,,,,,,,,,,,,,,,,,,
`;
const KYUSHU = `"単位[MW平均]","","","供給力"
"DATE","TIME","エリア需要","原子力","火力（ＬＮＧ）","火力（石炭）","火力（石油）","火力（その他）","水力","地熱","バイオマス","太陽光発電実績","太陽光出力制御量","風力発電実績","風力出力制御量","揚水","蓄電池","連系線","その他","合計"
"20260901","0:30","10070","2930","2758","4692","108","198","270","154","770","2","0","48","0","0","-8","2144","306","10084"
"20260901","1:00","9634","2922","2006","4706","98","198","276","154","770","0","0","44","0","0","2","1856","314","9634"
"20260901","24:00","8036","2958","730","3500","92","104","404","124","818","8","120","2","0","352","6","1304","246","8040"
`;
const SHIKOKU = `単位[MW平均],,,供給力,,,,,,,,,,,,,,,,
DATE,TIME,エリア需要,原子力,火力(LNG),火力(石炭),火力(石油),火力(その他),水力,地熱,バイオマス,太陽光発電実績,太陽光出力制御量,風力発電実績,風力出力制御量,揚水,蓄電池,連系線,その他,合計
2026/9/1,0:00,2774,870,295,2186,0,279,80,,286,0,0,90,0,0,2,-1314,,2774
2026/9/1,0:30,2668,868,300,2146,0,282,84,,290,0,0,82,0,0,0,-1384,,2668
`;

test('Japan: the shared area layout, start-labelled half hours', () => {
  const p = parseEria(TEPCO);
  // 2026-09-01 00:00 JST is 15:00 UTC the day before; the blank third row is the unpublished rest of the month.
  assert.equal(p.startMs, Date.UTC(2026, 7, 31, 15));
  assert.equal(p.length, 2);
  assert.equal(p.columns.demand[0], 26392);
  assert.equal(p.columns.gas[0], 10333);
  assert.equal(p.columns.coal[1], 6225);
  assert.equal(p.columns.thermal_other[0], 1775);
  // Pumped storage is signed: pumping goes to its own negative column.
  assert.equal(p.columns.pumped_storage[0], 0);
  assert.equal(p.columns.pumped_storage_charge[0], -639);
  assert.equal(p.columns.battery[1], 10);
  assert.equal(p.columns.battery_charge[1], 0);
  assert.equal(p.columns.other[0], 246);
  assert.equal(lastFilled(p), 2);
});

test('Japan: Kyushu labels half hours by their end and writes full-width names', () => {
  const p = parseEria(KYUSHU);
  // "0:30" is the half hour from midnight; "24:00" the one from 23:30.
  assert.equal(p.startMs, Date.UTC(2026, 7, 31, 15));
  assert.equal(p.length, 48);
  assert.equal(p.columns.gas[0], 2758);
  assert.equal(p.columns.demand[47], 8036);
  assert.equal(p.columns.solar_curtailed[47], 120);
  assert.equal(p.columns.battery_charge[0], -8);
  assert.ok(Number.isNaN(p.columns.demand[2]));
});

test('Japan: a blank cell in a reported row is a fuel the area lacks, so zero', () => {
  const p = parseEria(SHIKOKU);
  assert.equal(p.columns.geothermal[0], 0);
  assert.equal(p.columns.other[1], 0);
  assert.equal(p.columns.nuclear[1], 868);
});

test('Japan: text, cells and fiscal years', () => {
  const sjis = Uint8Array.from([0x90, 0x85, 0x97, 0xcd]); // 水力 in Shift_JIS
  assert.equal(decodeText(sjis), '水力');
  assert.equal(decodeText(new TextEncoder().encode('﻿水力')), '水力');
  assert.deepEqual(csvCells('"2016/4/1","2,555",3'), ['2016/4/1', '2,555', '3']);
  assert.equal(cellNumber('2,555'), 2555);
  assert.equal(cellNumber('－'), null);
  assert.equal(cellNumber(''), null);
  assert.equal(fiscalYear('202603'), 2025);
  assert.equal(fiscalYear('202604'), 2026);
});

test('Japan: the national sum counts only slots every area reported', () => {
  const t = Date.UTC(2026, 0, 1);
  const f = (...v) => Float64Array.from(v);
  // Area a splits thermal by fuel; area b (an older file) doesn't.
  const a = { startMs: t, length: 3, columns: { demand: f(10, 11, 12), gas: f(5, 5, 5), coal: f(1, 1, 1), oil: f(0, 0, 0), thermal_other: f(1, 1, 1) } };
  const b = { startMs: t + 1800000, length: 3, columns: { demand: f(20, NaN, 22), thermal: f(9, 9, 9) } };
  const n = combineAreas({ a, b }, { names: ['demand', 'gas', 'thermal'] });
  assert.equal(n.startMs, t);
  assert.equal(n.length, 4);
  // Slot 0: only a. Slot 1: both. Slot 2: b missing. Slot 3: only b.
  assert.ok(Number.isNaN(n.columns.demand[0]));
  assert.equal(n.columns.demand[1], 31);
  assert.equal(n.columns.thermal[1], 16);
  // LNG is only national where every area splits it out.
  assert.ok(Number.isNaN(n.columns.gas[1]));
  assert.ok(Number.isNaN(n.columns.gas[2]));
  assert.ok(Number.isNaN(n.columns.demand[3]));
  const both = combineAreas({ a, c: a }, { names: ['gas', 'thermal'] });
  assert.equal(both.columns.gas[0], 10);
  assert.equal(both.columns.thermal[0], 14);
  // No national series until every area has something.
  assert.equal(combineAreas({ a, b: { startMs: NaN, length: 0, columns: {} } }), null);
});

test('Japan: daily files join into a month, and refetch rules', () => {
  const t = Date.UTC(2026, 9, 1);
  const day = (startMs, v) => ({ startMs, length: 2, columns: { demand: Float64Array.from([v, v]) } });
  const j = joinPieces([day(t, 1), day(t + 24 * H, 2)], ['demand']);
  assert.equal(j.length, 50);
  assert.equal(j.columns.demand[48], 2);
  assert.ok(Number.isNaN(j.columns.demand[10]));
  const now = Date.UTC(2026, 9, 20, 12);
  const fresh = { fetched: new Date(now - H).toISOString(), version: 2 };
  assert.equal(isStale(fresh, 0, now), true);
  assert.equal(isStale(fresh, 1, now), false);
  assert.equal(isStale({ ...fresh, fetched: new Date(now - 4 * H).toISOString() }, 1, now), true);
  assert.equal(isStale({ ...fresh, fetched: new Date(now - 30 * H).toISOString() }, 8, now), false);
  assert.equal(isStale({ ...fresh, partial: true, fetched: new Date(now - 30 * H).toISOString() }, 8, now), true);
  assert.equal(isStale({ ...fresh, version: 0 }, 8, now), true);
});

test('Japan: the older hourly files, each operator its own layout', async () => {
  const { parseHourly, csvRows } = await import('../pipeline/sources/jp-areas.mjs');
  const at = (p, c, i = 0) => p.columns[c][i];
  // TEPCO: 万kWh, quoted thousands, the demand name over the date row.
  const tepco = parseHourly(csvRows(`単位[万kWh],,,,,,,,,,,,,,
DATE,TIME,東京エリア需要,供給力,,,,,,,,,,,
,,,原子力,火力,水力,地熱,バイオマス,太陽光発電実績,太陽光出力制御量,風力発電実績,風力出力制御量,揚水,連系線,合計
2016/4/1,0:00,"2,555",0,2258,92,0,2,0,0,2,0,0,201,"2,555"
2016/4/1,1:00,"2,433",0,2151,92,0,2,0,0,2,0,-30,186,"2,433"
`));
  assert.equal(tepco.startMs, Date.UTC(2016, 2, 31, 15));
  assert.equal(tepco.length, 4);
  assert.equal(at(tepco, 'demand'), 25550);
  assert.equal(at(tepco, 'thermal', 1), 22580);
  assert.equal(at(tepco, 'pumped_storage_charge', 2), -300);
  assert.equal(at(tepco, 'demand', 3), 24330);
  // Kansai and Kyushu: 太陽光 and 風力 on the row above 実績 and 抑制量.
  const kansai = parseHourly(csvRows(`,,,,,,,太陽光,太陽光,風力,風力,,
DATE_TIME,エリア需要〔MWh〕,原子力〔MWh〕,火力〔MWh〕,水力〔MWh〕,地熱〔MWh〕,バイオマス〔MWh〕,実績〔MWh〕,抑制量〔MWh〕,実績〔MWh〕,抑制量〔MWh〕,揚水〔MWh〕,連系線〔MWh〕
2023/4/1 6:00,11765,4964,6230,1226,0,80,319,7,15,2,291,-1359
`));
  assert.equal(at(kansai, 'solar'), 319);
  assert.equal(at(kansai, 'solar_curtailed'), 7);
  assert.equal(at(kansai, 'wind'), 15);
  assert.equal(at(kansai, 'wind_curtailed', 1), 2);
  assert.equal(at(kansai, 'nuclear'), 4964);
  // Hokkaido: the date only on each day's first row, hours as 0時.
  const hokkaido = parseHourly(csvRows(`単位[MWh],,,,,,,,,,,,,,
,,,供給力,,,,,,,,,,,
月日,時刻,エリア需要,原子力,火力,水力,地熱,バイオマス,太陽光実績,太陽光抑制量,風力実績,風力抑制量,揚水,連系線,供給力合計
,,,,,,,,,,,,,,
2024/1/1,0時,3811,0,2479,410,16,277,0,0,474,0,0,154,3811
,1時,3917,0,2581,437,17,277,0,0,450,0,0,155,3917
`));
  assert.equal(hokkaido.length, 4);
  assert.equal(at(hokkaido, 'thermal', 2), 2581);
  // Chugoku: dashes for nothing, and plain 需要.
  const chugoku = parseHourly(csvRows(`供給区域の需給実績,,,,,,,,,,,,,
,,需要実績(MWh),供給実績(MWh),,,,,,,,,,
DATE,TIME,需要,原子力,火力,水力,地熱,バイオマス,太陽光(実績),太陽光(抑制量),風力(実績),風力(抑制量),揚水,連系線潮流
2023/4/1,0:00,5000,0,4523,249,0,186,0,－,2,－,129,-88
`));
  assert.equal(at(chugoku, 'demand'), 5000);
  assert.equal(at(chugoku, 'solar_curtailed'), 0);
  assert.equal(at(chugoku, 'pumped_storage'), 129);
  // Hokuriku: a units row under the names, blank geothermal.
  const hokuriku = parseHourly(csvRows(`※例えば、0:00の実績値は、0時00分から1時00分までの1時間平均値を示します,,,,,,,,,,,,,
,,エリア需要,原子力,火力,水力,地熱,バイオマス,太陽光実績,太陽光抑制量,風力実績,風力抑制量,揚水,連系線
DATE,TIME,MWh,MWh,MWh,MWh,MWh,MWh,MWh,MWh,MWh,MWh,MWh,MWh
2024/3/1,0:00,3286,0,1752,807,,63,0,0,15,0,0,650
`));
  assert.equal(at(hokuriku, 'hydro'), 807);
  assert.equal(at(hokuriku, 'geothermal'), 0);
  // Chubu: full-width brackets.
  const chubu = parseHourly(csvRows(`・エリア供給力は、特定できるものは電源種別とし、特定できないものは火力に包含
,,,,,,,,,,,,,単位：MWh
DATE,TIME,エリア需要,原子力,火力,水力,地熱,バイオマス,太陽光（実績）,太陽光（出力制御量）,風力（実績）,風力（出力制御量）,揚水,連系線
2016/09/30,10:00,17700,0,14139,1929,0,0,2742,5,40,0,0,-1150
`));
  assert.equal(at(chubu, 'solar'), 2742);
  assert.equal(at(chubu, 'solar_curtailed'), 5);
});

test('Japan: Shikoku\'s yearly workbooks', async () => {
  const { parseHourly, xlsxRows, excelDate } = await import('../pipeline/sources/jp-areas.mjs');
  assert.equal(excelDate(45017), '2023/4/1');
  const shared = ['DATE', 'TIME', 'エリア需要', '供給力', '原子力', '火力', '水力', '地熱', 'バイオマス', '太陽光', '風力', '揚水', '連系線', '合計', '実績', '制御量', '（単位：万ｋW）', '－']
    .map((t) => `<si><t>${t}</t><rPh sb="0" eb="1"><t>ヨミ</t></rPh></si>`).join('');
  const s = (r, c, i) => `<c r="${c}${r}" t="s"><v>${i}</v></c>`;
  const v = (r, c, x) => `<c r="${c}${r}"><v>${x}</v></c>`;
  const sheet = `<sheetData>
<row r="1">${s(1, 'O', 16)}</row>
<row r="2">${s(2, 'A', 0)}${s(2, 'B', 1)}${s(2, 'C', 2)}${s(2, 'D', 3)}</row>
<row r="3">${s(3, 'D', 4)}${s(3, 'E', 5)}${s(3, 'F', 6)}${s(3, 'G', 7)}${s(3, 'H', 8)}${s(3, 'I', 9)}${s(3, 'K', 10)}${s(3, 'M', 11)}${s(3, 'N', 12)}${s(3, 'O', 13)}</row>
<row r="4">${s(4, 'I', 14)}${s(4, 'J', 15)}${s(4, 'K', 14)}${s(4, 'L', 15)}</row>
<row r="5">${v(5, 'A', 45017)}${v(5, 'B', 0)}${v(5, 'C', 225)}${v(5, 'D', 0)}${v(5, 'E', 166)}${v(5, 'F', 18)}${s(5, 'G', 17)}${v(5, 'H', 13)}${v(5, 'I', 40)}${v(5, 'J', 3)}${v(5, 'K', 2)}${v(5, 'L', 1)}${v(5, 'M', -16)}${v(5, 'N', 12)}${v(5, 'O', 225)}</row>
<row r="6">${v(6, 'A', 45017)}${v(6, 'B', '4.1666666666666664E-2')}${v(6, 'C', 227)}</row>
</sheetData>`;
  const rows = xlsxRows(sheet, `<sst>${shared}</sst>`);
  assert.equal(rows[4][0], '2023/4/1');
  assert.equal(rows[5][1], '1:00');
  const p = parseHourly(rows);
  assert.equal(p.startMs, Date.UTC(2023, 2, 31, 15));
  // 万kW to MW.
  assert.equal(p.columns.demand[0], 2250);
  assert.equal(p.columns.thermal[1], 1660);
  assert.equal(p.columns.geothermal[0], 0);
  assert.equal(p.columns.solar[0], 400);
  assert.equal(p.columns.solar_curtailed[0], 30);
  assert.equal(p.columns.wind_curtailed[0], 10);
  assert.equal(p.columns.pumped_storage_charge[0], -160);
  assert.equal(p.columns.demand[2], 2270);
});

test('Japan: Kansai\'s bare CR line ends, and Hokkaido\'s daily file', () => {
  const kansai = parseEria('単位[MW平均],,,,,,,,,,,,,,,,,,,\rDATE,TIME,エリア需要,原子力,火力（LNG）,火力（石炭）,火力（石油）,火力（その他）,水力,地熱,バイオマス,太陽光発電実績,太陽光出力制御量,風力発電実績,風力出力制御量,揚水,蓄電池,連系線,その他,合計\r\n2026/3/1,0:00,12727,5785,2932,2790,5,422,974,0,374,0,0,101,0,-98,-2,-652,96,12727\r\n');
  assert.equal(kansai.length, 1);
  assert.equal(kansai.columns.gas[0], 2932);
  const daily = parseEria(`2026/10/20 13:42 UPDATE
,,,供給力
年月日,時刻,エリア需要,原子力,火力（LNG）,火力（石炭）,火力（石油）,火力（その他）,水力,地熱,バイオマス,太陽光実績,太陽光抑制量,風力実績,風力抑制量,揚水,蓄電池,連系線,その他,供給力合計
－,－,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW,MW
2026/10/20,0:00～0:30,2517,0,69,1547,48,220,447,11,161,0,0,81,0,31,-7,-90,0,2517
2026/10/20,23:30～24:00,,,,,,,,,,,,,,,,,,
`);
  assert.equal(daily.startMs, Date.UTC(2026, 9, 19, 15));
  assert.equal(daily.length, 1);
  assert.equal(daily.columns.coal[0], 1547);
  assert.equal(daily.columns.wind[0], 81);
  assert.equal(daily.columns.battery_charge[0], -7);
});

test('Japan story: fuel shares, the fossil floor, curtailment and batteries', async () => {
  const { storyFigures } = await import('../site/js/jp/story.js');
  const { JP_COLUMNS } = await import('../pipeline/sources/jp-areas.mjs');
  // Two years and a month of half hours from New Year 2024 in Japan time; the fuel split starts in April 2024.
  const startMs = Date.UTC(2023, 11, 31, 15);
  const length = 48 * (366 + 365 + 30);
  const splitFrom = 48 * 91;
  const columns = Object.fromEntries(JP_COLUMNS.map((c) => [c, new Float64Array(length)]));
  for (let i = 0; i < length; i++) {
    // Slot 0 is midnight in Japan.
    const local = Math.floor((i % 48) / 2);
    const sunny = local >= 10 && local < 15;
    const gas = sunny ? 12000 : 30000;
    const coal = 20000;
    columns.demand[i] = 100000;
    columns.nuclear[i] = 10000;
    columns.solar[i] = sunny ? 40000 : 0;
    columns.solar_curtailed[i] = sunny ? 2000 : 0;
    columns.hydro[i] = 8000;
    columns.thermal[i] = gas + coal;
    columns.gas[i] = i < splitFrom ? NaN : gas;
    columns.coal[i] = i < splitFrom ? NaN : coal;
    columns.oil[i] = i < splitFrom ? NaN : 0;
    columns.thermal_other[i] = i < splitFrom ? NaN : 0;
    columns.battery[i] = local === 19 ? 3000 : 0;
    columns.battery_charge[i] = sunny ? -1000 : 0;
  }
  const f = storyFigures({ startMs, length, stepMinutes: 30, columns }, length);
  assert.deepEqual(f.rows.map((r) => r.year), [2024, 2025, 'past365']);
  const y25 = f.rows.find((r) => r.year === 2025);
  const y24 = f.rows.find((r) => r.year === 2024);
  // 5 sunny hours a day: thermal 32 GW, 50 GW otherwise.
  assert.ok(Math.abs(y25.twh.thermal - 365 * (5 * 32 + 19 * 50) / 1000) < 1e-6);
  assert.ok(Math.abs(y25.twh.curtailed - 365 * 5 * 2 / 1000) < 1e-6);
  assert.ok(Math.abs(y25.curtH1 - 181 * 5 * 2 / 1000) < 1e-6);
  assert.equal(y25.fossilMin, 32);
  assert.equal(y25.gasMin, 12);
  assert.equal(y25.coalMin, 20);
  assert.equal(y25.batteryMax, 3);
  assert.equal(y25.chargeMax, 1);
  assert.equal(y25.hoursUnder[40], 365 * 5);
  assert.ok(Math.abs(y25.byHour.gas[12] - 12) < 1e-9 && Math.abs(y25.byHour.gas[20] - 30) < 1e-9);
  assert.ok(Math.abs(y25.split.coal - (20 * 24) / (20 * 24 + 5 * 12 + 19 * 30)) < 1e-9);
  // At the fossil floor, LNG is down to 12 GW and coal stays at 20 GW.
  assert.ok(Math.abs(y25.floor.gas - 12) < 1e-9 && Math.abs(y25.floor.coal - 20) < 1e-9);
  // While curtailing: 32 GW of fossil running, 12 of it LNG.
  assert.equal(y25.curtailing.hours, 365 * 5);
  assert.equal(y25.curtailing.thermal, 32);
  assert.equal(y25.curtailing.gas, 12);
  // 2024 has its split from April only.
  assert.equal(y24.splitHours, (366 - 91) * 24);
  assert.equal(y24.hours, 366 * 24);
  // LNG's daily swing: 19 hours a day 18 GW above the day's low of 12 GW, 342 GWh;
  // the day's 10 GWh of curtailed solar could have covered 10 of it.
  assert.ok(Math.abs(y25.swingTwh - 365 * 342 / 1000) < 1e-6);
  assert.ok(Math.abs(y25.swingFromCurtailedTwh - 365 * 10 / 1000) < 1e-6);
  assert.equal(y25.swingPeakMedian, 18);
  assert.equal(y25.lowMedian, 12);
  assert.deepEqual(y25.batteries.map((b) => b.days), [0, 0, 0, 0]);
  // Coal above LNG in the five sunny hours.
  assert.equal(y25.coalOverGasHours, 365 * 5);
  assert.ok(Math.abs(y25.fossilPct - (y25.twh.thermal / y25.twh.gen) * 100) < 1e-9);
  assert.ok(f.spells[50] && f.spells[40]);
});

test('areaStats totals an area and averages it while curtailing', () => {
  const startMs = Date.UTC(2025, 0, 1);
  const n = 4;
  const col = (vals) => Float64Array.from(vals);
  const piece = {
    startMs, length: n,
    columns: {
      demand: col([10000, 10000, 10000, NaN]), gas: col([3000, 1000, 2000, 0]), coal: col([4000, 4000, 4000, 0]),
      oil: col([0, 0, 0, 0]), thermal_other: col([1000, 1000, 1000, 0]), nuclear: col([2000, 2000, 2000, 0]),
      solar: col([0, 6000, 3000, 0]), solar_curtailed: col([0, 2000, 0, 0]), wind_curtailed: col([0, 0, 0, 0]),
      pumped_storage_charge: col([0, -1000, 0, 0]),
    },
  };
  const s = areaStats(piece, startMs, startMs + n * 1800000);
  assert.equal(s.hours, 1.5);
  assert.equal(s.curtHours, 0.5);
  assert.ok(Math.abs(s.twh.gas - 6000 * 0.5 / 1e6) < 1e-12);
  assert.ok(Math.abs(s.twh.thermal - (8000 + 6000 + 7000) * 0.5 / 1e6) < 1e-12);
  assert.ok(Math.abs(s.twh.curtailed - 2000 * 0.5 / 1e6) < 1e-12);
  assert.ok(Math.abs(s.twh.pumping - 1000 * 0.5 / 1e6) < 1e-12);
  assert.equal(s.whileCurtailing.thermal, 6);
  assert.equal(s.whileCurtailing.gas, 1);
  assert.equal(s.whileCurtailing.pumping, 1);
  assert.equal(s.thermalMin, 6);
});
