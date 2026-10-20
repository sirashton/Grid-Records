// The Live records page: every country in site/js/countries/index.js, checked
// for spells still running that are already records or closing in on one.
import { COUNTRIES } from '../countries/index.js';
import { loadData, dataEnd } from '../core/dataset.js';
import { liveRecords, freshness, behindText, thresholdText } from '../core/live-records.js';
import { formatDuration } from '../records.js';
import { startAnalytics } from '../analytics.js';

const $ = (id) => document.getElementById(id);
const ROOT = '../';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Let the browser paint between countries: each takes most of a second.
const idle = () => new Promise((r) => setTimeout(r, 0));

const whenFmt = (country) => new Intl.DateTimeFormat('en-GB', { timeZone: country.timeZone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function shell({ country, flag }) {
  const el = document.createElement('section');
  el.className = 'card live-country';
  el.id = `live-${country.code}`;
  el.setAttribute('aria-labelledby', `live-${country.code}-h`);
  el.innerHTML = `<div class="live-head">
      <h2 id="live-${country.code}-h"><img src="${ROOT}${flag}" alt="" width="36" height="18">${esc(country.name)}</h2>
      <span class="live-badge" data-state="loading">Loading</span>
    </div>
    <p class="updated live-when">Loading the generation data.</p>
    <div class="live-body"></div>`;
  return el;
}

// The country page's Records card set to this measure and threshold.
const recordsLink = (entry, c) => `${ROOT}${entry.page}#${new URLSearchParams({ m: c.preset, d: c.mode, u: c.unit, t: c.threshold })}`;

function itemHtml(entry, c) {
  const dur = (slots) => formatDuration(slots, c.stepMinutes);
  const what = esc(thresholdText(c, entry.country));
  const link = `<a href="${recordsLink(entry, c)}">See the record</a>`;
  if (c.status === 'record' || c.status === 'streak') {
    const was = c.recordSlots ? `The previous record was ${dur(c.recordSlots)}.` : 'The first spell like it on record.';
    return `<li class="live-item" data-status="${c.status}"><div class="live-what"><b>${what}</b> for <b class="v">${dur(c.slots)}</b> and counting.</div>
      <div class="live-sub">${was} ${link}</div></li>`;
  }
  const share = Math.min(c.ratio, 1);
  const bar = `<span class="live-bar" role="img" aria-label="${Math.round(share * 100)}% of the record"><span style="width:${(share * 100).toFixed(1)}%"></span></span>`;
  if (c.status === 'close') {
    return `<li class="live-item" data-status="close"><div class="live-what"><b>${what}</b> for <b class="v">${dur(c.slots)}</b> and counting.</div>
      ${bar}<div class="live-sub">${dur(c.recordSlots - c.slots)} more beats the record of ${dur(c.recordSlots)}. ${link}</div></li>`;
  }
  return `<li class="live-item" data-status="nearest"><div class="live-what">Closest: <b>${what}</b> for <b class="v">${dur(c.slots)}</b>.</div>
    ${bar}<div class="live-sub">${Math.round(c.ratio * 100)}% of the record of ${dur(c.recordSlots)}. ${link}</div></li>`;
}

function render(el, entry, data) {
  const { country } = entry;
  const end = dataEnd(data, country);
  const fresh = freshness(data, country, end);
  const r = liveRecords(data, country, { end });
  const badge = el.querySelector('.live-badge');
  badge.dataset.state = fresh.live ? 'live' : 'latest';
  badge.textContent = fresh.live ? 'Live' : 'Latest data';
  const to = whenFmt(country).format(fresh.endMs);
  el.querySelector('.live-when').textContent = fresh.live
    ? `Data to ${to}, local time, ${behindText(fresh.behindMs)} ago.`
    : `Data to ${to}, local time: ${behindText(fresh.behindMs)} behind. Spells shown were running then and may have ended since.`;
  const list = (items) => `<ul class="live-list">${items.map((c) => itemHtml(entry, c)).join('')}</ul>`;
  let html = '';
  if (r.breaking.length) html += `<h3>Breaking a record</h3>${list(r.breaking)}`;
  if (r.close.length) html += `<h3>Closing in on a record</h3>${list(r.close)}`;
  if (!r.breaking.length && !r.close.length) {
    html += `<p class="live-none">Nothing is close to a record ${fresh.live ? 'right now' : 'in the latest data'}.</p>`;
    if (r.nearest) html += list([r.nearest]);
  }
  if (r.streaks.length) {
    html += `<details class="live-streaks"${r.breaking.length || r.close.length ? '' : ' open'}><summary>Long-running streaks (${r.streaks.length})</summary>${list(r.streaks)}</details>`;
  }
  el.querySelector('.live-body').innerHTML = html;
  return { entry, fresh, r };
}

function fail(el) {
  const badge = el.querySelector('.live-badge');
  badge.dataset.state = 'error';
  badge.textContent = 'Unavailable';
  el.querySelector('.live-when').textContent = 'The data could not be loaded. Please try again shortly.';
}

// Answer first: how many records are falling, and where.
function summary(results) {
  const names = (list) => list.map((x) => x.entry.country.name);
  const join = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0]);
  const breaking = results.filter((x) => x.r.breaking.length);
  const close = results.filter((x) => !x.r.breaking.length && x.r.close.length);
  const n = breaking.reduce((s, x) => s + x.r.breaking.length, 0);
  const parts = [];
  if (n) parts.push(`${n} record${n === 1 ? ' is' : 's are'} being broken, in ${join(names(breaking))}.`);
  else parts.push('No record is being broken right now.');
  if (close.length) parts.push(`${join(names(close))} ${close.length === 1 ? 'has' : 'have'} a spell closing in on one.`);
  return parts.join(' ');
}

async function main() {
  startAnalytics();
  const host = $('live-countries');
  const els = COUNTRIES.map((entry) => host.appendChild(shell(entry)));
  // Fetch every country at once, then work through them in order.
  const loads = COUNTRIES.map((entry) => loadData(`${ROOT}${entry.data}`).catch(() => null));
  const results = [];
  for (const [i, entry] of COUNTRIES.entries()) {
    const data = await loads[i];
    if (!data) { fail(els[i]); continue; }
    await idle();
    try {
      results.push(render(els[i], entry, data));
    } catch (e) {
      console.error(e);
      fail(els[i]);
    }
  }
  $('answer-lead').textContent = summary(results);
  const live = results.filter((x) => x.fresh.live).length;
  $('updated').textContent = `${live} of ${COUNTRIES.length} countries live. Checked ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(Date.now())} your time.`;
}

main();
