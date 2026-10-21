// Temporary: Colombia (XM) and Ontario (IESO) from Actions.
const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)', 'content-type': 'application/json' };
const show = (label, txt, n = 1500) => console.log('\n==', label, '\n' + txt.slice(0, n));
const post = async (path, body, n) => {
  try {
    const t0 = Date.now();
    const r = await fetch('https://servapibi.xm.com.co/' + path, { method: 'POST', headers: UA, body: JSON.stringify(body) });
    const txt = await r.text();
    show(`${path} ${JSON.stringify(body)} ${r.status} ${txt.length}B ${Date.now() - t0}ms`, txt, n);
    return txt;
  } catch (e) { show(path + ' ERR', e.message + ' ' + e.cause?.code); }
};
await post('lists', { MetricId: 'ListadoMetricas' }, 3000);
const recs = await post('lists', { MetricId: 'ListadoRecursos', Entity: 'Sistema' }, 2500);
try {
  const j = JSON.parse(recs); const items = j.Items.flatMap((i) => i.ListEntities || [i]);
  console.log('resources', items.length);
  const types = {}; for (const it of items) { const v = it.Values || it; const k = `${v.Type}|${v.EnerSource}|${v.State}|${v.Disp}`; types[k] = (types[k] || 0) + 1; }
  console.log(JSON.stringify(types, null, 1).slice(0, 4000));
} catch (e) { console.log('parse', e.message); }
await post('hourly', { MetricId: 'Gene', StartDate: '2026-09-01', EndDate: '2026-09-02', Entity: 'Recurso', Filter: [] }, 1500);
await post('hourly', { MetricId: 'Gene', StartDate: '2000-01-01', EndDate: '2000-01-02', Entity: 'Recurso', Filter: [] }, 800);
await post('hourly', { MetricId: 'Gene', StartDate: '2026-09-01', EndDate: '2026-09-30', Entity: 'Sistema', Filter: [] }, 800);
await post('hourly', { MetricId: 'Gene', StartDate: '2026-10-19', EndDate: '2026-10-21', Entity: 'Sistema', Filter: [] }, 800);
await post('hourly', { MetricId: 'Gene', StartDate: '2026-08-01', EndDate: '2026-08-31', Entity: 'Recurso', Filter: [] }, 300);
// Ontario
for (const u of ['https://reports-public.ieso.ca/public/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly_2015.xml',
  'https://reports-public.ieso.ca/public/GenOutputbyFuelHourly/PUB_GenOutputbyFuelHourly.xml',
  'https://reports-public.ieso.ca/public/GenOutputCapability/PUB_GenOutputCapability.xml']) {
  try { const r = await fetch(u, { headers: { 'user-agent': UA['user-agent'] } }); const t = await r.text(); show(`${u} ${r.status} ${t.length}`, t, 1500); } catch (e) { show(u + ' ERR', e.message); }
}
