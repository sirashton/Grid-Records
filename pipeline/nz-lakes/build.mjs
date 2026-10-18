// Builds site/nz/lakes.json, the daily inputs for the NZ page's lake model:
// how much energy flowed into the hydro lakes each day from 1980 to 2024,
// and how hard the wind blew and the sun shone on the same days.
//
//   pipeline/nz-lakes/fetch.sh .cache-nz-lakes
//   node pipeline/nz-lakes/build.mjs --in .cache-nz-lakes --nz-data site/data/nz --out site/nz/lakes.json
//
// Inflows are the Electricity Authority's Hydrological Modelling Dataset:
// each river or lake inflow in cumecs, times the megawatts one cumec makes in
// every station below it. The scale factor on those inflows is fitted so the
// monthly water balance (inflow in, hydro output out) matches the change in
// national lake storage. Wind and solar are ERA5 reanalysis from Open-Meteo,
// turned into capacity factors and checked against actual grid output.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { in: { type: 'string', default: '.cache-nz-lakes' }, 'nz-data': { type: 'string', default: 'site/data/nz' }, out: { type: 'string', default: 'site/nz/lakes.json' } } });
const HMD = `${args.in}/hmd`;
const FIRST = '1980-01-02'; // the weather starts at midnight UTC, midday in NZ
const LAST = '2024-12-31';
const log = (...a) => console.log('lakes:', ...a);
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const DAYS = [];
for (let t = Date.parse(FIRST); t <= Date.parse(LAST); t += 864e5) DAYS.push(iso(t));

