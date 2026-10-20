// Temporary: details of ERCOT's fuel mix workbooks.
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readWorkbook } from '../sources/xlsx.mjs';
const UA = { 'user-agent': 'Mozilla/5.0 (grid-records; github.com/sirashton/Grid-Records)' };
await mkdir('/tmp/tx', { recursive: true });
const dl = async (url, file) => { const r = await fetch(url, { headers: UA }); await writeFile(file, Buffer.from(await r.arrayBuffer())); return file; };
await dl('https://www.ercot.com/files/docs/2021/03/10/FuelMixReport_PreviousYears.zip', '/tmp/tx/prev.zip');
execFileSync('unzip', ['-qq', '-o', '/tmp/tx/prev.zip', '-d', '/tmp/tx/prev']);
await dl('https://www.ercot.com/files/docs/2026/02/09/IntGenbyFuel2026.xlsx', '/tmp/tx/2026.xlsx');
await dl('https://www.ercot.com/files/docs/2025/02/07/IntGenbyFuel2025.xlsx', '/tmp/tx/2025.xlsx');
const show = (s, pred, n = 12) => {
  for (const r of s.rows.filter(pred).slice(0, n)) console.log(s.name, JSON.stringify(r.slice(0, 4)), 'cells', r.filter((x) => x != null).length - 4, 'h0-3', r.slice(4, 16).map((x) => (typeof x === 'number' ? Math.round(x) : x)).join(','), '| h17-22', r.slice(4 + 68, 4 + 92).map((x) => (typeof x === 'number' ? Math.round(x) : x)).join(','), '| tail', JSON.stringify(r.slice(96)));
};
for (const f of ['/tmp/tx/2026.xlsx', '/tmp/tx/2025.xlsx', '/tmp/tx/prev/IntGenbyFuel2024.xlsx']) {
  const wb = await readWorkbook(f);
  const by = Object.fromEntries(wb.map((s) => [s.name, s]));
  console.log('=====', f);
  for (const s of wb.slice(0, 4)) for (const r of s.rows.slice(0, 20)) console.log(s.name, JSON.stringify(r).slice(0, 300));
  // A summer day: every fuel's profile.
  show(by.Jul, (r) => r[0] === by.Jul.rows[1 + 10 * 10]?.[0], 12);
  // Clock changes: March and November.
  for (const m of ['Mar', 'Nov']) {
    const s = by[m]; if (!s) continue;
    const lens = new Map();
    for (const r of s.rows.slice(1)) { const k = r[0]; const c = r.filter((x) => x != null).length - 4; if (c !== 96) lens.set(k, c); }
    console.log(m, 'days with other than 96 cells', JSON.stringify([...lens]));
    const odd = [...lens.keys()][0];
    if (odd != null) show(s, (r) => r[0] === odd && r[1] === 'Coal', 2);
  }
  const last = by.Sep?.rows.at(-1); console.log('Sep last row', JSON.stringify(last?.slice(0, 6)));
  const oct = by.Oct?.rows.slice(0, 3); console.log('Oct rows', JSON.stringify(oct));
}
