const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' };
async function get(u, n = 1500) { try { const r = await fetch(u, { headers: UA }); const s = await r.text(); console.log('GET', u, r.status, s.length); console.log(s.slice(0, n)); return s; } catch (e) { console.log('ERR', u, e.message); return ''; } }
const E = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets';
await get(`${E}/ods201`, 3000);
await get(`${E}/ods201/records?limit=3&order_by=datetime%20asc`, 2500);
await get(`${E}/ods201/records?limit=3&order_by=datetime%20desc`, 2500);
await get(`${E}/ods201/records?select=count(*)%20as%20n,min(datetime)%20as%20a,max(datetime)%20as%20b&group_by=fuelcode`, 3000);
// search catalog for generation datasets
const c = await get(`${E}?limit=100&select=dataset_id,metas.default.title&where=search(%22generation%22)`, 200);
try { for (const d of JSON.parse(c).results) console.log(d.dataset_id, '|', d.title ?? JSON.stringify(d)); } catch (e) { console.log(e.message); }
await get('https://api.energy-charts.info/public_power?country=be&start=2015-01-01T00:00Z&end=2015-01-01T03:00Z', 1500);
