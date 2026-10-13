// One-off probe of the upstream data sources. Prints shapes, not data dumps.
const get = async (url, asText = false) => {
  const t = Date.now();
  const r = await fetch(url, { headers: { 'user-agent': 'grid-records-probe' } });
  const body = asText ? await r.text() : await r.text();
  console.log(`\n### ${r.status} ${url} (${body.length} bytes, ${Date.now() - t} ms)`);
  return body;
};
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };
const rows = (j) => (Array.isArray(j) ? j : j?.data ?? []);

const E = 'https://data.elexon.co.uk/bmrs/api/v1';

// NESO historic generation mix
{
  const pkg = tryJson(await get('https://api.neso.energy/api/3/action/package_show?id=historic-generation-mix'));
  for (const r of pkg?.result?.resources ?? []) console.log('resource', r.name, r.format, r.url);
  const url = pkg?.result?.resources?.find((r) => /csv/i.test(r.format))?.url;
  if (url) {
    const csv = await get(url, true);
    const lines = csv.split(/\r?\n/);
    console.log('lines', lines.length);
    console.log(lines.slice(0, 3).join('\n'));
    console.log(lines.slice(-4).join('\n'));
  }
}
// NESO demand data update (embedded solar/wind)
{
  const pkg = tryJson(await get('https://api.neso.energy/api/3/action/package_show?id=demand-data-update'));
  for (const r of pkg?.result?.resources ?? []) console.log('resource', r.name, r.format, r.url);
}
// NESO dataset search for battery
{
  const s = tryJson(await get('https://api.neso.energy/api/3/action/package_search?q=battery&rows=20'));
  for (const p of s?.result?.results ?? []) console.log('dataset', p.name, '|', p.title);
}
// Elexon BMU reference
{
  const all = rows(tryJson(await get(`${E}/reference/bmunits/all`)));
  console.log('bmunits', all.length);
  const ft = {};
  for (const u of all) ft[u.fuelType] = (ft[u.fuelType] || 0) + 1;
  console.log('fuelTypes', JSON.stringify(ft));
  const bat = all.filter((u) => /batt|bess|storage|stor\b/i.test(`${u.bmUnitName} ${u.fuelType}`));
  console.log('battery-like by name/fuel', bat.length);
  for (const u of bat.slice(0, 400)) console.log('  ', u.elexonBmUnit, u.nationalGridBmUnit, u.fuelType, u.bmUnitType, u.generationCapacity, u.demandCapacity, JSON.stringify(u.bmUnitName), u.leadPartyName);
  console.log('sample record', JSON.stringify(all[0]));
}
{
  const ft = tryJson(await get(`${E}/reference/fueltypes/all`));
  console.log('fueltypes', JSON.stringify(ft));
}
// FUELHH / FUELINST BESS presence
for (const d of ['2026-10-12', '2025-06-01']) {
  const j = rows(tryJson(await get(`${E}/datasets/FUELHH/stream?settlementDateFrom=${d}&settlementDateTo=${d}`)));
  console.log(d, 'FUELHH rows', j.length, 'fuelTypes', [...new Set(j.map((r) => r.fuelType))].join(','));
}
// FUELHH range limits
for (const [a, b] of [['2026-01-01', '2026-03-31'], ['2009-01-01', '2009-01-02'], ['2010-06-01', '2010-06-01']]) {
  const j = rows(tryJson(await get(`${E}/datasets/FUELHH/stream?settlementDateFrom=${a}&settlementDateTo=${b}`)));
  console.log(a, b, 'FUELHH rows', j.length);
}
// PN stream
for (const q of ['from=2026-10-12T12:00Z&to=2026-10-12T13:00Z', 'from=2026-10-11T00:00Z&to=2026-10-12T00:00Z']) {
  const s = await get(`${E}/datasets/PN/stream?${q}`);
  const j = rows(tryJson(s));
  console.log('PN stream rows', j.length, JSON.stringify(j[0]), s.slice(0, 200));
}
// B1610 stream: lag and size
for (const q of ['from=2026-10-11T00:00Z&to=2026-10-12T00:00Z', 'from=2026-10-05T00:00Z&to=2026-10-06T00:00Z', 'from=2024-01-01T00:00Z&to=2024-01-02T00:00Z']) {
  const s = await get(`${E}/datasets/B1610/stream?${q}`);
  const j = rows(tryJson(s));
  console.log('B1610 rows', j.length, JSON.stringify(j[0]), s.slice(0, 200));
}
// Carbon intensity
await get('https://api.carbonintensity.org.uk/generation');
