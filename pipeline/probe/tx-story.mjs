// Temporary: prints the Texas story figures from the built data.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const R = new URL('../../site/js', import.meta.url).href;
const { decode } = await import(`${R}/core/dataset.js`);
const { storyFigures } = await import(`${R}/tx/story.js`);
const dir = process.argv[2];
const meta = JSON.parse(readFileSync(`${dir}/meta.json`));
const raw = gunzipSync(readFileSync(`${dir}/series.bin.gz`));
const columns = decode(new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2), meta);
const data = { meta, columns, length: meta.length, startMs: meta.startMs, stepMinutes: meta.stepMinutes };
let end = data.length;
while (end > 0 && Number.isNaN(columns.gas[end - 1])) end--;
const f = storyFigures(data, end);
const iso = (i) => (i >= 0 ? new Date(data.startMs + i * 900000).toISOString().slice(0, 16) : '');
const r1 = (v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);
for (const r of f.rows) {
  const o = { ...r, humps: undefined, hourly: undefined };
  o.twh = Object.fromEntries(Object.entries(r.twh).map(([k, v]) => [k, r1(v)]));
  for (const k of ['noon', 'evening', 'night']) o[k] = Object.fromEntries(Object.entries(r[k]).map(([a, v]) => [a, r1(v)]));
  o.fosMonth = r.fosMonth.map(r1);
  o.fosMinAt = iso(r.fosMinAt); o.fosMaxAt = iso(r.fosMaxAt); o.otherMaxAt = iso(r.otherMaxAt); o.solarMaxAt = iso(r.solarMaxAt);
  for (const k of ['fosShare', 'gasShare', 'coalShare', 'fosMin', 'fosMax', 'otherMax', 'solarMax']) o[k] = Math.round(r[k] * 1000) / 1000;
  o.medianHump = r.medianHump && { gwh: r1(r.medianHump.gwh), peak: r1(r.medianHump.peak), noon: r1(r.medianHump.noon) };
  o.worstHump = r.humps.at(-1) && { gwh: r1(r.humps.at(-1).gwh), peak: r1(r.humps.at(-1).peak), month: r.humps.at(-1).month };
  console.log(JSON.stringify(o));
  if (r.year >= 2019) for (const k of ['gas', 'coal', 'fossil', 'gen', 'other', 'solar', 'wind']) console.log('  ', r.year, k, r.hourly[k].map((v) => v.toFixed(1)).join(' '));
}
console.log('part', JSON.stringify(f.part.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, r1(v)])))));
console.log('spells', JSON.stringify({ f10: f.fossil10Spell && [iso(f.fossil10Spell.start), iso(f.fossil10Spell.end)], f15: f.fossil15Spell && [iso(f.fossil15Spell.start), iso(f.fossil15Spell.end)] }));
