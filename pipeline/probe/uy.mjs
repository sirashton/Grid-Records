// Probe ADME's generation-by-source form: what the error says.
const get = async (url) => { const r = await fetch(url); return { status: r.status, text: Buffer.from(await r.arrayBuffer()).toString('latin1') }; };
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const qs = [
  'fecha_ini=20/10/2026&fecha_fin=22/10/2026&send=MOSTRAR',
  'fecha_ini=20/10/2026&fecha_fin=22/10/2026',
  'fecha_ini=20%2F10%2F2026&fecha_fin=22%2F10%2F2026&send=MOSTRAR',
  'fecha_ini=01/01/2015&fecha_fin=03/01/2015',
  'fecha_ini=01/01/2025&fecha_fin=31/01/2025',
  'fecha_ini=01/01/2025&fecha_fin=31/03/2025',
];
for (const q of qs) {
  const r = await get(`https://pronos.adme.com.uy/gpf.php?${q}`);
  const links = [...r.text.matchAll(/cache\/gpf_\d+_\d+_horario\.ods/g)].map((m) => m[0]);
  console.log('Q', q, r.status, links.join(' '), '|', text(r.text).slice(0, 400));
}
