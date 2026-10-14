import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagePath, depthMilestones, track } from '../site/js/analytics.js';
import { shapeHits, rates } from '../pipeline/analytics-snapshot.mjs';

test('page path drops the GitHub Pages prefix', () => {
  assert.equal(pagePath('/Grid-Records/'), '/');
  assert.equal(pagePath('/Grid-Records'), '/');
  assert.equal(pagePath('/'), '/');
  assert.equal(pagePath('/Grid-RecordsX/'), '/Grid-RecordsX/');
});

test('scroll milestones reached', () => {
  assert.deepEqual(depthMilestones(500, 1000), [25, 50]);
  assert.deepEqual(depthMilestones(995, 1000), [25, 50, 75, 100]);
  assert.deepEqual(depthMilestones(0, 0), []);
});

test('track is a no-op while analytics is off', () => {
  assert.doesNotThrow(() => track('anything'));
});

test('snapshot splits pages from events and rates events per visit', () => {
  const hits = [
    { path: '/', title: 'Grid Records', count: 200, event: false, stats: [{ day: '2026-10-13', daily: 120 }, { day: '2026-10-14', daily: 80 }] },
    { path: 'chapter-open-2', title: 'chapter-open-2', count: 50, event: true, stats: [] },
  ];
  const { pages, events } = shapeHits(hits);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].daily, { '2026-10-13': 120, '2026-10-14': 80 });
  assert.equal(events[0].name, 'chapter-open-2');
  assert.deepEqual(rates(events, 200), { 'chapter-open-2': 0.25 });
  assert.deepEqual(rates(events, 0), { 'chapter-open-2': 0 });
});
