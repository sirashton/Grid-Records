// The header mark shared by every country page: four years of the fuel mix
// as 100% stacked rows, fossil on the left. The rows build once, the dashed
// "lowest fossil share" line hops to the newest row, then it all stays still.
// Any page with <svg class="hero-art"> gets it; the styles live in style.css.

// Each row is [fuel class, width] pairs filling 120 units from the left.
const ROWS = [
  [['coal', 26.4], ['gas', 50.4], ['wind', 21.6], ['solar', 14.4], ['nuclear', 7.2]],
  [['coal', 12], ['gas', 48], ['wind', 21.6], ['solar', 26.4], ['nuclear', 9.6], ['battery', 2.4]],
  [['gas', 45.6], ['wind', 20.4], ['solar', 33.6], ['nuclear', 13.2], ['battery', 7.2]],
  [['gas', 26.4], ['wind', 19.2], ['solar', 48], ['nuclear', 15.6], ['battery', 10.8]],
];
const LEFT = 50, TOP = 26, GAP = 30, HEIGHT = 22;

function rowMarkup(row, i) {
  const y = TOP + i * GAP;
  let x = LEFT;
  const segs = row.map(([fuel, w]) => {
    const seg = `<rect class="seg ${fuel}" x="${x}" y="${y}" width="${w}" height="${HEIGHT}"/>`;
    x += w;
    return seg;
  }).join('');
  return `<g class="row r${i}">${segs}<rect class="outline" x="${LEFT}" y="${y}" width="120" height="${HEIGHT}"/></g>`;
}

export const MARK = `
  <rect class="shadow" x="50" y="20" width="128" height="128"/>
  <rect class="paper" x="46" y="16" width="128" height="128"/>
  ${ROWS.map(rowMarkup).join('')}
  <g class="marker"><line x1="95.6" y1="22" x2="95.6" y2="140"/><rect class="pole" x="89.6" y="18" width="12" height="8"/></g>
  <rect class="frame" x="46" y="16" width="128" height="128"/>`;

for (const svg of document.querySelectorAll('svg.hero-art')) {
  svg.setAttribute('viewBox', '0 0 220 160');
  svg.innerHTML = MARK;
}
