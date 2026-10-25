// Probe: EIA-930 bulk six-month files, no key.
const B = 'https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/';
const show = async (url, n = 1500) => {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'grid-records probe' } });
    console.log('\n==', url, r.status, r.headers.get('content-type'), r.headers.get('content-length'), r.headers.get('last-modified'));
    if (!r.ok) return null;
    const txt = await r.text();
    console.log('bytes', txt.length, 'in', Date.now() - t, 'ms');
    console.log(txt.slice(0, n));
    return txt;
  } catch (e) { console.log('ERR', url, e.message); return null; }
};
await show('https://www.eia.gov/electricity/gridmonitor/about', 300);
const idx = await show('https://www.eia.gov/electricity/gridmonitor/sixMonthFiles/', 200);
if (idx) console.log([...idx.matchAll(/href="([^"]+\.csv)"/g)].map((m) => m[1]).join('\n'));
for (const f of ['EIA930_BALANCE_2026_Jul_Dec.csv', 'EIA930_BALANCE_2018_Jul_Dec.csv']) {
  const t = await show(B + f, 2500);
  if (t) {
    const lines = t.split('\n');
    console.log('lines', lines.length);
    const ba = new Map();
    for (const l of lines.slice(1)) { const k = l.split(',')[0]; ba.set(k, (ba.get(k) || 0) + 1); }
    console.log('BAs', ba.size, [...ba.keys()].join(' '));
    console.log('last lines', lines.slice(-3).join('\n'));
  }
}
