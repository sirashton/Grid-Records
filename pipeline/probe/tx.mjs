// Temporary: what ERCOT serves to the Actions runner.
const UA = { 'user-agent': 'Mozilla/5.0 (grid-records; github.com/sirashton/Grid-Records)' };
async function get(url) {
  try {
    const r = await fetch(url, { headers: UA });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log('GET', url, r.status, r.headers.get('content-type'), buf.length);
    return { status: r.status, buf };
  } catch (e) { console.log('GET', url, 'ERR', e.message); return { status: 0, buf: Buffer.alloc(0) }; }
}
const page = await get('https://www.ercot.com/gridinfo/generation');
const html = page.buf.toString();
const links = [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /fuel|intgen|mix|\.zip|\.xlsx/i.test(h)))];
console.log(links.join('\n'));
const dash = await get('https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json');
console.log(dash.buf.toString().slice(0, 1500));
for (const l of links.slice(0, 40)) {
  const u = new URL(l, 'https://www.ercot.com').href;
  const r = await fetch(u, { method: 'HEAD', headers: UA }).catch((e) => ({ status: 'ERR ' + e.message, headers: new Map() }));
  console.log('HEAD', u, r.status, r.headers.get?.('content-length'), r.headers.get?.('last-modified'));
}
