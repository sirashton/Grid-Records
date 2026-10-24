// Probe ADME's generation-by-source page for Uruguay.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const get = async (url, opts) => { const r = await fetch(url, opts); return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) }; };
const page = await get('https://pronos.adme.com.uy/gpf.php');
const html = page.buf.toString('latin1');
console.log('gpf.php', page.status, page.type, html.length);
for (const m of html.matchAll(/<(form|input|select|button|a|script)\b[^>]*>/gi)) console.log('TAG', m[0].slice(0, 300));
for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) console.log('SCRIPT', m[1].slice(0, 1500));
// 10-minute index since 1899-12-30.
const idx = (iso) => Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 600000);
const tries = [
  [idx('2026-10-20T00:00Z'), idx('2026-10-22T00:00Z')],
  [idx('2015-01-01T00:00Z'), idx('2015-01-31T23:50Z')],
  [idx('2010-01-01T00:00Z'), idx('2010-01-02T00:00Z')],
];
for (const [a, b] of tries) {
  for (const kind of ['horario', 'diezminutal']) {
    const url = `https://pronos.adme.com.uy/cache/gpf_${a}_${b}_${kind}.ods`;
    const r = await get(url);
    console.log('ODS', url, r.status, r.type, r.buf.length);
    if (r.status === 200 && r.buf.length > 1000 && kind === 'horario') {
      writeFileSync('/tmp/f.ods', r.buf);
      try { console.log(execSync('cd /tmp && rm -rf x && mkdir x && cd x && unzip -q ../f.ods && ls && python3 -c "import re;s=open(\'content.xml\').read();print(len(s));print(re.sub(r\'<[^>]+>\',\' \',s)[:3000])"').toString()); } catch (e) { console.log('unzip fail', e.message); }
    }
  }
}
// Try the form with query parameters.
for (const q of ['?fechaini=01/01/2015&fechafin=03/01/2015', '?fecha_ini=2015-01-01&fecha_fin=2015-01-03', '?desde=01/01/2015&hasta=03/01/2015']) {
  const r = await get('https://pronos.adme.com.uy/gpf.php' + q);
  const h = r.buf.toString('latin1');
  console.log('Q', q, r.status, [...h.matchAll(/cache\/gpf_\d+_\d+_\w+\.\w+/g)].map((m) => m[0]).join(' '));
}
