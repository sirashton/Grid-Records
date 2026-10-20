// Temporary: the shape of ERCOT's fuel mix workbooks.
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readWorkbook } from '../sources/xlsx.mjs';
const UA = { 'user-agent': 'Mozilla/5.0 (grid-records; github.com/sirashton/Grid-Records)' };
await mkdir('/tmp/tx', { recursive: true });
const dl = async (url, file) => { const r = await fetch(url, { headers: UA }); await writeFile(file, Buffer.from(await r.arrayBuffer())); return file; };
await dl('https://www.ercot.com/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip', '/tmp/tx/prev.zip');
console.log(execFileSync('unzip', ['-l', '/tmp/tx/prev.zip']).toString());
execFileSync('unzip', ['-qq', '-o', '/tmp/tx/prev.zip', '-d', '/tmp/tx/prev']);
console.log(execFileSync('find', ['/tmp/tx/prev', '-type', 'f']).toString());
await dl('https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx', '/tmp/tx/2026.xlsx');
const files = execFileSync('find', ['/tmp/tx', '-type', 'f', '-name', '*.xls*']).toString().trim().split('\n').sort();
for (const f of files) {
  console.log('=====', f, execFileSync('file', [f]).toString().trim());
  if (!f.endsWith('.xlsx')) continue;
  const wb = await readWorkbook(f);
  console.log('sheets', wb.map((s) => `${s.name}(${s.rows.length})`).join(' '));
  const s = wb.find((x) => /jan/i.test(x.name)) ?? wb[1] ?? wb[0];
  if (!s) continue;
  for (const r of s.rows.slice(0, 4)) console.log(JSON.stringify(r.slice(0, 8)), '... len', r.length, JSON.stringify(r.slice(-3)));
  const fuels = new Map();
  for (const r of s.rows.slice(1)) { const k = `${r[1]}|${r[2]}`; fuels.set(k, (fuels.get(k) ?? 0) + 1); }
  console.log('fuel|type', JSON.stringify([...fuels]));
  const dates = s.rows.slice(1).map((r) => r[0]).filter((x) => x != null);
  console.log('first/last date', dates[0], dates.at(-1), typeof dates[0]);
}
