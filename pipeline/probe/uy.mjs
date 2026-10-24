// Probe ADME's generation-by-source history: how far back, and how long a range.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const get = async (url) => { const r = await fetch(url); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
const rowsOf = (buf) => {
  writeFileSync('/tmp/f.ods', buf);
  execSync('cd /tmp && rm -rf x && mkdir x && cd x && unzip -q ../f.ods');
  const s = execSync('python3 -c "import re;s=open(\'/tmp/x/content.xml\').read();rows=re.findall(r\'<table:table-row[^>]*>(.*?)</table:table-row>\',s);print(len(rows));[print(\' | \'.join(re.sub(r\'<[^>]+>\',\'\',c) for c in re.findall(r\'<table:table-cell[^>]*>(.*?)</table:table-cell>\',r))) for r in rows[:6]+rows[-3:]]"').toString();
  return s;
};
const ranges = [['01/01/2015', '31/12/2015'], ['01/01/2010', '05/01/2010'], ['01/01/2005', '03/01/2005'], ['01/06/2012', '30/06/2012'], ['01/01/2024', '31/12/2025']];
for (const [a, b] of ranges) {
  const t0 = Date.now();
  const r = await get(`https://pronos.adme.com.uy/gpf.php?fecha_ini=${a}&fecha_fin=${b}&send=MOSTRAR`);
  const h = r.buf.toString('latin1');
  const links = [...h.matchAll(/cache\/gpf_\d+_\d+_horario\.ods/g)].map((m) => m[0]);
  console.log('RANGE', a, b, r.status, links.join(' '), `${Date.now() - t0} ms`, h.match(/error|no hay|sin datos/i)?.[0] ?? '');
  if (!links[0]) continue;
  const f = await get(`https://pronos.adme.com.uy/${links[0]}`);
  console.log('FILE', f.status, f.buf.length);
  if (f.status === 200) { try { console.log(rowsOf(f.buf)); } catch (e) { console.log('parse fail', e.message.slice(0, 200)); } }
}
