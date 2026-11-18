/*
 * Nine-publication sliding window (localStorage, FIFO).
 *
 * Every archive rail of the platform (Accueil, Croix, Matrice, Boules
 * rejetées, Tableaux) shows the same thing: the nine latest publications.
 * A published programme never changes afterwards, yet every visit, refresh
 * and route change used to read the nine dates again from Supabase. With the
 * audience of cidgroup.net that meant tens of thousands of identical
 * requests a day.
 *
 * This module turns those nine reads into a per-browser window:
 *
 *   - Cold start (first visit / first unlock): the nine publications are read
 *     once, stored and locked under a dedicated key, together with a
 *     dedicated "last synchronisation" key.
 *   - Warm visits: the nine publications are served from localStorage and no
 *     request is sent for them.
 *   - New day: only the date that is not in the window yet is read. It is
 *     inserted at the head and the oldest publication leaves by the tail, so
 *     the window always holds exactly nine items.
 *
 * A date that could not be read (not published yet, network error) is never
 * stored; it is retried after a short cool-down so a refresh storm before the
 * daily publication cannot hammer the database either. A corrupted or
 * foreign JSON value is dropped and triggers a clean cold start.
 *
 * Nothing here computes a result: payloads come only from the existing
 * server adapters, which keep enforcing access on the server side.
 */
