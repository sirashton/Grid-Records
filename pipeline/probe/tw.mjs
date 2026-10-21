// Temporary: Colombia (XM) fuel mapping coverage and data lag, from Actions.
const H = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)', 'content-type': 'application/json' };
const post = async (path, body) => {
  const r = await fetch('https://servapibi.xm.com.co/' + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const vals = (j) => (j?.Items || []).flatMap((i) => (i.ListEntities || i.HourlyEntities || i.DailyEntities || []).map((e) => ({ date: i.Date, ...e.Values })));
const cur = vals((await post('lists', { MetricId: 'ListadoRecursos', Entity: 'Sistema' })).json);
console.log('current list', cur.length);
for (const sd of ['2005-01-01', '2012-06-01']) {
  const r = await post('lists', { MetricId: 'ListadoRecursos', Entity: 'Sistema', StartDate: sd, EndDate: sd });
  const v = vals(r.json); console.log('list at', sd, r.status, v.length, v.slice(0, 2));
}
const map = new Map(cur.map((v) => [v.Code, `${v.Type}|${v.EnerSource}`]));
// Other metrics that might classify old plants.
const met = vals((await post('lists', { MetricId: 'ListadoMetricas' })).json);
for (const m of met) if (/Recurso|Gene|Comb|Planta|Tipo/i.test(m.MetricId + m.MetricName) || m.Type === 'ListsEntities') console.log('metric', m.MetricId, '|', m.MetricName, '|', m.Entity, m.Type, m.MaxDays, m.MetricUnits);
for (const sd of ['2000-03-01', '2005-03-01', '2010-03-01', '2015-03-01', '2020-03-01', '2025-03-01']) {
  const r = await post('hourly', { MetricId: 'Gene', StartDate: sd, EndDate: sd, Entity: 'Recurso', Filter: [] });
  const rows = vals(r.json); const by = {}; const unk = {};
  for (const row of rows) {
    let s = 0; for (let h = 1; h <= 24; h++) s += +(row['Hour' + String(h).padStart(2, '0')] || 0);
    const k = map.get(row.code) || 'UNMAPPED'; by[k] = (by[k] || 0) + s / 1000;
    if (!map.has(row.code)) unk[row.code] = Math.round(s / 1000);
  }
  const tot = Object.values(by).reduce((a, b) => a + b, 0);
  console.log('\n', sd, 'resources', rows.length, 'total MWh', Math.round(tot), JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round(v)]))));
  console.log(' unmapped', JSON.stringify(Object.entries(unk).sort((a, b) => b[1] - a[1]).slice(0, 25)));
}
for (const d of ['2026-10-10', '2026-10-14', '2026-10-16', '2026-10-17', '2026-10-18']) {
  const r = await post('hourly', { MetricId: 'Gene', StartDate: d, EndDate: d, Entity: 'Sistema', Filter: [] });
  console.log('Sistema', d, vals(r.json).length);
}
