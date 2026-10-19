// Stamps the country switch from site/js/countries/index.js into every page
// that has one, so the switch is plain HTML (no layout shift, works without
// scripts) but has one source. `--check` changes nothing and exits 1 if a
// page is out of date. The deploy runs this before building, CI checks it.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRIES } from '../site/js/countries/index.js';
import { navHtml } from '../site/js/core/nav.js';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const NAV = /<nav class="region-nav" aria-label="Country">[\s\S]*?<\/nav>/;

async function pages(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (e.name !== 'data') out.push(...await pages(join(dir, e.name))); }
    else if (e.name === 'index.html') out.push(join(dir, e.name));
  }
  return out;
}

// Each page with a switch: its file, its path from the site root, its HTML
// now, and what the switch should be.
export async function navPages() {
  const result = [];
  for (const file of await pages(SITE)) {
    const html = await readFile(file, 'utf8');
    if (!NAV.test(html)) continue;
    const dir = relative(SITE, dirname(file)).split(sep).join('/');
    const page = dir ? `${dir}/` : '';
    result.push({ file, page, html, current: html.match(NAV)[0], expected: navHtml(COUNTRIES, page) });
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const p of await navPages()) {
    if (p.current === p.expected) continue;
    stale.push(relative(SITE, p.file));
    if (!check) await writeFile(p.file, p.html.replace(NAV, p.expected));
  }
  if (check && stale.length) {
    console.error(`Country switch out of date in ${stale.join(', ')}. Run npm run nav.`);
    process.exit(1);
  }
  console.log(stale.length ? `${check ? 'Out of date' : 'Updated'}: ${stale.join(', ')}` : 'Country switch up to date on every page.');
}
