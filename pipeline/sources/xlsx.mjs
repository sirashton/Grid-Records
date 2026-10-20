// A small reader for .xlsx workbooks: unzips with the system unzip and reads
// the sheet XML, which is all the ERCOT fuel mix files need. Cells come back
// as numbers or strings; dates stay as Excel serial numbers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const part = async (file, name) => {
  try {
    return (await exec('unzip', ['-p', file, name], { maxBuffer: 1 << 30, encoding: 'utf8' })).stdout;
  } catch {
    return '';
  }
};

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Column letters to a 0-based index: A is 0, AA is 26. */
export function colIndex(ref) {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

export function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

/** Rows of a sheet's XML as arrays of cells. */
export function parseSheet(xml, strings) {
  const rows = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, body = ''] = c;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      let v;
      if (type === 'inlineStr') v = unescape((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1] ?? '');
      else {
        const raw = (body.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1];
        if (raw == null) continue;
        v = type === 's' ? strings[Number(raw)] : type === 'str' ? unescape(raw) : Number(raw);
      }
      row[colIndex(ref)] = v;
    }
    rows.push(row);
  }
  return rows;
}

/** The sheet names of a workbook, in order, with their XML paths. */
export async function sheets(file) {
  const wb = await part(file, 'xl/workbook.xml');
  const rels = await part(file, 'xl/_rels/workbook.xml.rels');
  const target = Object.fromEntries([...rels.matchAll(/<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  // Some writers put Target before Id.
  for (const m of rels.matchAll(/<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g)) target[m[2]] ??= m[1];
  return [...wb.matchAll(/<sheet [^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map((m) => ({
    name: unescape(m[1]),
    path: `xl/${target[m[2]].replace(/^\/?xl\//, '')}`,
  }));
}

/** Every sheet of a workbook as { name, rows }. */
export async function readWorkbook(file, { only } = {}) {
  const strings = parseSharedStrings(await part(file, 'xl/sharedStrings.xml'));
  const out = [];
  for (const s of await sheets(file)) {
    if (only && !only(s.name)) continue;
    out.push({ name: s.name, rows: parseSheet(await part(file, s.path), strings) });
  }
  return out;
}

/** Excel serial date (1900 system) to UTC milliseconds of that wall-clock time. */
export const serialToMs = (n) => Math.round((n - 25569) * 864e5);
