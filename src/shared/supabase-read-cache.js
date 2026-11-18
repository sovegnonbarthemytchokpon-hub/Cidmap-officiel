/*
 * Shared read boundary for every Supabase query issued by the browser.
 *
 * Supabase reported an excessive Disk I/O usage. The cause was not a single
 * slow query: it was the number of identical reads the SPA issued. Several
 * modules kept their own 30 s timers, re-read the same public catalogue on
 * every `focus`/`visibilitychange`, and re-issued one query per feed card
 * instead of one query per feed.
 *
 * This module is the single place that answers three questions:
 *
 *   1. "Do I already have this row?"      -> read()/swr() serve a cached value
 *                                            instead of touching Postgres.
 *   2. "Is someone already asking?"       -> dedupe() shares one in-flight
 *                                            promise between callers.
 *   3. "Can these N calls become one?"    -> batch() coalesces per-id reads
 *                                            issued in the same frame into a
 *                                            single `.in(...)` query.
 *
 * It is deliberately dependency-free so classic scripts and ES modules can
 * share it, and it is a *cache*, never a data source: nothing here invents a
 * row. A miss always goes to Supabase, and `signature()` lets callers stop
 * re-rendering (and therefore re-querying) when a revalidation returned the
 * exact same payload.
 */
(function installCidReadCache() {
  'use strict';

  const STORE_PREFIX = 'cidmap:read-cache:v1:';
  const DEFAULT_TTL_MS = 60 * 1000;
  const MEMORY_LIMIT = 240;
  /*
   * Hard network budget. A read that has not answered within this window is
   * abandoned and the caller falls back to the last value kept locally, so a
   * slow database can never leave a spinner or a blank view on screen.
   */
  const NETWORK_TIMEOUT_MS = 8000;

  const memory = new Map();
  const inFlight = new Map();
  const throttles = new Map();
  const batches = new Map();

  function identity() {
    const known = String(window.cidAuthCurrentUserId || '').trim();
    return known ? known.replace(/[^A-Za-z0-9._:@-]/g, '_').slice(0, 140) : 'visitor';
  }

  function scopedKey(name, scope) {
    return `${scope || identity()}::${String(name || 'data')}`;
  }

  function sortValue(value) {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((accumulator, key) => {
        accumulator[key] = sortValue(value[key]);
        return accumulator;
      }, {});
    }
    return value;
  }

  /*
   * Stable, order-insensitive fingerprint of a payload. Modules use it to
   * decide whether a revalidation actually changed anything: dispatching a
   * "config loaded" event for an identical payload used to make the whole
   * home feed re-hydrate, which is what turned one cheap read into dozens.
   */
  function signature(value) {
    let serialized;
    try {
      serialized = JSON.stringify(sortValue(value));
    } catch (_) {
      return '';
    }
    if (!serialized) return '';
    let hash = 5381;
    for (let index = 0; index < serialized.length; index += 1) {
      hash = ((hash << 5) + hash + serialized.charCodeAt(index)) | 0;
    }
    return `${serialized.length.toString(36)}.${(hash >>> 0).toString(36)}`;
  }

  function persistedRead(key) {
    try {
      const raw = localStorage.getItem(`${STORE_PREFIX}${key}`);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || !Number.isFinite(Number(payload.savedAt))) return null;
      return { value: payload.value, savedAt: Number(payload.savedAt) };
    } catch (_) {
      return null;
    }
  }

  function persistedWrite(key, entry) {
    try {
      localStorage.setItem(`${STORE_PREFIX}${key}`, JSON.stringify({
        savedAt: entry.savedAt,
        value: entry.value
      }));
    } catch (_) {
      // Quota or private browsing. The in-memory entry still spares the read
      // for the current page, and a live request is never blocked.
    }
  }

  function trimMemory() {
    if (memory.size <= MEMORY_LIMIT) return;
    const oldest = [...memory.entries()]
      .sort(([, left], [, right]) => left.savedAt - right.savedAt)
      .slice(0, memory.size - MEMORY_LIMIT);
    oldest.forEach(([key]) => memory.delete(key));
  }

  /*
   * Read a cached entry. `maxAgeMs` is the caller's freshness contract, so a
   * price catalogue and a private balance can share this store with very
   * different tolerances.
   */
  function read(name, { scope, maxAgeMs = DEFAULT_TTL_MS, persist = true } = {}) {
    const key = scopedKey(name, scope);
    let entry = memory.get(key);
    if (!entry && persist) {
      entry = persistedRead(key);
      if (entry) memory.set(key, entry);
    }
    if (!entry) return null;
    const age = Date.now() - entry.savedAt;
    if (!Number.isFinite(age) || age < 0) return null;
    if (age > maxAgeMs) return null;
    return { value: entry.value, savedAt: entry.savedAt, age };
  }

  function write(name, value, { scope, persist = true } = {}) {
    const key = scopedKey(name, scope);
    const entry = { value, savedAt: Date.now() };
    memory.set(key, entry);
    trimMemory();
    if (persist) persistedWrite(key, entry);
    return value;
  }

  function invalidate(name, { scope } = {}) {
    const key = scopedKey(name, scope);
    memory.delete(key);
    inFlight.delete(key);
    try { localStorage.removeItem(`${STORE_PREFIX}${key}`); } catch (_) {}
  }

  /*
   * Drop every entry for the previous account. Called on `cid:auth-sync` so a
   * session switch can never paint the former user's balance or grants.
   */
  function clearScope(scope) {
    const prefix = `${scope || identity()}::`;
    [...memory.keys()].forEach((key) => {
      if (key.startsWith(prefix)) memory.delete(key);
    });
    [...inFlight.keys()].forEach((key) => {
      if (key.startsWith(prefix)) inFlight.delete(key);
    });
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(`${STORE_PREFIX}${prefix}`)) localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  function clearAll() {
    memory.clear();
    inFlight.clear();
    throttles.clear();
    try {
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(STORE_PREFIX)) localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  function timeoutError() {
    const error = new Error('Supabase n’a pas répondu à temps.');
    error.name = 'TimeoutError';
    error.code = 'CID_NETWORK_TIMEOUT';
    return error;
  }

  /*
   * Reject when `promise` has not settled within `ms`. The original request
   * may still finish in the background; its late answer is simply ignored.
   */
  function withTimeout(promise, ms = NETWORK_TIMEOUT_MS) {
    let timer = 0;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(timeoutError()), ms);
      })
    ]).finally(() => window.clearTimeout(timer));
  }

  // fetch() with the same deadline, for same-origin API routes.
  function fetchWithTimeout(input, init = {}, ms = NETWORK_TIMEOUT_MS) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    return window.fetch(input, { ...init, signal: controller.signal })
      .catch((error) => {
        throw timedOut ? timeoutError() : error;
      })
      .finally(() => window.clearTimeout(timer));
  }

  /*
   * Last value ever stored for this key, whatever its age. Only used when the
   * network failed or timed out: stale data beats an empty screen.
   */
  function lastKnown(name, { scope, persist = true } = {}) {
    return read(name, { scope, maxAgeMs: Number.POSITIVE_INFINITY, persist });
  }

  /*
   * Share a single in-flight promise between concurrent callers. Startup
   * fires several independent code paths that all want the same row; without
   * this, each one opened its own query.
   */
  function dedupe(name, fetcher, { scope } = {}) {
    const key = scopedKey(name, scope);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = Promise.resolve()
      .then(fetcher)
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  /*
   * Stale-while-revalidate read.
   *
   * - fresher than `ttlMs`     -> returned from cache, no request at all;
   * - fresher than `staleTtlMs`-> returned from cache and revalidated in the
   *                               background (the UI paints instantly and
   *                               Postgres sees one read, not one per view);
   * - older / missing          -> awaits the real Supabase request, bounded
   *                               by NETWORK_TIMEOUT_MS; on failure or
   *                               timeout the last known value is served.
   */
  function swr(name, fetcher, options = {}) {
    const {
      ttlMs = DEFAULT_TTL_MS,
      staleTtlMs = 0,
      scope,
      persist = true,
      timeoutMs = NETWORK_TIMEOUT_MS,
      onRevalidated
    } = options;
    const maxAgeMs = Math.max(ttlMs, staleTtlMs);
    const cached = read(name, { scope, maxAgeMs, persist });
    const request = () => dedupe(name, async () => {
      const value = await withTimeout(fetcher(), timeoutMs);
      if (value === undefined) return cached ? cached.value : value;
      write(name, value, { scope, persist });
      return value;
    }, { scope });

    if (cached && cached.age <= ttlMs) return Promise.resolve(cached.value);
    if (cached) {
      request()
        .then((value) => onRevalidated?.(value))
        .catch(() => {});
      return Promise.resolve(cached.value);
    }
    return request().catch((error) => {
      const fallback = lastKnown(name, { scope, persist });
      if (fallback) return fallback.value;
      throw error;
    });
  }

  /*
   * Rate gate for the `focus` / `visibilitychange` / timer revalidations that
   * several modules install independently. Returns false when the same key
   * already ran within `minIntervalMs`.
   */
  function allow(key, minIntervalMs = DEFAULT_TTL_MS) {
    const now = Date.now();
    const last = Number(throttles.get(key) || 0);
    if (now - last < minIntervalMs) return false;
    throttles.set(key, now);
    return true;
  }

  function resetThrottle(key) {
    throttles.delete(key);
  }

  /*
   * Coalesce per-id reads into one query.
   *
   * `resolver(ids)` must return a Map keyed by id. Callers keep their simple
   * "give me the metrics for this card" API while Postgres receives a single
   * `.in(...)` read per frame instead of one read per card.
   */
  function batch(name, ids, resolver, { windowMs = 12, maxBatch = 80 } = {}) {
    const wanted = [...new Set(
      (Array.isArray(ids) ? ids : [ids])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean)
    )];
    if (!wanted.length) return Promise.resolve(new Map());

    let queue = batches.get(name);
    if (queue && queue.ids.size + wanted.length > maxBatch) {
      queue.flush();
      queue = null;
    }
    if (!queue) {
      queue = { ids: new Set(), waiters: [], timer: 0, flush: () => {} };
      queue.flush = () => {
        if (batches.get(name) === queue) batches.delete(name);
        window.clearTimeout(queue.timer);
        queue.timer = 0;
        const requested = [...queue.ids];
        const waiters = queue.waiters.splice(0);
        Promise.resolve()
          .then(() => resolver(requested))
          .then((resolved) => {
            const map = resolved instanceof Map
              ? resolved
              : new Map(Object.entries(resolved || {}));
            waiters.forEach(({ keys, resolve }) => {
              const slice = new Map();
              keys.forEach((id) => {
                if (map.has(id)) slice.set(id, map.get(id));
              });
              resolve(slice);
            });
          })
          .catch((error) => waiters.forEach(({ reject }) => reject(error)));
      };
      batches.set(name, queue);
    }

    wanted.forEach((id) => queue.ids.add(id));
    const promise = new Promise((resolve, reject) => {
      queue.waiters.push({ keys: wanted, resolve, reject });
    });
    if (queue.ids.size >= maxBatch) queue.flush();
    else if (!queue.timer) queue.timer = window.setTimeout(queue.flush, windowMs);
    return promise;
  }

  /*
   * Publication clock.
   *
   * Every programme is published once a day at 16:00 GMT (UTC). Public data
   * that only changes with a publication (catalogue, archives) is therefore
   * valid until the next 16:00 GMT boundary, whatever the visitor's time
   * zone: Date arithmetic is done on the UTC timeline, so a visitor in
   * Abidjan sees the refresh at 16:00, in Paris at 17:00/18:00, in New York
   * at 11:00/12:00, without any conversion table.
   */
  const PUBLICATION_HOUR_UTC = 16;

  function lastPublicationAt(now = Date.now()) {
    const boundary = new Date(now);
    boundary.setUTCHours(PUBLICATION_HOUR_UTC, 0, 0, 0);
    if (boundary.getTime() > now) boundary.setUTCDate(boundary.getUTCDate() - 1);
    return boundary.getTime();
  }

  function nextPublicationAt(now = Date.now()) {
    return lastPublicationAt(now) + 24 * 60 * 60 * 1000;
  }

  // Time left before the cached publication data expires (never below 1 s).
  function msUntilNextPublication(now = Date.now()) {
    return Math.max(1000, nextPublicationAt(now) - now);
  }

  // A cached entry saved before the latest boundary belongs to the previous
  // publication cycle.
  function isFromCurrentPublication(savedAt, now = Date.now()) {
    return Number(savedAt) >= lastPublicationAt(now);
  }

  let lastIdentity = identity();
  window.addEventListener('cid:auth-sync', (event) => {
    // Entitlements, balances and private rows are account-scoped. Everything
    // cached for the previous identity is dropped before the next paint - but
    // only when the identity really changed, so a repeated notification for
    // the same account does not throw away (and re-read) the whole cache.
    const next = event.detail?.id ? identity() : 'visitor';
    if (next === lastIdentity) return;
    lastIdentity = next;
    memory.clear();
    inFlight.clear();
    throttles.clear();
  });

  window.cidReadCache = Object.freeze({
    read,
    write,
    swr,
    lastKnown,
    withTimeout,
    fetchWithTimeout,
    NETWORK_TIMEOUT_MS,
    dedupe,
    batch,
    allow,
    resetThrottle,
    invalidate,
    clearScope,
    clearAll,
    signature,
    identity,
    lastPublicationAt,
    nextPublicationAt,
    msUntilNextPublication,
    isFromCurrentPublication
  });
})();
