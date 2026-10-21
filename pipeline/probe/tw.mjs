// Temporary: can XM's own metrics classify plants no longer in its resource list?
const H = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)', 'content-type': 'application/json' };
const post = async (path, body) => {
  const r = await fetch('https://servapibi.xm.com.co/' + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const txt = await r.text(); let json = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, json, txt };
};
const vals = (j) => (j?.Items || []).flatMap((i) => (i.ListEntities || i.HourlyEntities || i.DailyEntities || []).map((e) => ({ date: i.Date, id: e.Id, ...e.Values })));
const UNK = ['ALAG', 'CSLG', 'TFL3', 'TFL2', 'BJAG', 'BIOE', 'INP1', 'JNC1', 'TIN1', 'TQD1', 'JPR1', 'PBL1', 'RBJ1', 'JBV1', 'ZRG1', 'PDS1', 'LIM1', 'CTM1', 'CIMR', 'CTM2', 'CLTJ', 'DLR1', '2QFU', 'CTMO', 'PRF1', 'UNIB', 'ILC1', '3RKP', '4SNT', '3KL4'];
const sum = (row) => { let s = 0; for (let h = 1; h <= 24; h++) s += +(row['Hour' + String(h).padStart(2, '0')] || 0); return s; };
for (const [metric, entity, d] of [['ConsCombustibleMBTU', 'Recurso', '2000-03-01'], ['ConsCombustibleMBTU', 'Recurso', '2010-03-01'], ['ConsCombAprox', 'RecursoComb', '2010-03-01'], ['ConsCombAprox', 'RecursoComb', '2020-03-01'], ['EmisionesCO2', 'RecursoComb', '2016-03-01'], ['CapEfecNeta', 'Recurso', '2005-03-01'], ['PrecOferDesp', 'Recurso', '2005-03-01'], ['ConsCombustibleMBTU', 'Combustible', '2005-03-01']]) {
  const r = await post(metric.startsWith('CapEfec') || metric === 'PrecOferDesp' ? (metric === 'PrecOferDesp' ? 'hourly' : 'daily') : 'hourly', { MetricId: metric, StartDate: d, EndDate: d, Entity: entity, Filter: [] });
  let rows = vals(r.json);
  if (!rows.length && metric === 'PrecOferDesp') rows = vals((await post('daily', { MetricId: metric, StartDate: d, EndDate: d, Entity: entity, Filter: [] })).json);
  console.log('\n==', metric, entity, d, r.status, rows.length, r.txt.slice(0, 300));
  const hits = rows.filter((x) => UNK.some((u) => (x.code || x.Code || '').startsWith(u)));
  console.log(' sample', JSON.stringify(rows.slice(0, 3)).slice(0, 600));
  console.log(' unmapped hits', JSON.stringify(hits.map((x) => ({ code: x.code || x.Code, s: x.Value ?? Math.round(sum(x)), comb: x.Combustible || x.fuel }))).slice(0, 2500));
}
const ag = await post('lists', { MetricId: 'ListadoRecursos', Entity: 'Agente' });
const av = vals(ag.json);
console.log('\n== list by agent', ag.status, av.length, JSON.stringify(av.slice(0, 2)));
console.log(' unmapped hits', JSON.stringify(av.filter((x) => UNK.includes(x.Code)).slice(0, 40)));
