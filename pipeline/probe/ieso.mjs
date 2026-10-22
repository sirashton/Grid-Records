const B = 'https://reports-public.ieso.ca/public/';
const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' };
async function get(u) { const t = Date.now(); try { const r = await fetch(u, { headers: UA }); const s = await r.text(); console.log('GET', u, r.status, s.length, `${Date.now() - t}ms`); return s; } catch (e) { console.log('GET', u, 'ERR', e.message); return ''; } }
const list = async (d) => { const s = await get(B + d + '/'); const names = [...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]); console.log(d, names.length, 'entries; first', names.slice(0, 8).join(' '), '... last', names.slice(-8).join(' ')); };
await list('GenOutputbyFuelHourly');
await list('GenOutputCapability');
await list('GenOutputCapabilityMonth');
for (const y of ['2015', '']) {
  const s = await get(`${B}GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly${y ? '_' + y : ''}.xml`);
  console.log('HEAD', s.slice(0, 1500).replace(/\s+/g, ' '));
  console.log('TAIL', s.slice(-1500).replace(/\s+/g, ' '));
  console.log('FUELS', [...new Set([...s.matchAll(/<FuelType>([^<]+)</g)].map((m) => m[1]))].join(','));
  console.log('DAYS', [...s.matchAll(/<Day>([^<]+)</g)].length);
}
const cur = await get(`${B}GenOutputCapability/PUB_GenOutputCapability.xml`);
console.log('GOC HEAD', cur.slice(0, 2500).replace(/\s+/g, ' '));
console.log('GOC FUELS', [...new Set([...cur.matchAll(/<FuelType>([^<]+)</g)].map((m) => m[1]))].join(','));
