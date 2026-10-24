// Calendar boundaries in a country's own time zone, so years and days start
// at local midnight. Intl is slow, so callers work out boundaries once and
// compare slot times against them rather than formatting every slot.

const formatters = new Map();
function parts(ms, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(ms).map(({ type, value }) => [type, Number(value)]));
  return p;
}

/** Local time minus UTC, in ms, at the instant ms. */
export function tzOffsetMs(ms, timeZone = 'UTC') {
  if (timeZone === 'UTC') return 0;
  const p = parts(ms, timeZone);
  const minute = Math.floor(ms / 60000) * 60000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - minute;
}

/** The UTC instant of local midnight starting the given day (month 0-based). */
export function localMidnight(year, month, day, timeZone = 'UTC') {
  const wall = Date.UTC(year, month, day);
  let t = wall - tzOffsetMs(wall, timeZone);
  t = wall - tzOffsetMs(t, timeZone);
  return t;
}

export const yearStart = (year, timeZone = 'UTC') => localMidnight(year, 0, 1, timeZone);

/** Local calendar year of an instant. */
export const localYear = (ms, timeZone = 'UTC') => new Date(ms + tzOffsetMs(ms, timeZone)).getUTCFullYear();

/** "YYYY-MM-DD" of an instant in local time. */
export function localDate(ms, timeZone = 'UTC') {
  return new Date(ms + tzOffsetMs(ms, timeZone)).toISOString().slice(0, 10);
}
