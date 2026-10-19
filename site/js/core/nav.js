// The country switch at the top of every page, as HTML. `page` is the page's
// path from the site root ('' for GB, 'de/'); links are made relative to it,
// and the matching country is marked as the current page. The Live records
// button comes last.

export function navHtml(countries, page) {
  const root = '../'.repeat(page.split('/').filter(Boolean).length);
  const items = countries.map((c) => {
    const label = c.nav ?? c.country.name;
    const inner = `<img src="${root}${c.flag}" alt="" width="30" height="15">${label}`;
    if (c.page === page) return `<span aria-current="page">${inner}</span>`;
    return `<a href="${root + c.page || './'}">${inner}</a>`;
  });
  // Live records (site/live/) closes every switch.
  const live = '<i class="live-dot" aria-hidden="true"></i>Live records';
  items.push(page === 'live/' ? `<span class="live-link" aria-current="page">${live}</span>` : `<a class="live-link" href="${root}live/">${live}</a>`);
  return `<nav class="region-nav" aria-label="Country">${items.join('')}</nav>`;
}
