// Packs columns of half-hourly MW values into a compact binary file.
//
// Layout: for each column in order, `length` little-endian Int16 values. The
// first value is the MW reading; each later value is the change from the
// previous slot (delta encoding keeps the gzipped file small). Missing slots
// carry the previous value forward and are listed as [start, count] runs in
// the metadata, so the decoder can restore them as NaN. A column whose first
// value is too big for Int16 (over 32.7 GW) starts from a `base` in the
// metadata instead of zero.
import { gzipSync, gunzipSync } from 'node:zlib';

export function encodeColumns(columns, length) {
  const names = Object.keys(columns);
  const buf = new Int16Array(names.length * length);
  const missing = {};
  const base = {};
  names.forEach((name, c) => {
    const col = columns[name];
    const runs = [];
    let first = 0;
    for (let i = 0; i < length; i++) if (!Number.isNaN(col[i]) && col[i] !== undefined) { first = Math.round(col[i]); break; }
    if (Math.abs(first) > 32767) base[name] = first;
    let prev = base[name] ?? 0;
    for (let i = 0; i < length; i++) {
      let v = col[i];
      if (v === undefined || Number.isNaN(v)) {
        if (runs.length && runs.at(-1)[0] + runs.at(-1)[1] === i) runs.at(-1)[1]++;
        else runs.push([i, 1]);
        v = prev;
      }
      const mw = Math.round(v);
      const delta = mw - prev;
      if (delta < -32767 || delta > 32767) throw new Error(`${name}[${i}] change ${delta} does not fit Int16`);
      buf[c * length + i] = delta;
      prev = mw;
    }
    missing[name] = runs;
  });
  return { names, missing, base, gz: gzipSync(Buffer.from(buf.buffer), { level: 9 }) };
}

/** Mirror of the browser decoder, used by the tests. */
export function decodeColumns(gz, names, length, missing, base = {}) {
  const raw = gunzipSync(gz);
  const buf = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const out = {};
  names.forEach((name, c) => {
    const col = new Float64Array(length);
    let acc = base[name] ?? 0;
    for (let i = 0; i < length; i++) {
      acc += buf[c * length + i];
      col[i] = acc;
    }
    for (const [s, n] of missing[name] ?? []) col.fill(NaN, s, s + n);
    out[name] = col;
  });
  return out;
}
