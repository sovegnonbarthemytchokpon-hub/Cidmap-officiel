/*
 * Daily publication cache (localStorage, one key per programme day).
 *
 * The daily publication is produced once, at the 16:00 GMT generation
 * boundary, and never changes afterwards. Re-reading it from the database on
 * every reload, route change or background timer only saturated the server.
 *
 * The contract is deliberately strict:
 *
 *   1. Before any network read, the browser looks for the key of the day
 *      (`cidgroup.publication.<channel>.<YYYY-MM-DD>`).
 *   2. Key present  -> the local payload is used and NO request is sent.
 *   3. Key missing  -> exactly one request is allowed (concurrent callers
 *      share the same promise). The payload is stored under the key of the
 *      day as soon as the response succeeds.
 *
 * There is no timer here. A new day simply produces a new key, so the first
 * visit after 16:00 GMT is what triggers the single check. Keys from previous
 * days are pruned on write so storage never grows without bound.
 */

const PREFIX = 'cidgroup.publication.';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEEP_DAYS = 2;
const inFlight = new Map();

function safeChannel(channel) {
  return String(channel || 'default').trim().replace(/[^A-Za-z0-9_-]/g, '_') || 'default';
}

function isoDay(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  const day = String(value ?? '').slice(0, 10);
  return ISO_DATE.test(day) ? day : '';
}

export function dailyPublicationKey(channel, day) {
  const date = isoDay(day);
  return date ? `${PREFIX}${safeChannel(channel)}.${date}` : '';
}

export function readDailyPublication(channel, day) {
  const key = dailyPublicationKey(channel, day);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload && payload.data != null ? payload.data : null;
  } catch (_) {
    // Corrupted value: drop it so the next visit performs one clean read.
    try { localStorage.removeItem(key); } catch (__) {}
    return null;
  }
}

function pruneChannel(channel, keepKey) {
  const prefix = `${PREFIX}${safeChannel(channel)}.`;
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix) && key !== keepKey) keys.push(key);
    }
    keys.sort().reverse().slice(KEEP_DAYS - 1).forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}

export function writeDailyPublication(channel, day, data) {
  const key = dailyPublicationKey(channel, day);
  if (!key || data == null) return false;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), data }));
    pruneChannel(channel, key);
    return true;
  } catch (_) {
    // Quota or private browsing: the live result is still displayed.
    return false;
  }
}

/*
 * Cache-first accessor. `fetcher` is only called when the key of the day is
 * missing, and at most once at a time per channel/day. A null/undefined
 * result (not published yet, network error) is never stored, so the next
 * user visit can try again — but nothing here retries on its own.
 */
export async function getDailyPublication(channel, day, fetcher) {
  const cached = readDailyPublication(channel, day);
  if (cached != null) return { data: cached, fromCache: true };

  const key = dailyPublicationKey(channel, day);
  if (!key || typeof fetcher !== 'function') return { data: null, fromCache: false };

  let request = inFlight.get(key);
  if (!request) {
    request = Promise.resolve()
      .then(fetcher)
      .then((data) => {
        if (data != null) writeDailyPublication(channel, day, data);
        return data ?? null;
      })
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
  }
  return { data: await request, fromCache: false };
}

window.cidDailyPublicationCache = Object.freeze({
  key: dailyPublicationKey,
  read: readDailyPublication,
  write: writeDailyPublication,
  get: getDailyPublication
});
