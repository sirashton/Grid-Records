// The "Right now" panel shared by the GB and NZ pages: a row per fuel group
// and fuel on the left, a donut of the mix in the middle, and the page's own
// rows (records, batteries) on the right. Each page passes its groups, its
// "?" texts and its records; the drawing, hover and easing live here.

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const fmtGw = (v) => (Number.isFinite(v) ? (v / 1000).toFixed(2) : '—');
export const num = (v, unit = 'GW') => `<span class="num">${v}<small>${unit}</small></span>`;

/** A "?" button for a row, if the page has a description for it. */
export const infoButton = (texts) => (key) => (texts[key] ? `<button type="button" class="info" data-tip="${texts[key].replace(/"/g, '&quot;')}" aria-label="About ${key}">?</button>` : '');

// A coloured square with the window's trace drawn across it, as on Kate's site.
export function sparkTile(values, color, span) {
  const fin = (values ?? []).filter(Number.isFinite);
  let line = '';
  if (fin.length >= 2) {
    const lo = Math.min(0, ...fin);
    const hi = Math.max(...fin, lo + 1);
    const pts = values.map((v, k) => (Number.isFinite(v) ? `${((k / (values.length - 1)) * 40).toFixed(1)},${(26 - ((v - lo) / (hi - lo)) * 20).toFixed(1)}` : null)).filter(Boolean).join(' ');
    line = `<polyline points="${pts}" fill="none" stroke="var(--line)" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  const tip = fin.length >= 2 ? ` data-tip="${span}: ${(Math.min(...fin) / 1000).toFixed(2)} to ${(Math.max(...fin) / 1000).toFixed(2)} GW"` : '';
  return `<svg class="spark" viewBox="0 0 40 28" aria-hidden="true" style="background:var(${color})"${tip}>${line}</svg>`;
}

export function donut(groups, total, sub = '') {
  const size = 260;
  const c = size / 2;
  const arc = (r0, r1, a0, a1) => {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
    const p = (r, a) => `${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
  };
  let inner = '';
  let outer = '';
  let a = 0;
  for (const g of groups) {
    const ga = a;
    for (const f of g.fuels) {
      const span = (f.now / total) * Math.PI * 2;
      if (span > 0) outer += `<path d="${arc(94, 118, a, a + span)}" fill="${css(f.color)}" data-key="${f.label}" data-group="${g.label}"></path>`;
      a += span;
    }
    if (a > ga) inner += `<path d="${arc(66, 92, ga, a)}" fill="${css(g.color)}" data-key="${g.label}"></path>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Current generation mix"><circle class="disc" cx="${c}" cy="${c}" r="128"/>${outer}${inner}
    <text x="${c}" y="${c - 14}" text-anchor="middle" class="donut-label">Generation</text>
    <text x="${c}" y="${c + 12}" text-anchor="middle" class="donut-value">${(total / 1000).toFixed(1)} GW</text>
    <text x="${c}" y="${c + 32}" text-anchor="middle" class="donut-sub">${sub}</text></svg>`;
}

// The left half of the panel: a band per group, then a row per fuel.
// Non-finite values show as dashes, which is how the loading placeholder
// reserves the panel's exact height.
export function nowLeftHtml(groups, total, info, span) {
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  return groups.map((g) => `
    <div class="nr head" style="--tint: var(${g.color})" data-key="${g.label}"><span></span>${num(fmtGw(g.now))}<span class="num">${pc(g.now)}</span><span class="lbl">${g.label}${info(g.label)}</span></div>
    ${g.fuels.map((f) => `<div class="nr" data-key="${f.label}" data-group="${g.label}" style="--tint: var(${f.color})">${sparkTile(f.series, f.color, span)}${num(fmtGw(f.value))}<span class="num">${pc(f.now)}</span><span class="lbl">${f.label}${info(f.label)}</span></div>`).join('')}`).join('');
}

// Widest each line of the donut's centre text can be (in its 260-unit
// viewBox) and stay inside the inner ring; longer text is scaled down.
const DONUT_TEXT_WIDTH = { 'donut-label': 112, 'donut-value': 118, 'donut-sub': 104 };
export function fitDonutText() {
  for (const [cls, max] of Object.entries(DONUT_TEXT_WIDTH)) {
    const t = document.querySelector(`#now-donut .${cls}`);
    if (!t) continue;
    t.style.fontSize = '';
    const w = t.getComputedTextLength();
    if (w > max) t.style.fontSize = `${parseFloat(getComputedStyle(t).fontSize) * (max / w)}px`;
  }
}

// Hovering a row or a donut segment highlights its partners and shows its
// figures in the middle of the donut; "?" buttons and record rows show a tip.
// figures() returns { total, sub, [label]: { now } } for what is on screen.
export function setupNowHover(figures) {
  const panel = document.querySelector('.now-panel');
  const tip = document.createElement('div');
  tip.className = 'now-tip';
  tip.hidden = true;
  panel.append(tip);
  const showTip = (el) => {
    const text = el?.dataset.tip;
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left - p.left + r.width / 2 - tip.offsetWidth / 2), p.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${r.bottom - p.top + 6}px`;
  };
  const highlight = (key) => {
    panel.classList.toggle('hovering', !!key);
    for (const el of panel.querySelectorAll('[data-key]')) {
      el.classList.toggle('hl', !!key && (el.dataset.key === key || el.dataset.group === key));
    }
    const label = panel.querySelector('.donut-label');
    const value = panel.querySelector('.donut-value');
    const sub = panel.querySelector('.donut-sub');
    const figs = figures();
    if (!label || !figs.total) return;
    const f = key && figs[key];
    label.textContent = f ? key : 'Generation';
    value.textContent = `${((f ? f.now : figs.total) / 1000).toFixed(2)} GW`;
    sub.textContent = f ? `${((f.now / figs.total) * 100).toFixed(1)}% of total` : figs.sub;
    fitDonutText();
  };
  const over = (e) => {
    highlight(e.target.closest('[data-key]')?.dataset.key);
    showTip(e.target.closest('[data-tip]'));
  };
  panel.addEventListener('mouseover', over);
  panel.addEventListener('focusin', over);
  panel.addEventListener('click', (e) => { if (e.target.closest('.info')) showTip(e.target.closest('.info')); });
  panel.addEventListener('mouseleave', () => { highlight(null); tip.hidden = true; });
  panel.addEventListener('focusout', (e) => { if (!panel.contains(e.relatedTarget)) { highlight(null); tip.hidden = true; } });
}

// Like Kate's site, the tab icon is a pie of the generation mix.
export function liveFavicon(groups, total) {
  const c = 32;
  const r = 29;
  let a = 0;
  let slices = '';
  for (const g of groups) {
    for (const f of g.fuels) {
      const span = (f.now / total) * Math.PI * 2;
      if (!(span > 0)) continue;
      const p = (t) => `${(c + r * Math.sin(t)).toFixed(2)},${(c - r * Math.cos(t)).toFixed(2)}`;
      slices += span >= Math.PI * 2 - 1e-6
        ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${css(f.color)}"/>`
        : `<path d="M${c},${c}L${p(a)}A${r},${r} 0 ${span > Math.PI ? 1 : 0} 1 ${p(a + span)}Z" fill="${css(f.color)}"/>`;
      a += span;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${slices}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css('--line')}" stroke-width="4"/></svg>`;
  document.querySelector('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Mean of fn(k) over the n slots ending at end, and a sparkline of up to 48 bucket means over max(n, 48) slots. */
export function windowFigures(fn, end, n) {
  const mean = (a, b) => {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, a); k <= b; k++) {
      const v = fn(k);
      if (Number.isFinite(v)) { sum += v; cnt++; }
    }
    return cnt ? sum / cnt : NaN;
  };
  const span = Math.max(n, 48);
  const step = span / 48;
  const series = Array.from({ length: 48 }, (_, b) => (step === 1 ? fn(end - 47 + b) : mean(Math.round(end - span + 1 + b * step), Math.round(end - span + (b + 1) * step))));
  return { value: n === 1 ? fn(end) : mean(end - n + 1, end), series };
}

/** Each group's and fuel's figures over the n slots ending at slot i. */
export function groupFigures(groupDefs, columns, i, n) {
  const groups = groupDefs.map((g) => {
    const fuels = g.fuels.map((f) => {
      const { value, series } = windowFigures((k) => f.cols.reduce((sum, col) => sum + (columns[col]?.[k] ?? 0), 0), i, n);
      return { ...f, value, now: Math.max(0, value), series };
    });
    return { ...g, fuels, now: fuels.reduce((s, f) => s + f.now, 0) };
  });
  return { groups, total: groups.reduce((s, g) => s + g.now, 0) };
}

/** Lookup of what the hover shows: the total and each group and fuel by label. */
export function hoverFigures({ groups, total }, sub, span) {
  const figs = { total, sub, span };
  for (const g of groups) {
    figs[g.label] = g;
    for (const f of g.fuels) figs[f.label] = f;
  }
  return figs;
}

// Switching time frame eases every figure, and so every donut segment, from
// its old value to its new one. batKeys are the extra numbers in figs.bat;
// done() runs once the last frame is drawn.
let tweenId = 0;
export function tweenFigures(from, to, draw, { batKeys = [], done = () => {} } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { draw(to); done(); return; }
  const id = ++tweenId;
  const lerp = (a, b, t) => (Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : b);
  const start = performance.now();
  const step = (now) => {
    if (id !== tweenId) return;
    const p = Math.min(1, (now - start) / 600);
    const t = 1 - (1 - p) ** 3;
    const groups = to.groups.map((g, gi) => {
      const fuels = g.fuels.map((f, fi) => {
        const o = from.groups[gi].fuels[fi];
        return { ...f, value: lerp(o.value, f.value, t), now: lerp(o.now, f.now, t) };
      });
      return { ...g, fuels, now: fuels.reduce((sum, f) => sum + f.now, 0) };
    });
    const bat = { ...to.bat };
    for (const k of batKeys) bat[k] = lerp(from.bat?.[k], to.bat?.[k], t);
    draw({ groups, total: groups.reduce((sum, g) => sum + g.now, 0), bat });
    if (p < 1) requestAnimationFrame(step);
    else done();
  };
  requestAnimationFrame(step);
}
