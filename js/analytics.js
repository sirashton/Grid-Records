// Usage analytics through GoatCounter: cookie-free, no personal data, so no
// consent banner. Page views come from GoatCounter's count.js; the events
// below are what people do on the page. Every name sent here is listed in
// docs/analytics.md, so keep the two in step.

// The GoatCounter site code (https://CODE.goatcounter.com). Empty turns
// analytics off.
const GOATCOUNTER = '';

const sent = new Set();
const queue = [];

/** Count an event once per page view. Names cannot start with "/". */
export function track(name, title = name) {
  if (!GOATCOUNTER || sent.has(name)) return;
  sent.add(name);
  const hit = { path: name, title, event: true };
  if (window.goatcounter?.count) window.goatcounter.count(hit);
  else queue.push(hit);
}

/** Page path without the GitHub Pages project prefix, so counts carry over to the custom domain. */
export const pagePath = (pathname) => pathname.replace(/^\/Grid-Records(?=\/|$)/i, '') || '/';

/** Scroll depth milestones (percent of the page) reached at this scroll position. */
export function depthMilestones(scrollBottom, pageHeight, steps = [25, 50, 75, 100]) {
  const pct = pageHeight > 0 ? (scrollBottom / pageHeight) * 100 : 0;
  return steps.filter((s) => pct >= s - 1);
}

// What each control means, keyed by a selector. The value builds the event
// name from the element, or is the name itself.
const CLICKS = [
  ['[data-mode]', (b) => `records-mode-${b.dataset.mode}`],
  ['[data-unit]', (b) => `records-unit-${b.dataset.unit}`],
  ['#range [data-range]', (b) => `timeline-range-${b.dataset.range}`],
  ['[data-scale]', (b) => `timeline-scale-${b.dataset.scale}`],
  ['#battery-range [data-range]', (b) => `battery-range-${b.dataset.range}`],
  ['#members-toggle', 'records-sources-edit'],
  ['#origin-toggle', 'battery-origins-run'],
  ['.next-ch', (b) => `chapter-next-${b.dataset.next.replace('chapter-', '')}`],
];
const CHANGES = [
  ['#preset', (el) => `records-measure-${el.value}`],
  ['#thresholds', 'records-thresholds-edit'],
  ['#members', 'records-sources-change'],
  ['#battery-source', (el) => `battery-source-${el.value}`],
];
const SECTIONS = { 'now-h': 'now', 'records-h': 'records', 'story-h': 'story', 'about-h': 'about' };
const ENGAGED = [[30, '30s'], [120, '2m'], [300, '5m'], [900, '15m']];

function handle(rules, e) {
  for (const [sel, name] of rules) {
    const el = e.target.closest?.(sel);
    if (el) track(typeof name === 'function' ? name(el) : name);
  }
}

function wire() {
  document.addEventListener('click', (e) => {
    handle(CLICKS, e);
    const a = e.target.closest?.('a[href]');
    if (a && a.host && a.host !== location.host) track(`outbound-${a.host.replace(/^www\./, '')}`, `Outbound: ${a.href}`);
  });
  document.addEventListener('change', (e) => handle(CHANGES, e));
  // <details> toggle events don't bubble, so listen in the capture phase.
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.open || d.tagName !== 'DETAILS') return;
    if (d.classList.contains('chapter')) track(`chapter-open-${d.id.replace('chapter-', '')}`);
    else track(`details-open-${slug(d.querySelector('summary')?.textContent)}`);
  }, true);

  // Chapter 1 starts open, so it counts as opened.
  if (document.getElementById('chapter-1')?.open) track('chapter-open-1');

  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) track(`section-seen-${SECTIONS[en.target.id]}`);
  });
  for (const id of Object.keys(SECTIONS)) {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  }

  const onScroll = () => {
    const doc = document.documentElement;
    for (const m of depthMilestones(scrollY + innerHeight, doc.scrollHeight)) track(`scroll-${m}`);
  };
  addEventListener('scroll', onScroll, { passive: true });

  // Engaged time: seconds the tab is visible, sampled every 5 seconds.
  let seconds = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    seconds += 5;
    for (const [s, label] of ENGAGED) if (seconds >= s) track(`engaged-${label}`);
  }, 5000);

  // Arrived on a link carrying records settings, which only happens when
  // someone copies the address after using the records tool.
  if (location.hash.length > 1) track('arrive-shared-settings');
}

const slug = (s = '') => s.toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function startAnalytics() {
  if (!GOATCOUNTER) return;
  // count.js reads these settings when it loads, and skips localhost itself.
  window.goatcounter = { path: (p) => pagePath(p) };
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER}.goatcounter.com/count`;
  s.onload = () => { while (queue.length) window.goatcounter.count(queue.shift()); };
  document.head.appendChild(s);
  wire();
}
