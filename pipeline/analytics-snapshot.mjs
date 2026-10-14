// Pulls the site's GoatCounter statistics into one JSON file, so an agent can
// read usage history from git without GoatCounter credentials.
//
//   GOATCOUNTER_CODE=gridrecords GOATCOUNTER_TOKEN=... node pipeline/analytics-snapshot.mjs --days 30 --out analytics/latest.json
//
// Definitions of every field are in docs/analytics.md.
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const PAGES = ['toprefs', 'campaigns', 'browsers', 'systems', 'sizes', 'locations'];

/** Turn GoatCounter's hit list into page views and events, each with daily counts. */
export function shapeHits(hits) {
  const row = (h) => ({
    name: h.path,
    title: h.title,
    count: h.count,
    daily: Object.fromEntries((h.stats || []).map((s) => [s.day, s.daily])),
  });
  return {
    pages: hits.filter((h) => !h.event).map(row),
    events: hits.filter((h) => h.event).map(row),
  };
}

/** Share of visits that did each event, from the event counts and total visits. */
export function rates(events, visits) {
  return Object.fromEntries(events.map((e) => [e.name, visits ? Math.round((e.count / visits) * 1000) / 1000 : 0]));
}

async function main() {
  const { values: args } = parseArgs({ options: { days: { type: 'string' }, out: { type: 'string' } } });
  const code = process.env.GOATCOUNTER_CODE;
  const token = process.env.GOATCOUNTER_TOKEN;
  if (!code || !token) {
    console.log('GOATCOUNTER_CODE or GOATCOUNTER_TOKEN not set, skipping.');
    return;
  }
  const days = Number(args.days || 30);
  const end = new Date();
  const start = new Date(end - days * 864e5);
  const base = `https://${code}.goatcounter.com/api/v0`;
  const q = `start=${start.toISOString()}&end=${end.toISOString()}`;

  // The API allows 4 requests a second.
  const get = async (path) => {
    await new Promise((r) => setTimeout(r, 300));
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const all = async (path, key) => {
    const out = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await get(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
      out.push(...r[key]);
      if (!r.more) break;
    }
    return out;
  };

  const total = await get(`/stats/total?${q}`);
  // /stats/hits pages by excluding what it has already returned.
  const hits = [];
  for (let page = 0; page < 20; page++) {
    const exclude = hits.map((h) => `&exclude_paths=${h.path_id}`).join('');
    const r = await get(`/stats/hits?${q}&limit=100${exclude}`);
    hits.push(...r.hits);
    if (!r.more || !r.hits.length) break;
  }
  const { pages, events } = shapeHits(hits);
  const visits = pages.reduce((n, p) => n + p.count, 0);
  const breakdowns = {};
  for (const p of PAGES) breakdowns[p] = (await all(`/stats/${p}?${q}`, 'stats')).map((s) => ({ name: s.name, count: s.count }));

  const snapshot = {
    generated: end.toISOString(),
    range: { start: start.toISOString(), end: end.toISOString(), days },
    visits,
    pageviewsTotal: total.total,
    eventsTotal: total.total_events,
    daily: Object.fromEntries(total.stats.map((s) => [s.day, s.daily])),
    pages,
    events,
    eventRates: rates(events, visits),
    ...breakdowns,
  };
  const out = args.out || 'analytics/latest.json';
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  console.log(`Wrote ${out}: ${visits} visits, ${events.length} event types.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
