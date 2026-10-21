// Temporary: what Taipower's open data looks like from Actions.
const get = async (url, n = 1500) => {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' } });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log('\n==', url, r.status, r.headers.get('content-type'), buf.length);
    console.log(buf.subarray(0, n).toString('utf8'));
    return buf;
  } catch (e) { console.log('\n==', url, 'ERR', e.message); }
};
for (const id of ['37331', '8931']) {
  const b = await get(`https://data.gov.tw/api/v2/rest/dataset/${id}`, 6000);
}
await get('https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/genary.json', 3000);
await get('https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/loadpara.json', 1500);
await get('https://www.taipower.com.tw/d006/loadGraph/loadGraph/data/genloadareaperc.csv', 1500);
await get('https://data.taipower.com.tw/opendata/apply/file/d006001/001.json', 2000);
await get('https://www.taipower.com.tw/tc/page.aspx?mid=206', 800);
