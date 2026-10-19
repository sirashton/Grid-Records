import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('out', { recursive: true });
const get = async (name, url) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'grid-records probe' }, signal: AbortSignal.timeout(120000) });
    const text = await r.text();
    await writeFile(`out/${name}.json`, text.slice(0, 400000));
    let summary = `${r.status} ${text.length}B ${Date.now() - t}ms`;
    try {
      const j = JSON.parse(text);
      if (j.production_types) summary += ' types=' + j.production_types.map((p) => `${p.name}[${p.data.filter((v) => v != null).length}/${p.data.length}]`).join('; ') + ` ts=${j.unix_seconds?.length} first=${new Date(j.unix_seconds?.[0] * 1000).toISOString()} step=${j.unix_seconds?.[1] - j.unix_seconds?.[0]}`;
      else summary += ' keys=' + Object.keys(j).join(',');
    } catch {}
    console.log(name, summary);
  } catch (e) { console.log(name, 'ERR', e.message); }
};
const EC = 'https://api.energy-charts.info';
for (const y of [2002, 2010, 2014, 2015, 2018, 2024, 2026]) await get(`pp-${y}`, `${EC}/public_power?country=de&start=${y}-06-01T00:00Z&end=${y}-06-02T00:00Z`);
await get('pp-year-2016', `${EC}/public_power?country=de&start=2016-01-01T00:00Z&end=2017-01-01T00:00Z`);
await get('tp-2024', `${EC}/total_power?country=de&start=2024-06-01T00:00Z&end=2024-06-02T00:00Z`);
await get('installed', `${EC}/installed_power?country=de&time_step=yearly&installation_decommission=false`);
await get('ren-share', `${EC}/ren_share_daily_avg?country=de&year=2024`);
await get('pp-latest', `${EC}/public_power?country=de`);
await get('smard-solar-index-qh', 'https://www.smard.de/app/chart_data/4068/DE/index_quarterhour.json');
await get('smard-solar-index-h', 'https://www.smard.de/app/chart_data/4068/DE/index_hour.json');
