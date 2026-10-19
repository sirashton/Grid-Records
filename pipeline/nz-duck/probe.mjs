// Scratch probe: lists EMI price files and fetches half-hourly final prices
// at Otahuhu (OTA2201) and Benmore (BEN2201) into probe-out/prices.json.
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = 'https://emidatasets.blob.core.windows.net/publicdata';
const out = 'probe-out';
await mkdir(out, { recursive: true });
async function list(prefix, delim = true) {
  const names = [];
  let marker = '';
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${BASE}?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}${delim ? '&delimiter=/' : ''}&maxresults=5000${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`);
    const t = await r.text();
    names.push(...[...t.matchAll(/<Name>([^<]*)<\/Name>/g)].map((m) => m[1]));
    marker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(t)?.[1] ?? '';
    if (!marker) break;
  }
  return names;
}
const listing = [];
for (const p of ['Datasets/Wholesale/', 'Datasets/Wholesale/DispatchAndPricing/', 'Datasets/Wholesale/DispatchAndPricing/FinalEnergyPrices/', 'Datasets/Wholesale/DispatchAndPricing/FinalEnergyPrices/ByMonth/', 'Datasets/Wholesale/Final_pricing/', 'Datasets/Wholesale/Final_pricing/Final_prices/']) {
  const n = await list(p);
  listing.push(`## ${p} (${n.length})`, ...n.slice(0, 40), n.length > 40 ? `... ${n.slice(-10).join('\n')}` : '');
}
await writeFile(`${out}/listing.txt`, listing.join('\n'));
const monthly = (await list('Datasets/Wholesale/DispatchAndPricing/FinalEnergyPrices/ByMonth/', false)).filter((n) => n.endsWith('.csv'));
console.log('monthly price files', monthly.length, monthly[0], monthly.at(-1));
const NODES = ['OTA2201', 'BEN2201'];
const prices = {};
let header = null;
async function one(name) {
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) { console.log('fail', name, r.status); return; }
  const t = await r.text();
  const lines = t.split(/\r?\n/);
  const h = lines[0].replace(/^﻿/, '').split(',').map((s) => s.trim());
  header ??= h;
  const di = h.findIndex((x) => /date/i.test(x));
  const ti = h.findIndex((x) => /period/i.test(x));
  const ni = h.findIndex((x) => /node|pointofconnection|poc/i.test(x));
  const pi = h.findIndex((x) => /price|dollars/i.test(x));
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const node = f[ni]?.trim();
    if (!NODES.includes(node)) continue;
    const d = f[di].trim();
    const key = `${node}`;
    ((prices[key] ??= {})[d] ??= [])[Number(f[ti]) - 1] = Number(f[pi]);
  }
}
const todo = monthly.filter((n) => /(20(0[89]|1\d|2\d))\d\d_/.test(n.split('/').pop()));
for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(one));
console.log('header', header, Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Object.keys(v).length])));
await writeFile(`${out}/prices.json`, JSON.stringify({ header, prices }));
