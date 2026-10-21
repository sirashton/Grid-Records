// Temporary: how much history Taipower's unit files hold, from Actions.
const UA = { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' };
const get = async (url) => {
  try {
    const r = await fetch(url, { headers: UA });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log('\n==', url, r.status, r.headers.get('content-type'), buf.length, r.headers.get('last-modified'));
    return { status: r.status, buf };
  } catch (e) { console.log('\n==', url, 'ERR', e.message, e.cause?.code); return {}; }
};
const hist = await get('https://service.taipower.com.tw/data/opendata/apply/file/d006010/001.json');
if (hist.buf) {
  const txt = hist.buf.toString('utf8');
  console.log(txt.slice(0, 1200));
  try {
    let j = JSON.parse(txt.replace(/^﻿/, ''));
    const rows = Array.isArray(j) ? j : (j.records || j.result?.records || Object.values(j).find(Array.isArray));
    console.log('keys', Object.keys(j).slice(0, 10), 'rows', rows?.length);
    if (rows) {
      const dts = rows.map((r) => r.DATETIME).filter(Boolean).sort();
      console.log('first', dts[0], 'last', dts[dts.length - 1]);
      const fuels = {}; for (const r of rows) fuels[r.FUEL_TYPE] = (fuels[r.FUEL_TYPE] || 0) + 1;
      console.log('fuels', JSON.stringify(fuels));
      const units = new Set(rows.map((r) => r.UNIT_NAME)); console.log('units', units.size);
      const times = new Set(dts); console.log('distinct times', times.size, [...times].slice(0, 5));
    }
  } catch (e) { console.log('parse', e.message); }
}
const live = await get('https://service.taipower.com.tw/data/opendata/apply/file/d006001/001.json');
if (live.buf) console.log(live.buf.toString('utf8').slice(0, 1500));
for (const p of ['d006010/002.json', 'd006010/001.csv', 'd006010/', 'd006011/001.json', 'd006009/001.json', 'd006012/001.json', 'd006002/001.json', 'd006003/001.json', 'd006004/001.json', 'd006005/001.json', 'd006006/001.json', 'd006007/001.json', 'd006008/001.json']) {
  const r = await get('https://service.taipower.com.tw/data/opendata/apply/file/' + p);
  if (r.buf) console.log(r.buf.subarray(0, 400).toString('utf8'));
}
// Other datasets that might hold long history.
for (const q of ['台灣電力公司 過去電力供需資訊', '台電 發電量 每小時', '台電 各能源別 發電量']) {
  const r = await get('https://data.gov.tw/api/v2/rest/dataset?q=' + encodeURIComponent(q) + '&limit=20');
  if (r.buf) { try { const j = JSON.parse(r.buf.toString()); for (const d of j.result || []) console.log(d.datasetId || d.identifier, d.title); } catch { console.log(r.buf.subarray(0, 500).toString()); } }
}
