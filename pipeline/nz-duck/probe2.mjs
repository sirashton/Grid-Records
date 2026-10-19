// Scratch probe 2: lists EMI environment datasets and fetches lake storage files.
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = 'https://emidatasets.blob.core.windows.net/publicdata';
await mkdir('probe-out/env', { recursive: true });
async function list(prefix, delim) {
  const names = []; let marker = '';
  for (let i = 0; i < 40; i++) {
    const t = await (await fetch(`${BASE}?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}${delim ? '&delimiter=/' : ''}&maxresults=5000${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`)).text();
    names.push(...[...t.matchAll(/<Name>([^<]*)<\/Name>/g)].map((m) => m[1]));
    marker = /<NextMarker>([^<]+)<\/NextMarker>/.exec(t)?.[1] ?? ''; if (!marker) break;
  }
  return names;
}
const all = await list('Datasets/Environment/', false);
await writeFile('probe-out/env/listing.txt', all.filter((n) => !/HydrologicalModellingDataset/.test(n)).join('\n'));
const want = all.filter((n) => /storage/i.test(n) && !/HydrologicalModellingDataset/.test(n) && /\.csv$/i.test(n));
console.log('storage files', want.length);
for (const n of want.slice(0, 400)) {
  const r = await fetch(`${BASE}/${n.split('/').map(encodeURIComponent).join('/')}`);
  if (r.ok) await writeFile(`probe-out/env/${n.split('/').pop()}`, Buffer.from(await r.arrayBuffer()));
}