(function installCidNinePublications() {
  'use strict';

  const VERSION = 1;
  const WINDOW_SIZE = 9;
  const DATA_PREFIX = 'cidgroup_neuf_publications:v1:';
  const SYNC_PREFIX = 'cidgroup_neuf_publications_sync:v1:';
  const PUBLIC_SCOPE = 'public';
  // Not published yet: wait before asking again.
  const MISSING_RETRY_MS = 5 * 60 * 1000;
  // Transient failure (network, 5xx): retry sooner.
  const ERROR_RETRY_MS = 60 * 1000;
  const MAX_MISSES = 16;
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const inFlight = new Map();

  function safePart(value, fallback) {
    const normalized = String(value ?? '').trim()
      .replace(/[^A-Za-z0-9._:@-]/g, '_')
      .slice(0, 140);
    return normalized || fallback;
  }

  function storageKeys(channel, scope) {
    const id = `${safePart(scope, PUBLIC_SCOPE)}:${safePart(channel, 'default')}`;
    return { data: `${DATA_PREFIX}${id}`, sync: `${SYNC_PREFIX}${id}` };
  }

  function isoDate(value) {
    const date = String(value ?? '').slice(0, 10);
    return ISO_DATE.test(date) ? date : '';
  }

  // Calendar day of the platform (programmes are published on GMT).
  function currentDay() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Abidjan',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  const newestFirst = (left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0);

  function emptyRecord(channel, scope) {
    return {
      version: VERSION,
      channel: String(channel),
      scope: String(scope),
      items: [],
      misses: {},
      headDate: '',
      syncedDay: '',
      syncedAt: ''
    };
  }

  /*
   * Integrity gate for everything read back from localStorage. The value may
   * have been edited by hand, truncated by a full quota or written by an older
   * release; anything that does not match the exact contract is rejected.
   */
  function sanitize(raw, channel, scope) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (raw.version !== VERSION || raw.channel !== channel || raw.scope !== scope) return null;
    if (!Array.isArray(raw.items)) return null;
    const seen = new Set();
    const items = raw.items
      .filter((item) => {
        const date = isoDate(item?.date);
        if (!date || date !== item.date || seen.has(date)) return false;
        if (item.payload === null || typeof item.payload !== 'object') return false;
        seen.add(date);
        return true;
      })
      .map((item) => ({ date: item.date, payload: item.payload }))
      .sort(newestFirst)
      .slice(0, WINDOW_SIZE);
    const misses = {};
    if (raw.misses && typeof raw.misses === 'object') {
      Object.entries(raw.misses).forEach(([date, miss]) => {
        if (isoDate(date) === date && Number.isFinite(miss?.at) && Number.isFinite(miss?.wait)) {
          misses[date] = { at: miss.at, wait: miss.wait };
        }
      });
    }
    return {
      ...emptyRecord(channel, scope),
      items,
      misses,
      headDate: items[0]?.date || '',
      syncedDay: isoDate(raw.syncedDay),
      syncedAt: String(raw.syncedAt || '')
    };
  }

  function removeKeys(keys) {
    try {
      localStorage.removeItem(keys.data);
      localStorage.removeItem(keys.sync);
    } catch (_) {}
  }

  function load(channel, scope) {
    const keys = storageKeys(channel, scope);
    let raw = null;
    try {
      raw = localStorage.getItem(keys.data);
    } catch (_) {
      return emptyRecord(channel, scope);
    }
    if (!raw) return emptyRecord(channel, scope);
    try {
      const record = sanitize(JSON.parse(raw), String(channel), String(scope));
      if (record) return record;
    } catch (_) {}
    // Corrupted or foreign value: drop it so the next read is a clean cold start.
    removeKeys(keys);
    return emptyRecord(channel, scope);
  }

  function windowKeys() {
    const keys = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(DATA_PREFIX)) keys.push(key);
      }
    } catch (_) {}
    return keys;
  }

  // Quota reached: free the window that was synchronised the longest ago.
  function evictOldestWindow(exceptKey) {
    let oldest = null;
    windowKeys().forEach((key) => {
      if (key === exceptKey) return;
      let syncedAt = '';
      try { syncedAt = String(JSON.parse(localStorage.getItem(key))?.syncedAt || ''); } catch (_) {}
      if (!oldest || syncedAt < oldest.syncedAt) oldest = { key, syncedAt };
    });
    if (!oldest) return false;
    try {
      localStorage.removeItem(oldest.key);
      localStorage.removeItem(oldest.key.replace(DATA_PREFIX, SYNC_PREFIX));
    } catch (_) {}
    return true;
  }

  function persist(record) {
    const keys = storageKeys(record.channel, record.scope);
    const syncedAt = new Date().toISOString();
    record.items = record.items.sort(newestFirst).slice(0, WINDOW_SIZE);
    record.headDate = record.items[0]?.date || '';
    record.syncedDay = currentDay();
    record.syncedAt = syncedAt;
    const body = JSON.stringify(record);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        localStorage.setItem(keys.data, body);
        localStorage.setItem(keys.sync, syncedAt);
        return true;
      } catch (_) {
        if (!evictOldestWindow(keys.data)) break;
      }
    }
    // Private browsing / full quota: the page still works from the network.
    return false;
  }

  function cloneJson(value) {
    try {
      const copy = JSON.parse(JSON.stringify(value));
      return copy && typeof copy === 'object' ? copy : null;
    } catch (_) {
      return null;
    }
  }

  function wantedDates(dates) {
    return [...new Set((Array.isArray(dates) ? dates : [dates]).map(isoDate).filter(Boolean))];
  }

  /*
   * One network read per (scope, channel, date) at a time, even when Accueil
   * and a dedicated view ask for the same window in the same second.
   */
  function startFetches(prefix, dates, fetchOne, fetchMany) {
    const own = dates.filter((date) => !inFlight.has(`${prefix}|${date}`));
    const batch = own.length && typeof fetchMany === 'function'
      ? Promise.resolve().then(() => fetchMany(own)).catch(() => null)
      : null;
    own.forEach((date) => {
      const key = `${prefix}|${date}`;
      const request = (async () => {
        if (batch) {
          const value = (await batch)?.get?.(date);
          if (value !== undefined && value !== null) return value;
        }
        return typeof fetchOne === 'function' ? fetchOne(date) : null;
      })();
      inFlight.set(key, request);
      request.then(() => inFlight.delete(key), () => inFlight.delete(key));
    });
    return new Map(dates.map((date) => [date, inFlight.get(`${prefix}|${date}`)]));
  }

  /*
   * Read-only view of the window. `complete` tells a caller that every date
   * it needs is already locked locally, so it can skip its network path.
   */
  function peek({ channel, scope = PUBLIC_SCOPE, dates } = {}) {
    const wanted = wantedDates(dates);
    const record = load(String(channel), String(scope));
    const stored = new Map(record.items.map((item) => [item.date, item.payload]));
    const items = new Map();
    wanted.forEach((date) => {
      if (stored.has(date)) items.set(date, stored.get(date));
    });
    return {
      complete: wanted.length > 0 && items.size === wanted.length,
      items,
      headDate: record.headDate,
      syncedDay: record.syncedDay,
      isNewDay: record.syncedDay !== currentDay()
    };
  }

  /*
   * Resolve the requested dates (newest first) against the window.
   *
   *   channel   stable name of the rail, e.g. "croix" or "tableaux:tableaux-lnb"
   *   scope     "public" or the subscriber scope from subscriberScope()
   *   fetchOne  (date) => payload           existing per-date adapter
   *   fetchMany (dates) => Map(date→payload) optional single batched read
   *   isValid   (payload) => boolean        only valid payloads are locked
   *   project   (payload) => object         what is kept in localStorage
   *   onItem    (date, payload, source)     incremental paint hook
   *
   * Returns [{ date, payload, source }] in the requested order; payload is
   * null when the date is not available yet. Cached and network payloads have
   * the same JSON shape, so renderers never see two formats.
   */
  async function resolve({
    channel,
    scope = PUBLIC_SCOPE,
    dates,
    fetchOne,
    fetchMany,
    isValid = (payload) => payload !== null && payload !== undefined,
    project = (payload) => payload,
    onItem
  } = {}) {
    const channelName = String(channel || '');
    const scopeName = String(scope || PUBLIC_SCOPE);
    const wanted = wantedDates(dates);
    const record = load(channelName, scopeName);
    const stored = new Map(record.items.map((item) => [item.date, item.payload]));
    const results = new Map();
    const missing = [];
    const now = Date.now();
    const notify = (date, payload, source) => {
      try { onItem?.(date, payload, source); } catch (_) {}
    };

    wanted.forEach((date) => {
      if (stored.has(date)) {
        results.set(date, { payload: stored.get(date), source: 'cache' });
        notify(date, stored.get(date), 'cache');
        return;
      }
      const miss = record.misses[date];
      if (miss && now - miss.at < miss.wait) {
        results.set(date, { payload: null, source: 'deferred' });
        notify(date, null, 'deferred');
        return;
      }
      missing.push(date);
    });

    if (!missing.length || (typeof fetchOne !== 'function' && typeof fetchMany !== 'function')) {
      return wanted.map((date) => ({ date, ...(results.get(date) || { payload: null, source: 'deferred' }) }));
    }

    const fresh = new Map();
    const misses = new Map();
    const pending = startFetches(`${scopeName}|${channelName}`, missing, fetchOne, fetchMany);
    await Promise.all(missing.map(async (date) => {
      let payload = null;
      let failed = false;
      try {
        const value = await pending.get(date);
        if (value !== undefined && value !== null && isValid(value)) {
          payload = cloneJson(project(value));
        }
      } catch (_) {
        failed = true;
      }
      if (payload) fresh.set(date, payload);
      else misses.set(date, { at: Date.now(), wait: failed ? ERROR_RETRY_MS : MISSING_RETRY_MS });
      results.set(date, { payload, source: payload ? 'network' : 'missing' });
      notify(date, payload, payload ? 'network' : 'missing');
    }));

    // Re-read before writing so a concurrent tab or view is merged, not lost.
    const latest = load(channelName, scopeName);
    const byDate = new Map(latest.items.map((item) => [item.date, item.payload]));
    fresh.forEach((payload, date) => {
      byDate.set(date, payload);
      delete latest.misses[date];
    });
    misses.forEach((miss, date) => {
      if (!byDate.has(date)) latest.misses[date] = miss;
    });
    // FIFO: newest at the head, the oldest leaves by the tail beyond nine.
    latest.items = [...byDate.entries()]
      .map(([date, payload]) => ({ date, payload }))
      .sort(newestFirst)
      .slice(0, WINDOW_SIZE);
    const oldestKept = latest.items[latest.items.length - 1]?.date || '';
    latest.misses = Object.fromEntries(Object.entries(latest.misses)
      .filter(([date]) => latest.items.length < WINDOW_SIZE || date > oldestKept)
      .sort(([left], [right]) => (left < right ? 1 : -1))
      .slice(0, MAX_MISSES));
    persist(latest);

    return wanted.map((date) => ({ date, ...results.get(date) }));
  }

  function purge({ channel, scope = PUBLIC_SCOPE } = {}) {
    removeKeys(storageKeys(String(channel || ''), String(scope || PUBLIC_SCOPE)));
  }

  function purgeWhere(predicate) {
    windowKeys().forEach((key) => {
      if (!predicate(key.slice(DATA_PREFIX.length))) return;
      try {
        localStorage.removeItem(key);
        localStorage.removeItem(key.replace(DATA_PREFIX, SYNC_PREFIX));
      } catch (_) {}
    });
  }

  /*
   * Subscriber windows are bound to the signed-in account. Only the current
   * account's windows are kept on the device, so a shared phone never shows
   * one subscriber's unlocked tables to the next person who signs in.
   */
  async function subscriberScope() {
    let id = String(window.cidAuthCurrentUserId || '').trim();
    if (!id) {
      id = String(await Promise.resolve(window.cidPersistentCache?.identity?.()).catch(() => '') || '').trim();
    }
    const scope = `user_${safePart(id || 'visitor', 'visitor')}`;
    purgeWhere((rest) => rest.startsWith('user_') && !rest.startsWith(`${scope}:`));
    return scope;
  }

  window.cidNinePublications = Object.freeze({
    version: VERSION,
    size: WINDOW_SIZE,
    publicScope: PUBLIC_SCOPE,
    currentDay,
    peek,
    resolve,
    purge,
    subscriberScope,
    keys: storageKeys
  });
})();
