const B = 'https://reports-public.ieso.ca/public/';
const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' };
async function get(u) { const r = await fetch(u, { headers: UA }); return r.ok ? r.text() : (console.log(u, r.status), ''); }
for (let y = 2015; y <= 2026; y++) {
  const s = await get(`${B}GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly${y === 2026 ? '' : '_' + y}.xml`);
  const tot = {}; const oq = {}; const hrs = {}; let blanks = 0;
  for (const d of s.split('<DailyData>').slice(1)) {
    const day = d.match(/<Day>([^<]+)/)[1];
    const hs = d.split('<HourlyData>').slice(1);
    hrs[hs.length] = (hrs[hs.length] ?? 0) + 1;
    for (const h of hs) for (const f of h.split('<FuelTotal>').slice(1)) {
      const fuel = f.match(/<Fuel>([^<]+)/)[1];
      const q = f.match(/<OutputQuality>([^<]*)/)?.[1]; const o = f.match(/<Output>([^<]*)/)?.[1];
      oq[q] = (oq[q] ?? 0) + 1;
      if (o == null || o === '') { blanks++; continue; }
      tot[fuel] = (tot[fuel] ?? 0) + Number(o);
    }
  }
  console.log(y, 'hoursPerDay', JSON.stringify(hrs), 'OQ', JSON.stringify(oq), 'blanks', blanks, 'TWh', Object.entries(tot).map(([k, v]) => `${k} ${(v / 1e6).toFixed(2)}`).join(' '));
  if (y === 2026) { const neg = [...s.matchAll(/<Output>(-[^<]*)/g)].length; console.log('negative outputs', neg); }
}
for (const f of ['PUB_GenOutputCapability.xml', 'PUB_GenOutputCapability_20261021.xml']) {
  const s = await get(B + 'GenOutputCapability/' + f);
  const gens = s.split('<Generator>').slice(1);
  const by = {}; let maxHour = 0;
  for (const g of gens) {
    const fuel = g.match(/<FuelType>([^<]+)/)[1]; const name = g.match(/<GeneratorName>([^<]+)/)[1];
    const outs = [...g.split('<Capabilities>')[0].matchAll(/<Hour>(\d+)<\/Hour>\s*<EnergyMW>([^<]*)</g)];
    for (const [, h] of outs) maxHour = Math.max(maxHour, +h);
    const sum = outs.reduce((a, [, , v]) => a + (Number(v) || 0), 0);
    (by[fuel] ??= []).push(`${name}:${sum}`);
  }
  console.log(f, 'gens', gens.length, 'maxHour', maxHour);
  for (const [k, v] of Object.entries(by)) console.log('  ', k, v.length, k === 'OTHER' || k === 'SOLAR' || k === 'BIOFUEL' ? v.join(' ') : v.slice(0, 5).join(' '));
}