// Every CSV under the dataset, by file name.
const files = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${dir}/${e.name}`);
    else if (e.name.endsWith('.csv')) files.set(e.name, `${dir}/${e.name}`);
  }
};
walk(HMD);
const find = (prefix) => {
  const name = [...files.keys()].find((f) => f.startsWith(prefix));
  if (!name) throw new Error(`no HMD file starting ${prefix}`);
  return files.get(name);
};
// Flow files: Date,Time,Flow (m³/s),QualityCode, one row a day, not in date order.
const readFlow = (prefix) => {
  const m = new Map();
  for (const line of readFileSync(find(prefix), 'utf8').split('\n').slice(1)) {
    const [d, , q] = line.split(',');
    if (d && q) m.set(d, Number(q));
  }
  return m;
};

// MW one cumec makes through each station below it: the sum of 1 / plant
// factor (cumecs per MW) from the 2024 infrastructure attributes.
const mwPerCumec = (...factors) => factors.reduce((s, f) => s + 1 / f, 0);
const WAIKATO = [3.52, 3.52, 5.11, 3.16, 1.9, 7.22, 2.165, 3.79]; // Aratiatia down to Karāpiro
const waikato = (from) => mwPerCumec(...WAIKATO.slice(from));
const W = { TKA: 4.306, TKB: 0.7784, OHA: 1.998, OHB: 2.4, OHC: 2.4, BEN: 1.223, AVI: 3.225, WTK: 6.165 };
const lowerWaitaki = mwPerCumec(W.BEN, W.AVI, W.WTK);
const CLUTHA = mwPerCumec(1.93, 2.49);
const INFLOWS = [
  ['NI_TPO_Actual_LakeTaupoOperational', waikato(0)],
  ['NI_RPO_Actual_RangipoStationLinear', mwPerCumec(0.51)],
  ['NI_TKU_Actual_TokaanuStationLinear', mwPerCumec(0.571)],
  ...['ARA', 'OHK', 'ATI', 'WKM', 'MTI', 'WPA', 'ARI', 'KPO'].map((s, i) => [`NI_${s}_Waikato`, waikato(i)]),
  ['SI_TEK_Actual_LakeTekapo_Inflow', mwPerCumec(W.TKA, W.TKB, W.OHB, W.OHC) + lowerWaitaki],
  ['SI_PKI_Actual_LakePukaki_Inflow', mwPerCumec(W.OHB, W.OHC) + lowerWaitaki],
  ['SI_OHU_Natural_LakeOhau_Inflow', mwPerCumec(W.OHA, W.OHB, W.OHC) + lowerWaitaki],
  ['SI_BEN_Waitaki', lowerWaitaki],
  ['SI_AVI_Waitaki', mwPerCumec(W.AVI, W.WTK)],
  ['SI_WTK_Waitaki', mwPerCumec(W.WTK)],
  ['SI_HWE_Natural_LakeHawea_Inflow', CLUTHA],
  ['SI_WAN_Natural_LakeWanaka_Outflow', CLUTHA],
  ['SI_CYD_Clutha', CLUTHA],
  ['SI_ROX_Clutha', mwPerCumec(2.49)],
  ['SI_TAU_Natural_LakeTeAnau_Inflow', mwPerCumec(0.653)],
  ['SI_MAN_Actual_LakeManapouri(WithMararoaSpillAndMin', mwPerCumec(0.653)],
  ['NI_WKA_Natural_LakeWaikaremoana_Inflow', mwPerCumec(0.994, 0.63, 1.062)],
  ['NI_MAT_Actual_LakeMatahina_Inflow', mwPerCumec(1.68)],
  ['NI_MHO_Actual_MangahaoStation_Inflow', mwPerCumec(0.395)],
  ['SI_COB_Natural_LakeCobb_Inflow', mwPerCumec(0.227)],
  ['SI_COL_Actual_LakeColeridge_Inflow', mwPerCumec(0.991)],
].map(([prefix, f]) => ({ flow: readFlow(prefix), f }));
const inflow = DAYS.map((d) => INFLOWS.reduce((s, { flow, f }) => {
  const q = flow.get(d);
  if (q === undefined) throw new Error(`missing flow on ${d}`);
  return s + (q * f * 24) / 1000; // cumecs × MW/cumec × 24 h → GWh
}, 0));

// Active storage capacity per lake at the end of 2024, and its GWh per Mm³.
const capRows = readFileSync(find('20241231_EnergyStorageCapacity'), 'utf8').split('\n').filter((l) => l.includes(`,${LAST},`)).map((l) => l.split(','));
const activeGwh = capRows.reduce((s, c) => s + Number(c[7]), 0);
const contingentGwh = capRows.reduce((s, c) => s + (Number(c[11]) || 0), 0);
const gwhPerMm3 = Object.fromEntries(capRows.map((c) => [c[3], Number(c[7]) / Number(c[6])]));
const storage = new Map(DAYS.map((d) => [d, 0]));
for (const [name, path] of files) {
  if (!/_Storage_Lake/.test(name)) continue;
  const code = name.split('_')[1];
  for (const line of readFileSync(path, 'utf8').split('\n').slice(1)) {
    const c = line.split(',');
    if (storage.has(c[0]) && c[3]) storage.set(c[0], storage.get(c[0]) + Number(c[3]) * gwhPerMm3[code]);
  }
}

// Actual daily hydro output (NZ dates) from the site's own NZ data.
const meta = JSON.parse(readFileSync(`${args['nz-data']}/meta.json`));
const raw = gunzipSync(readFileSync(`${args['nz-data']}/series.bin.gz`));
const buf = new Int16Array(raw.buffer, raw.byteOffset, raw.length / 2);
const hc = meta.columns.indexOf('hydro');
const nzDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });
const hydro = new Map();
for (let i = 0, acc = 0; i < meta.length; i++) {
  acc = i === 0 ? buf[hc * meta.length] : acc + buf[hc * meta.length + i];
  const d = nzDay.format(meta.startMs + i * 1800e3);
  hydro.set(d, (hydro.get(d) ?? 0) + acc / 2000); // MW × half an hour → GWh
}

// Fit: storage change + hydro output = k × inflow, over months whose storage
// stays below 3 TWh (so little water is spilled), 1998 on.
const months = new Map();
DAYS.forEach((d, i) => {
  if (d < '1998-01-01' || !hydro.has(d)) return;
  const m = months.get(d.slice(0, 7)) ?? { inflow: 0, hydro: 0, s0: storage.get(d), s1: 0, max: 0 };
  m.inflow += inflow[i];
  m.hydro += hydro.get(d);
  m.s1 = storage.get(d);
  m.max = Math.max(m.max, m.s1);
  months.set(d.slice(0, 7), m);
});
const fit = [...months.values()].filter((m) => m.max < 3000).map((m) => [m.s1 - m.s0 + m.hydro, m.inflow]);
const k = fit.reduce((s, [y, x]) => s + y * x, 0) / fit.reduce((s, [, x]) => s + x * x, 0);
const meanY = fit.reduce((s, [y]) => s + y, 0) / fit.length;
const r2 = 1 - fit.reduce((s, [y, x]) => s + (y - k * x) ** 2, 0) / fit.reduce((s, [y]) => s + (y - meanY) ** 2, 0);
log(`inflow scale ${k.toFixed(3)}, monthly water balance R² ${r2.toFixed(2)} over ${fit.length} months`);

// Weather: hourly UTC, by site. Days are NZ standard time (UTC+12).
const sites = new Map();
for (const f of readdirSync(`${args.in}/weather`).sort()) {
  const site = f.replace(/_\d+\.json(\.gz)?$/, '');
  const body = readFileSync(`${args.in}/weather/${f}`);
  const d = JSON.parse(f.endsWith('.gz') ? gunzipSync(body) : body);
  const key = Object.keys(d.hourly).find((x) => x !== 'time');
  const rows = sites.get(site) ?? [];
  d.hourly.time.forEach((t, i) => rows.push([t, d.hourly[key][i] ?? 0]));
  sites.set(site, rows);
}
const TARGET = { wind: 0.38, solar: 0.19 }; // the cost model's load factors
// A generic turbine: cut in at 3 m/s, full output at 12.5, cut out at 25, 10% losses.
const curve = (v) => (v < 3 || v > 25 ? 0 : v >= 12.5 ? 0.9 : (0.9 * (v ** 3 - 27)) / (12.5 ** 3 - 27));
const daily = { wind: new Map(), solar: new Map() };
for (const [site, rows] of sites) {
  const kind = site.startsWith('wind') ? 'wind' : 'solar';
  let cf;
  if (kind === 'wind') {
    // ERA5 smooths out hill-country wind, so scale each site's speeds until
    // it averages the target load factor; the ups and downs are ERA5's.
    const ms = rows.map(([, v]) => v / 3.6);
    const mean = (x) => ms.reduce((s, v) => s + curve(v * x), 0) / ms.length;
    let lo = 0.5;
    let hi = 3;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (mean(m) < TARGET.wind) lo = m; else hi = m; }
    cf = ms.map((v) => curve(v * lo));
  } else {
    const flat = rows.map(([, g]) => Math.min(1, (g / 1000) * 1.1));
    const mean = flat.reduce((s, v) => s + v, 0) / flat.length;
    cf = flat.map((v) => (v * TARGET.solar) / mean);
  }
  const byDay = new Map();
  rows.forEach(([t], i) => {
    const d = iso(Date.parse(`${t}Z`) + 12 * 3600e3);
    const a = byDay.get(d) ?? [0, 0];
    a[0] += cf[i];
    a[1]++;
    byDay.set(d, a);
  });
  for (const [d, [s, n]] of byDay) if (n >= 20) daily[kind].set(d, [...(daily[kind].get(d) ?? []), s / n]);
}
const cfFor = (kind) => DAYS.map((d) => {
  const a = daily[kind].get(d);
  if (!a?.length) throw new Error(`no ${kind} weather on ${d}`);
  return a.reduce((s, v) => s + v, 0) / a.length;
});
const wind = cfFor('wind');
const solar = cfFor('solar');

const out = {
  first: FIRST,
  days: DAYS.length,
  inflowScale: +k.toFixed(3),
  balanceR2: +r2.toFixed(2),
  activeGwh: Math.round(activeGwh),
  contingentGwh: Math.round(contingentGwh),
  inflow: inflow.map((v) => Math.round(v * 10) / 10), // GWh a day
  storage: DAYS.map((d) => Math.round(storage.get(d))), // GWh, actual national lake storage
  wind: wind.map((v) => Math.round(v * 1000) / 1000), // daily capacity factor
  solar: solar.map((v) => Math.round(v * 1000) / 1000),
};
writeFileSync(args.out, JSON.stringify(out));
log(`wrote ${args.out}: ${DAYS.length} days, ${Math.round(activeGwh)} GWh active and ${Math.round(contingentGwh)} GWh contingent storage`);
