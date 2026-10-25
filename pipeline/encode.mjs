// Packs columns of half-hourly MW values into a compact binary file.
//
// Layout: for each column in order, `length` little-endian Int16 values. The
// first value is the MW reading; each later value is the change from the
// previous slot (delta encoding keeps the gzipped file small). Missing slots
// carry the previous value forward and are listed as [start, count] runs in
// the metadata, so the decoder can restore them as NaN. A column whose first
// value is too big for Int16 (over 32.7 GW) starts from a `base` in the
// metadata instead of zero, and a column whose changes are too big for Int16
// is stored in units of `scale` MW, also in the metadata. A missing slot's stored value is thrown away by
// the decoder, so across a gap the stored value walks toward the next real
// reading in steps that fit Int16, rather than jumping all at once.
import { gzipSync, gunzipSync } from 'node:zlib';

export function encodeColumns(columns, length) {
  const names = Object.keys(columns);
  const buf = new Int16Array(names.length * length);
  const missing = {};
  const base = {};
  const scale = {};
  const present = (v) => v !== undefined && !Number.isNaN(v);
  names.forEach((name, c) => {
    const col = columns[name];
    const runs = [];
    // A column whose real hour-to-hour changes outgrow Int16 (the US's gas
    // fleet ramps more than 32.7 GW in an hour) is stored in units of a few MW.
    let biggest = 0;
    let last = null;
    for (let i = 0; i < length; i++) {
      if (!present(col[i])) continue;
      if (last !== null) biggest = Math.max(biggest, Math.abs(Math.round(col[i]) - last));
      last = Math.round(col[i]);
    }
    const unit = SCALES.find((k) => biggest / k <= 32000) ?? SCALES.at(-1);
    if (unit > 1) scale[name] = unit;
    let first = 0;
    for (let i = 0; i < length; i++) if (present(col[i])) { first = Math.round(col[i] / unit); break; }
    if (Math.abs(first) > 32767) base[name] = first * unit;
    let prev = first === 0 || Math.abs(first) <= 32767 ? 0 : first;
    let next = null;
    for (let i = 0; i < length; i++) {
      let v = present(col[i]) ? Math.round(col[i] / unit) : null;
      if (v === null) {
        if (runs.length && runs.at(-1)[0] + runs.at(-1)[1] === i) runs.at(-1)[1]++;
        else {
          runs.push([i, 1]);
          next = prev;
          for (let j = i + 1; j < length; j++) if (present(col[j])) { next = Math.round(col[j] / unit); break; }
        }
        v = prev + Math.max(-32767, Math.min(32767, next - prev));
      }
      const delta = v - prev;
      if (delta < -32767 || delta > 32767) throw new Error(`${name}[${i}] change ${delta * unit} does not fit Int16`);
      buf[c * length + i] = delta;
      prev = v;
    }
    missing[name] = runs;
  });
  return { names, missing, base, scale, gz: gzipSync(Buffer.from(buf.buffer), { level: 9 }) };
}

const SCALES = [1, 2, 4, 5, 10, 20, 50, 100];

/** Mirror of the browser decoder, used by the tests. */
export function decodeColumns(gz, names, length, missing, base = {}, scale = {}) {
  const raw = gunzipSync(gz);
  const buf = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  const out = {};
  names.forEach((name, c) => {
    const col = new Float64Array(length);
    const unit = scale[name] ?? 1;
    let acc = (base[name] ?? 0) / unit;
    for (let i = 0; i < length; i++) {
      acc += buf[c * length + i];
      col[i] = acc * unit;
    }
    for (const [s, n] of missing[name] ?? []) col.fill(NaN, s, s + n);
    out[name] = col;
  });
  return out;
}
