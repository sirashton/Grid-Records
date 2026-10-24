// Probe where ADME's generation-by-source history starts, two days per year.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const get = async (url) => { const r = await fetch(url); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; };
const rowsOf = (buf, n) => {
  writeFileSync('/tmp/f.ods', buf);
  execSync('cd /tmp && rm -rf x && mkdir x && cd x && unzip -q ../f.ods');
  return execSync(`python3 -c "import re;s=open('/tmp/x/content.xml').read();rows=re.findall(r'<table:table-row[^>]*>(.*?)</table:table-row>',s);print('rows',len(rows));[print(' | '.join(re.sub(r'<[^>]+>','',c) for c in re.findall(r'<table:table-cell[^>]*>(.*?)</table:table-cell>',r))) for r in rows[:${n}]]"`).toString();
};
for (const d of ['01/07/2015', '01/01/2016', '01/07/2016', '01/01/2017', '01/01/2018', '01/01/2019', '01/01/2020', '01/01/2022']) {
  const [dd, mm, yy] = d.split('/');
  const r = await get(`https://pronos.adme.com.uy/gpf.php?fecha_ini=${d}&fecha_fin=${dd}/${mm}/${yy}`.replace(/fecha_fin=(\d+)/, (m, x) => `fecha_fin=${String(+x + 2).padStart(2, '0')}`));
  const h = r.buf.toString('latin1');
  const link = h.match(/cache\/gpf_\d+_\d+_horario\.ods/)?.[0];
  console.log('DAY', d, link ?? 'none', h.includes('Fatal') ? 'FATAL' : '');
  if (!link) continue;
  const f = await get(`https://pronos.adme.com.uy/${link}`);
  if (f.status === 200) console.log(rowsOf(f.buf, 6));
}
