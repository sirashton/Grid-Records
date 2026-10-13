// Shared helpers for the data pipeline.

export const SLOT_MS = 30 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Fetches a URL with retries and exponential backoff. */
export async function fetchText(url, { retries = 4, timeoutMs = 120000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'grid-records (+https://github.com/sirashton/Grid-Records)' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
  throw lastError;
}

export async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  return text == null ? null : JSON.parse(text);
}

/** Rounds a time down to the start of its half-hour slot. */
export const slotStart = (ms) => Math.floor(ms / SLOT_MS) * SLOT_MS;

/** Midnight UTC of the day containing ms. */
export const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Parses an ISO-ish timestamp as UTC, adding Z when no zone is given. */
export function parseUtc(s) {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

export const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
