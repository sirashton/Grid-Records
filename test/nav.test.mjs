// The country switch on every page comes from site/js/countries/index.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navHtml } from '../site/js/core/nav.js';
import { navPages } from '../pipeline/nav.mjs';
import { COUNTRIES } from '../site/js/countries/index.js';

test('every page has the switch stamped from the country list (npm run nav)', async () => {
  const pages = await navPages();
  for (const c of COUNTRIES) assert.ok(pages.some((p) => p.page === c.page), `no page with a switch at /${c.page}`);
  for (const p of pages) assert.equal(p.current, p.expected, `switch on /${p.page} is out of date: run npm run nav`);
});

test('links are relative to the page and the current country is marked', () => {
  const list = [
    { country: { name: 'Great Britain' }, page: '', flag: 'flags/gb.svg' },
    { country: { name: 'Australia (NEM)' }, page: 'au/', flag: 'flags/au.svg', nav: 'Australia' },
  ];
  assert.equal(navHtml(list, ''),
    '<nav class="region-nav" aria-label="Country"><span aria-current="page"><img src="flags/gb.svg" alt="" width="30" height="15">Great Britain</span><a href="au/"><img src="flags/au.svg" alt="" width="30" height="15">Australia</a></nav>');
  assert.equal(navHtml(list, 'au/'),
    '<nav class="region-nav" aria-label="Country"><a href="../"><img src="../flags/gb.svg" alt="" width="30" height="15">Great Britain</a><span aria-current="page"><img src="../flags/au.svg" alt="" width="30" height="15">Australia</span></nav>');
});
