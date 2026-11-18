/*
 * Public Supabase configuration boundary.
 *
 * Access rules, plans, balances, prices and payment settings are read from
 * the `subscription-access` Edge Function. The browser never reads the old
 * D1 compatibility endpoint and never keeps a local catalogue. Empty
 * database domains stay empty so the UI can show an administrator-managed
 * state instead of inventing a price or an entitlement.
 */
(function initSiteConfig() {
  'use strict';

  /*
   * The catalogue is administrator-managed public data: plans, prices,
   * banners, locks and the localization table. It used to be re-read from
   * Postgres every 30 s, on every window focus and on every
   * visibilitychange, by this module *and* by feature-access and
   * currency-mode independently - one `subscription-access` state call fans
   * out to more than twenty table reads, so those timers alone accounted for
   * a large share of the reported disk I/O.
   *
   * It is now cached (memory + localStorage through cidReadCache) and served
   * instantly while a single background revalidation reconciles it. The
   * account-scoped part of the same response (balance, subscription, grants)
   * keeps a much shorter tolerance and is exposed through accessSnapshot()
   * so feature-access can reuse this one request instead of issuing a
   * second identical one.
   */
  /*
   * Freshness contract:
   *   - visitor: the catalogue is public data, valid for the whole
   *     publication cycle (until the next 16:00 GMT boundary);
   *   - signed-in: the same response carries the balance and the grants, so
   *     it is trusted for ACCOUNT_FRESH_MS. Purchases, unlocks, sign-in and
   *     administrator changes still force an immediate re-read, and a locked
   *     section is re-checked against the database when it is tapped
   *     (feature-access requireAccess).
   * Nothing re-reads it on focus, visibilitychange or on a timer.
   */
  const CATALOGUE_CACHE_KEY = 'site-config:catalogue';
  // Account slice (balance, subscription, individual grants) of the same
  // response. It is persisted per account so a later visit on the same
  // publication day repaints the unlocked Tableaux without a new read.
  const ACCOUNT_CACHE_KEY = 'site-config:account';
  const ACCOUNT_FRESH_MS = 15 * 60 * 1000;
  const CATALOGUE_STALE_MS = 26 * 60 * 60 * 1000;
  const REVALIDATE_MIN_INTERVAL_MS = 5 * 60 * 1000;
  // Forced reads issued by several modules for the same event (auth-sync,
  // purchase) share one request.
  const FORCE_COALESCE_MS = 3 * 1000;
  const PLATFORM_CACHE_KEY = 'site-config:platform';
  const PLATFORM_FRESH_MS = 10 * 60 * 1000;

  const readCache = () => window.cidReadCache || null;
  let cache = null;
  let rawAccess = null;
  let rawAccessAt = 0;
  let publishedSignature = '';
  let pending = null;
  let pendingForcedAt = 0;
  let pendingIdentity = '';
  let cacheEpoch = 0;
  let handledIdentity = cacheScope();

  function normalize(list) {
    return Array.isArray(list) ? list : [];
  }

  function cacheScope() {
    return readCache()?.identity?.() || 'visitor';
  }

  function requestedLocale() {
    return String(
      window.cidTranslation?.current?.()
        || localStorage.getItem('cid_i18n_locale')
        || navigator.language
        || 'fr'
    ).trim();
  }

  function country(countryCode) {
    const code = String(countryCode || '').trim().toUpperCase();
    return code || 'DEFAULT';
  }

  function specificity(row) {
    let score = 0;
    if (row.target_type === 'category') score -= 1;
    if (row.target_key) score += 2;
    if (row.country_code && row.country_code !== 'DEFAULT' && row.country_code !== '') score += 1;
    return score;
  }

  /*
   * Only announce a catalogue that actually differs from the one already
   * painted. `cid:site-config-loaded` makes the home feed rebuild and
   * re-hydrate every card (comments, likes, shares, profiles), so firing it
   * after an identical revalidation used to multiply one config read into
   * dozens of social reads every 30 seconds.
   */
  function publish(nextCache, { announce = true } = {}) {
    cache = nextCache;
    if (!announce) return cache;
    const nextSignature = readCache()?.signature?.({
      plans: cache.plans,
      starPrices: cache.starPrices,
      tokenPrices: cache.tokenPrices,
      paymentSettings: cache.paymentSettings,
      localization: cache.localization,
      localeCode: cache.localeCode,
      banners: cache.banners,
      grids: cache.grids,
      gridAssignments: cache.gridAssignments,
      locks: cache.locks,
      dailyIllustrations: cache.dailyIllustrations,
      accessRules: cache.accessRules,
      earlyAccessRules: cache.earlyAccessRules
    }) || '';
    if (nextSignature && nextSignature === publishedSignature) return cache;
    publishedSignature = nextSignature;
    window.dispatchEvent(new CustomEvent('cid:site-config-loaded', { detail: { ...cache } }));
    return cache;
  }

  /*
   * The public presentation domains come from the read-only platform-config
   * route. It was fetched with `cache: 'no-store'` next to every catalogue
   * read; a short TTL removes that duplicate round trip entirely.
   */
  async function platformConfig() {
    const cached = readCache()?.read?.(PLATFORM_CACHE_KEY, {
      scope: 'public',
      maxAgeMs: PLATFORM_FRESH_MS
    });
    if (cached) return cached.value;
    // Bounded like every Supabase read: a slow route falls back to the last
    // known configuration instead of holding the catalogue.
    const timedFetch = readCache()?.fetchWithTimeout || window.fetch.bind(window);
    const fetched = await timedFetch('/api/config/platform', {
      headers: { Accept: 'application/json' }
    })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    if (fetched) {
      readCache()?.write?.(PLATFORM_CACHE_KEY, fetched, { scope: 'public' });
      return fetched;
    }
    return readCache()?.lastKnown?.(PLATFORM_CACHE_KEY, { scope: 'public' })?.value || null;
  }

  async function requestRemote(requestEpoch = cacheEpoch, { announce = true } = {}) {
    if (pending) return pending;
    let request;
    request = (async () => {
      const bridge = await window.cidSupabaseReady;
      if (!bridge?.client?.functions?.invoke) return null;
      const [{ data, error }, platformResponse] = await Promise.all([
        bridge.client.functions.invoke(
          'subscription-access',
          // The purchase history is only rendered by the account page, which
          // requests it itself; skipping it here spares seven table reads.
          { body: { action: 'state', localeCode: requestedLocale(), includeHistory: false } }
        ),
        platformConfig()
      ]);
      if (error || !data?.ok) return null;
      if (requestEpoch !== cacheEpoch) return cache;
      const access = data.access || {};
      rawAccess = access;
      rawAccessAt = Date.now();
      if (cacheScope() !== 'visitor') {
        readCache()?.write?.(ACCOUNT_CACHE_KEY, access, { scope: cacheScope() });
      }
      const publicConfig = platformResponse?.ok ? platformResponse : {};
      const nextCache = {
        plans: normalize(access.plans),
        plansAll: normalize(access.plans),
        starPrices: normalize(access.starPrices),
        tokenPrices: normalize(access.tokenPrices),
        paymentSettings: access.settings || null,
        localization: access.localization || null,
        localeCode: access.localization?.selectedLocale
          || access.localization?.defaultLocale
          || requestedLocale(),
        // These public presentation domains are served by the existing
        // read-only platform-config route. In particular, the real
        // date/weekday illustration catalogue must also be available to the
        // Anticipé route; an empty object leaves future cards on their
        // structural placeholder instead of the configured image.
        banners: normalize(publicConfig.banners || access.banners),
        grids: publicConfig.grids && typeof publicConfig.grids === 'object'
          ? publicConfig.grids
          : {},
        gridAssignments: normalize(publicConfig.gridAssignments),
        commentRules: {},
        locks: normalize(publicConfig.locks),
        dailyIllustrations: publicConfig.dailyIllustrations
          && typeof publicConfig.dailyIllustrations === 'object'
          ? publicConfig.dailyIllustrations
          : {},
        accessRules: normalize(access.rules),
        earlyAccessRules: normalize(access.earlyAccessRules),
        updatedAt: Date.now()
      };
      readCache()?.write?.(CATALOGUE_CACHE_KEY, nextCache, { scope: cacheScope() });
      return publish(nextCache, { announce });
    })().catch(() => null).finally(() => {
      if (pending === request) {
        pending = null;
        pendingForcedAt = 0;
      }
    });
    pending = request;
    pendingIdentity = cacheScope();
    return pending;
  }

  /*
   * Account snapshot persisted during the current publication cycle for the
   * signed-in identity. Every event that really changes it (purchase,
   * unlock, administrator change, identity switch) still forces a read, and
   * a locked section is re-checked against the database when it is tapped.
   */
  function persistedAccount() {
    const scope = cacheScope();
    if (scope === 'visitor') return null;
    const reader = readCache();
    const stored = reader?.read?.(ACCOUNT_CACHE_KEY, {
      scope,
      maxAgeMs: CATALOGUE_STALE_MS
    });
    if (!stored?.value || !reader?.isFromCurrentPublication?.(stored.savedAt)) {
      return null;
    }
    return stored;
  }

  function restorePersistedAccount() {
    if (rawAccess) return true;
    const stored = persistedAccount();
    if (!stored) return false;
    rawAccess = stored.value;
    rawAccessAt = stored.savedAt;
    return true;
  }

  function isFresh(cached, maxAgeMs) {
    if (Number.isFinite(maxAgeMs)) return cached.age <= maxAgeMs;
    const reader = readCache();
    if (!reader?.isFromCurrentPublication) return cached.age <= ACCOUNT_FRESH_MS;
    const fromCurrentPublication = reader.isFromCurrentPublication(Date.now() - cached.age);
    if (cacheScope() === 'visitor') return fromCurrentPublication;
    // A signed-in catalogue stays usable for the whole day as long as the
    // matching account snapshot from the same day is available too.
    if (cached.age <= ACCOUNT_FRESH_MS) return true;
    return fromCurrentPublication && restorePersistedAccount();
  }

  function cachedCatalogue(maxAgeMs) {
    if (cache) return { value: cache, age: Math.max(0, Date.now() - Number(cache.updatedAt || 0)) };
    const stored = readCache()?.read?.(CATALOGUE_CACHE_KEY, {
      scope: cacheScope(),
      maxAgeMs
    });
    if (!stored?.value) return null;
    // Adopt the persisted catalogue so the very first paint of a returning
    // visitor needs no Supabase read at all.
    publish(stored.value, { announce: false });
    return { value: stored.value, age: stored.age };
  }

  /*
   * Serve the catalogue from cache when it is fresh, serve it immediately and
   * reconcile in the background when it is merely stale, and only block on
   * Supabase when nothing usable is cached. `force` is reserved for the
   * events that genuinely invalidate it (administrator change, sign-in,
   * sign-out, completed purchase).
   */
  async function load({ force = false, maxAgeMs } = {}) {
    if (force) {
      if (pending && pendingForcedAt
        && pendingIdentity === cacheScope()
        && Date.now() - pendingForcedAt <= FORCE_COALESCE_MS) {
        return pending;
      }
      cacheEpoch += 1;
      pending = null;
      const request = requestRemote(cacheEpoch);
      pendingForcedAt = Date.now();
      return request;
    }
    const cached = cachedCatalogue(CATALOGUE_STALE_MS);
    if (cached && isFresh(cached, maxAgeMs)) return cached.value;
    if (cached) {
      if (readCache()?.allow?.('site-config:revalidate', REVALIDATE_MIN_INTERVAL_MS) !== false) {
        requestRemote(cacheEpoch).catch(() => null);
      }
      return cached.value;
    }
    return requestRemote(cacheEpoch);
  }

  function refresh(options = {}) {
    if (options?.force === true) return load({ force: true });
    // A non-forced refresh is a revalidation request, not a mandate to read
    // Postgres again: the throttle inside load() collapses the focus and
    // visibilitychange callers into one request.
    return load(options);
  }

  /*
   * Account-scoped slice of the same `subscription-access` response.
   * feature-access consumes this instead of invoking the function a second
   * time with an identical body.
   */
  async function accessSnapshot({ maxAgeMs = ACCOUNT_FRESH_MS, force = false } = {}) {
    if (!force && rawAccess && Date.now() - rawAccessAt <= maxAgeMs) return rawAccess;
    if (!force && !rawAccess && restorePersistedAccount()) {
      // Adopt the catalogue persisted with it, then answer from storage.
      await load();
      return rawAccess;
    }
    await load({ force });
    return rawAccess;
  }

  function plans() {
    return cache ? normalize(cache.plans) : [];
  }

  function starPrice(countryCode) {
    const code = country(countryCode);
    const rows = cache ? normalize(cache.starPrices) : [];
    return rows.find((row) => String(row.country_code || '').toUpperCase() === code)
      || rows.find((row) => String(row.country_code || '').toUpperCase() === 'DEFAULT')
      || null;
  }

  function tokenPrice(packId) {
    const id = String(packId || '').trim().toLowerCase();
    const rows = cache ? normalize(cache.tokenPrices) : [];
    return rows.find((row) => String(row.pack_id || '').trim().toLowerCase() === id)
      || null;
  }

  function paymentSettings() {
    return cache ? cache.paymentSettings : null;
  }

  function currencyMode() {
    const mode = String(cache?.paymentSettings?.currency_mode || '').trim().toLowerCase();
    return ['stars', 'tokens', 'both'].includes(mode) ? mode : '';
  }

  function commentRule(key) {
    if (!cache?.commentRules) return null;
    return cache.commentRules[String(key || '').trim()] || null;
  }

  /*
   * État effectif des commentaires pour une publication.
   * La règle la plus précise l'emporte : publication (draw) > catégorie > global.
   * Sans aucune règle, les commentaires sont désactivés. L'administrateur
   * principal doit les activer explicitement pour une surface donnée.
   */
  function commentsEnabled(drawId, type) {
    const rules = cache?.commentRules || {};
    const global = rules.global;
    const draw = drawId ? rules[String(drawId).trim()] : null;
    const category = type ? rules[String(type).trim().toLowerCase()] : null;
    const effective = draw || category || global;
    return effective ? effective.comments_enabled === true : false;
  }

  function locks() {
    return cache ? normalize(cache.locks) : [];
  }

  function lockFor({ type, key, countryCode }) {
    const rows = locks();
    const targetType = String(type || '').trim().toLowerCase();
    const targetKey = String(key || '').trim();
    const country = String(countryCode || '').trim().toUpperCase();
    const matchesType = (row) => row.target_type === targetType || row.target_type === 'category';
    const matchesKey = (row) => !row.target_key || row.target_key === targetKey
      || (row.target_type === 'category' && row.target_key === targetType);
    const matchesCountry = (row) => !row.country_code
      || row.country_code === country
      || row.country_code === 'DEFAULT';
    const active = rows.filter((row) => Number(row.enabled) !== 0 && matchesType(row) && matchesKey(row) && matchesCountry(row));
    if (!active.length) return null;
    // La règle la plus précise (cible précise, pays précis) primerait ;
    // on retourne la première applicable triée par spécificité décroissante.
    return active.sort((a, b) => specificity(b) - specificity(a))[0] || null;
  }

  function banners(placement) {
    const rows = cache ? normalize(cache.banners) : [];
    if (!placement) return rows;
    const key = String(placement).toLowerCase();
    return rows.filter((banner) => String(banner.placement || '').toLowerCase() === key);
  }

  function grid(module) {
    const key = String(module || '').trim();
    if (!cache || !key) return null;
    const row = cache.grids[key];
    if (!row || row.enabled === false) return null;
    return { min: Number(row.min) || 1, max: Number(row.max) || 90 };
  }

  function dailyIllustrations(kind) {
    const key = String(kind || '').trim();
    if (!cache || !key) return [];
    const rows = cache.dailyIllustrations[key];
    return rows ? normalize(rows) : [];
  }

  window.cidSiteConfig = Object.freeze({
    load,
    refresh,
    plans,
    starPrice,
    tokenPrice,
    paymentSettings,
    localization: () => (cache ? cache.localization : null),
    currencyMode,
    commentRule,
    commentsEnabled,
    locks,
    lockFor,
    banners,
    grid,
    gridAssignments: () => (cache ? normalize(cache.gridAssignments) : []),
    dailyIllustrations,
    accessSnapshot,
    accessAge: () => (rawAccess ? Date.now() - rawAccessAt : Infinity),
    hasDailyAccountSnapshot: () => Boolean(persistedAccount()),
    state: () => (cache ? { ...cache } : null)
  });

  window.addEventListener('cid:admin-config-updated', () => {
    refresh({ force: true }).catch(() => {});
  });
  // The catalogue contains prices and payment settings returned by the same
  // authenticated boundary as subscription access. Do not keep an account-
  // scoped response after a user signs out or another user signs in.
  window.addEventListener('cid:auth-sync', (event) => {
    // A repeated notification for the account already loaded changes
    // nothing: only a real identity switch drops and re-reads the catalogue.
    const identity = event.detail?.id ? cacheScope() : 'visitor';
    if (identity === handledIdentity) return;
    handledIdentity = identity;
    cache = null;
    rawAccess = null;
    rawAccessAt = 0;
    publishedSignature = '';
    readCache()?.resetThrottle?.('site-config:revalidate');
    // A returning account with a snapshot saved earlier today is served
    // from localStorage instead of re-reading the database.
    const storedCatalogue = identity !== 'visitor'
      ? readCache()?.read?.(CATALOGUE_CACHE_KEY, { scope: identity, maxAgeMs: CATALOGUE_STALE_MS })
      : null;
    if (storedCatalogue?.value
      && readCache()?.isFromCurrentPublication?.(storedCatalogue.savedAt)
      && restorePersistedAccount()) {
      publish(storedCatalogue.value);
      return;
    }
    // feature-access may already have forced the read for this identity
    // from its own listener; load({ force }) then joins that request.
    refresh({ force: true }).catch(() => {});
  });
  /*
   * No focus/visibilitychange/timer revalidation. Switching apps on a phone
   * fires visibilitychange constantly; each one used to cost a
   * `subscription-access` fan-out. The catalogue now follows the
   * publication clock (visitors) or ACCOUNT_FRESH_MS (signed-in), and the
   * next navigation after expiry reconciles it in the background.
   */
})();
