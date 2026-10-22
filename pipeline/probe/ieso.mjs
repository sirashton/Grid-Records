const B = 'https://reports-public.ieso.ca/public/';
const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' };
async function get(u) { const r = await fetch(u, { headers: UA }); console.log('GET', u, r.status); return r.ok ? r.text() : ''; }
const l = await get(B + 'Demand/'); console.log([...l.matchAll(/href="(PUB[^"]+)"/g)].map((m) => m[1]).filter((n) => !/_v\d+/.test(n)).join(' '));
for (const y of ['2015', '2026']) { const s = await get(`${B}Demand/PUB_Demand_${y}.csv`); console.log(s.slice(0, 500)); console.log('...', s.slice(-300)); console.log('lines', s.split('\n').length); }
const s = await get(`${B}Demand/PUB_Demand.csv`); console.log(s.slice(0, 300), '...', s.slice(-300));
// GOC vs yearly for 2026-10-20
const y = await get(`${B}GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly.xml`);
const day = y.split('<DailyData>').find((d) => d.includes('<Day>2026-10-20<'));
const yt = {}; for (const h of day.split('<HourlyData>').slice(1)) for (const f of h.split('<FuelTotal>').slice(1)) { const k = f.match(/<Fuel>([^<]+)/)[1]; yt[k] = (yt[k] ?? 0) + (Number(f.match(/<Output>([^<]*)/)?.[1]) || 0); }
const g = await get(`${B}GenOutputCapability/PUB_GenOutputCapability_20261020.xml`);
const gt = {}; for (const x of g.split('<Generator>').slice(1)) { const k = x.match(/<FuelType>([^<]+)/)[1]; for (const [, , v] of x.split('<Capabilities>')[0].matchAll(/<Hour>(\d+)<\/Hour>\s*<EnergyMW>([^<]*)</g)) gt[k] = (gt[k] ?? 0) + (Number(v) || 0); }
console.log('yearly 2026-10-20', JSON.stringify(yt)); console.log('GOC    2026-10-20', JSON.stringify(gt));
const c = await get(`${B}GenOutputCapability/PUB_GenOutputCapability.xml`); console.log('GOC now created', c.match(/<CreatedAt>([^<]+)/)?.[1], 'date', c.match(/<Date>([^<]+)/)?.[1]);
console.log('blank outputs sample', g.match(/<EnergyMW><\/EnergyMW>|<EnergyMW\/>/g)?.length ?? 0);
