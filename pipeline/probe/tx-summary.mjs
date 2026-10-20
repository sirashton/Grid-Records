// node explore.mjs <data dir>
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const R = new URL('../../site/js', import.meta.url).href;
const { decode } = await import(`${R}/core/dataset.js`);
const dir = process.argv[2];
const meta = JSON.parse(readFileSync(`${dir}/meta.json`));
const raw = gunzipSync(readFileSync(`${dir}/series.bin.gz`));
const cols = decode(new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), meta);
const N = meta.length, step = meta.stepMinutes;
console.log('years', meta.years, 'start', new Date(meta.startMs).toISOString(), 'end', new Date(meta.startMs + N * step * 60000).toISOString(), 'reportsEnd', new Date(meta.reportsEnd).toISOString());
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'numeric', hour: 'numeric', hourCycle: 'h23' });
const Y = {};
for (let i = 0; i < N; i += 1) {
  const t = meta.startMs + i * step * 60000;
  if (i % 4 === 0 || !Y.last) { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); Y.last = p; }
  const p = Y.last;
  const y = p.year; const h = Number(p.hour); const m = Number(p.month);
  const r = (Y[y] ??= { n: 0, miss: 0, twh: {}, hour: {}, hourN: Array(24).fill(0), fosMin: 1e9, fosMinAt: 0, fosMax: 0, othMax: 0, othMaxAt: 0, solMax: 0, under: { 30: 0, 25: 0, 20: 0, 15: 0 }, coalMin: 1e9, gasMin: 1e9, month: Array(12).fill(0) });
  if (Number.isNaN(cols.gas[i])) { r.miss++; continue; }
  r.n++;
  for (const c of meta.columns) { const v = cols[c][i]; if (!Number.isNaN(v)) { r.twh[c] = (r.twh[c] ?? 0) + v / 4e6; (r.hour[c] ??= Array(24).fill(0))[h] += v; } }
  r.hourN[h]++;
  const fos = cols.gas[i] + cols.coal[i];
  r.month[m - 1] += fos / 4e6;
  if (fos < r.fosMin) { r.fosMin = fos; r.fosMinAt = t; }
  if (fos > r.fosMax) r.fosMax = fos;
  if (cols.other[i] > r.othMax) { r.othMax = cols.other[i]; r.othMaxAt = t; }
  if (cols.solar[i] > r.solMax) r.solMax = cols.solar[i];
  if (cols.coal[i] < r.coalMin) r.coalMin = cols.coal[i];
  if (cols.gas[i] < r.gasMin) r.gasMin = cols.gas[i];
  for (const k of Object.keys(r.under)) if (fos < k * 1000) r.under[k] += 0.25;
}
delete Y.last;
const f1 = (v) => v.toFixed(1);
for (const [y, r] of Object.entries(Y)) {
  const tot = Object.values(r.twh).reduce((a, b) => a + b, 0);
  console.log(y, 'n', r.n, 'miss', r.miss, Object.entries(r.twh).map(([k, v]) => `${k}:${f1(v)}`).join(' '), 'tot', f1(tot), 'fos%', f1((r.twh.gas + r.twh.coal) / tot * 100),
    'fosMin', f1(r.fosMin / 1000), new Date(r.fosMinAt).toISOString().slice(0, 16), 'fosMax', f1(r.fosMax / 1000), 'gasMin', f1(r.gasMin / 1000), 'coalMin', f1(r.coalMin / 1000), 'othMax', f1(r.othMax / 1000), new Date(r.othMaxAt).toISOString().slice(0, 16), 'solMax', f1(r.solMax / 1000), 'under', JSON.stringify(r.under));
  const hr = (c) => r.hour[c] ? r.hour[c].map((v, k) => (v / r.hourN[k] / 1000).toFixed(1)).join(' ') : '';
  console.log('  gas  ', hr('gas'));
  console.log('  coal ', hr('coal'));
  console.log('  solar', hr('solar'));
  console.log('  wind ', hr('wind'));
  console.log('  other', hr('other'));
  console.log('  fosMonth', r.month.map(f1).join(' '));
}
// Negative "other" readings by year.
const neg = {};
for (let i = 0; i < N; i++) { const v = cols.other[i]; if (v < -0.5) { const y = new Date(meta.startMs + i * 900000).getUTCFullYear(); const r = (neg[y] ??= { n: 0, min: 0, sum: 0 }); r.n++; r.sum += v / 4e6; if (v < r.min) r.min = v; } }
console.log('other negatives', JSON.stringify(neg));
