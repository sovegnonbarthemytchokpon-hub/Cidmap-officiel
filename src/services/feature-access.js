/*
 * Public feature gate driven by the server-side balance and individual
 * feature grants. Tableaux cards never inherit access from a global plan.
 *
 * The server subscription is the source of truth. Prediction features are
 * protected by default and only an active database entitlement can reveal
 * their values.
 */
(function initCidFeatureAccess() {
  'use strict';

  /*
   * Feature keys are database data. This client only keeps aliases for old
   * links; the active catalogue is always read from Supabase.
   */
  const LEGACY_FEATURE_ALIASES = Object.freeze({
    universelle: 'tableaux-universelle',
    intuition: 'tableaux-intuition',
    oracle: 'tableaux-oracle',
    lnb: 'tableaux-lnb',
    balsa: 'tableaux-balsa',
    standby: 'tableaux-standby'
  });
  const normalizeFeatureKey = (value) => {
    const key = String(value || '').trim().toLowerCase();
    return LEGACY_FEATURE_ALIASES[key] || key;
  };
  /*
   * Entitlements stay server-authoritative: every protected payload is still
   * gated by user_can_access_tableau() and by the Edge Functions, which fail
   * closed. What changed is how often this snapshot is re-read.
   *
   * This module used to invoke `subscription-access` with the exact same
   * body that site-config had just invoked, on every navigation tap, on
   * every focus, on every visibilitychange and on a 30 s timer - two
   * identical fan-outs over twenty-odd tables each time. It now reuses the
   * single response site-config already holds and keeps a short freshness
   * window, while purchase, unlock and auth events invalidate it explicitly.
   *
   * There is no background timer and no focus/visibilitychange re-read:
   * the snapshot is only re-read on an explicit event (auth, purchase,
   * administrator change) or when the visitor taps a paid section that the
   * cached snapshot reports as locked (requireAccess confirms that "no"
   * once against the database). An idle or backgrounded tab issues no
   * request at all.
   */
  const ACCESS_FRESH_MS = 15 * 60 * 1000;
  const REVALIDATE_MIN_INTERVAL_MS = 5 * 60 * 1000;
  const DENIAL_CONFIRM_MIN_INTERVAL_MS = 30 * 1000;

  const readCache = () => window.cidReadCache || null;
  let state = null;
  let stateAt = 0;
  let publishedSignature = '';
  let pending = null;
  let pendingEpoch = 0;
  let authEpoch = 0;
  let handledIdentity = '';

  // Balances/costs may arrive formatted ("24 000", incl. non-breaking
  // spaces); Number() would read them as NaN -> 0. Strip separators first.
  const parseAmount = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const digits = String(value ?? '').replace(/[\s\u00a0\u202f'’.,]/g, '');
    const parsed = Number(digits);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  /*
   * Grants, balances and the plan catalogue drive locked/unlocked painting.
   * Re-announcing an identical snapshot made Tableaux and the offers panel
   * re-render (and therefore re-query) for nothing, so only a real change is
   * published.
   */
  function accessSignature(value) {
    if (!value) return 'empty';
    return readCache()?.signature?.({
      plans: value.plans,
      rules: value.rules,
      settings: value.settings,
      subscription: value.subscription,
      activePlan: value.activePlan,
      featureUnlocks: value.featureUnlocks,
      earlyAccessRules: value.earlyAccessRules,
      earlyAccessUnlocks: value.earlyAccessUnlocks,
      earlyAccessGrants: value.earlyAccessGrants,
      starPrices: value.starPrices,
      tokenPrices: value.tokenPrices,
      gridAssignments: value.gridAssignments,
      localeCode: value.localeCode,
      stars: value.stars,
      tokens: value.tokens,
      countryCode: value.countryCode
    }) || '';
  }

  function publish(nextState, { announce = true } = {}) {
    state = nextState;
    stateAt = nextState ? Date.now() : 0;
    const nextSignature = accessSignature(nextState);
    if (!announce) {
      publishedSignature = nextSignature;
      return state;
    }
    if (nextSignature && nextSignature === publishedSignature) return state;
    publishedSignature = nextSignature;
    window.dispatchEvent(new CustomEvent('cid:feature-access-changed', {
      detail: nextState || null
    }));
    return state;
  }

  async function load({ force = false, maxAgeMs } = {}) {
    if (!force && state && Date.now() - stateAt <= (maxAgeMs ?? ACCESS_FRESH_MS)) return state;
    if (pending && pendingEpoch === authEpoch) return pending;
    const requestEpoch = authEpoch;
    pending = (async () => {
      // The secure database remains the source of truth for the paid
      // catalogue. site-config owns the single `subscription-access` state
      // request; this module consumes its cached response instead of issuing
      // a duplicate one.
      const config = await (
        window.cidSiteConfig?.load?.({ force, maxAgeMs })
        || Promise.resolve(null)
      ).catch(() => null);
      const configPlans = config ? (Array.isArray(config.plans) ? config.plans : []) : [];
      const configRules = [];
      configPlans
        .filter((plan) => plan.enabled !== false)
        .forEach((plan) => {
          (Array.isArray(plan.features) ? plan.features : []).forEach((feature) => {
            configRules.push({
              feature_key: feature,
              required_stars: parseAmount(plan.required_stars),
              required_tokens: parseAmount(plan.required_tokens),
              plan_slug: plan.slug,
              display_name: plan.display_name
            });
          });
        });

      // Overlay the authenticated account (balance, active subscription).
      // This is the very same `subscription-access` payload the catalogue
      // request above already returned, so it costs no additional read.
      let accountAccess = null;
      try {
        accountAccess = await (
          window.cidSiteConfig?.accessSnapshot?.({ force, maxAgeMs })
          || Promise.resolve(null)
        );
      } catch (_) {
        accountAccess = null;
      }

      const access = accountAccess || {};
      /*
       * Early-access rules describe the public catalogue, not a user's
       * private balance. Some subscription-access responses only include the
       * rules relevant to the current account, which made Anticipé show
       * different future dates after switching users. Start with the public
       * catalogue and let an account response override the same feature key.
       */
      const publicEarlyAccessRules = Array.isArray(config?.earlyAccessRules)
        ? config.earlyAccessRules
        : [];
      const accountEarlyAccessRules = Array.isArray(access.earlyAccessRules)
        ? access.earlyAccessRules
        : [];
      const earlyAccessRulesByKey = new Map();
      [...publicEarlyAccessRules, ...accountEarlyAccessRules].forEach((rule) => {
        const key = normalizeFeatureKey(rule?.feature_key || rule?.featureKey);
        if (key) earlyAccessRulesByKey.set(key, { ...rule, feature_key: key });
      });
      // A response started for the previous account must never repaint the
      // newly selected account after logout/login.
      if (requestEpoch !== authEpoch) return state;
      const nextState = {
        plans: Array.isArray(access.plans) && access.plans.length ? access.plans : configPlans,
        // The public catalogue already carries every individual rule and
        // its price. Use it whenever no account snapshot is available so
        // visitors (signed in or not) always see prices and unlock buttons.
        rules: Array.isArray(access.rules) && access.rules.length
          ? access.rules
          : Array.isArray(config?.accessRules) && config.accessRules.length
            ? config.accessRules
            : configRules,
        settings: access.settings || config?.paymentSettings || null,
        localization: access.localization || config?.localization || null,
        localeCode: access.localization?.selectedLocale
          || config?.localeCode
          || window.cidTranslation?.current?.()
          || 'fr',
        starPrices: Array.isArray(access.starPrices) && access.starPrices.length
          ? access.starPrices
          : (Array.isArray(config?.starPrices) ? config.starPrices : []),
        tokenPrices: Array.isArray(access.tokenPrices) && access.tokenPrices.length
          ? access.tokenPrices
          : (Array.isArray(config?.tokenPrices) ? config.tokenPrices : []),
        gridAssignments: Array.isArray(config?.gridAssignments) ? config.gridAssignments : [],
        subscription: access.subscription || null,
        activePlan: access.activePlan || null,
        featureUnlocks: Array.isArray(access.featureUnlocks)
          ? access.featureUnlocks
          : [],
        earlyAccessRules: Array.from(earlyAccessRulesByKey.values()),
        earlyAccessUnlocks: Array.isArray(access.earlyAccessUnlocks)
          ? access.earlyAccessUnlocks
          : [],
        earlyAccessGrants: Array.isArray(access.earlyAccessGrants)
          ? access.earlyAccessGrants
          : [],
        stars: parseAmount(access.stars),
        tokens: parseAmount(access.tokens),
        countryCode: access.countryCode || ''
      };
      return publish(nextState);
    })().catch(() => {
      if (requestEpoch !== authEpoch) return state;
      // Fail closed. A transient database error must not leave a previous
      // account's entitlement visible as an active purchase state.
      publishedSignature = '';
      return publish(null);
    }).finally(() => {
      if (pendingEpoch === requestEpoch) pending = null;
    });
    pendingEpoch = requestEpoch;
    return pending;
  }

  function activeSubscription(access) {
    const subscription = access?.subscription;
    if (!subscription || subscription.status !== 'active') return null;
    if (subscription.started_at
      && Date.parse(subscription.started_at) > Date.now()) return null;
    if (subscription.expires_at) {
      const expiresAt = Date.parse(subscription.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    }
    return subscription;
  }

  function planIncludesFeature(plan, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    const features = Array.isArray(plan?.features) ? plan.features : [];
    const normalizedFeatures = features.map(normalizeFeatureKey);
    return normalizedFeatures.includes(normalizedFeatureKey)
      || (
        normalizedFeatureKey.startsWith('tableaux-')
        && normalizedFeatures.includes('tableaux')
      );
  }

  function ruleFor(access, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    return (access?.rules || []).find((item) => (
      normalizeFeatureKey(item?.feature_key || item?.featureKey) === normalizedFeatureKey
    )) || null;
  }

  function activeGrantFor(access, featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    return (access?.featureUnlocks || []).find((unlock) => (
      normalizeFeatureKey(unlock?.feature_key || unlock?.featureKey) === normalizedFeatureKey
      && (!unlock.expires_at || Date.parse(unlock.expires_at) > Date.now())
    )) || null;
  }

  function hasAccess(access, featureKey) {
    if (window.cidIsAdmin === true) return true;
    if (!access) return false;
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    const rule = ruleFor(access, normalizedFeatureKey);
    if (activeGrantFor(access, normalizedFeatureKey)) return true;
    const plans = Array.isArray(access.plans) ? access.plans : [];
    const isConfiguredInAnOffer = plans.some((plan) => (
      planIncludesFeature(plan, normalizedFeatureKey)
    ));
    // An unconfigured key remains public. Once an administrator creates a
    // rule or assigns the key to a plan, the database is authoritative.
    if (!rule && !isConfiguredInAnOffer) return true;
    if (rule && !rule.plan_slug
      && parseAmount(rule.required_stars) === 0
      && parseAmount(rule.required_tokens) === 0
      && !isConfiguredInAnOffer) return true;
    const subscription = activeSubscription(access);
    if (!subscription) return false;
    const plan = access.activePlan;
    if (plan?.slug && rule?.plan_slug && plan.slug === rule.plan_slug) return true;
    return planIncludesFeature(plan, normalizedFeatureKey);
  }

  /*
   * End date of the entitlement that currently opens a feature: the unlock
   * grant when there is one, otherwise the active subscription covering it.
   * Returns null when access is open-ended or not granted.
   */
  function accessExpiresAt(access, featureKey) {
    if (!access) return null;
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    const grant = activeGrantFor(access, normalizedFeatureKey);
    const fromGrant = grant?.expires_at ? Date.parse(grant.expires_at) : NaN;
    if (Number.isFinite(fromGrant)) return new Date(fromGrant);
    const subscription = activeSubscription(access);
    const fromSubscription = subscription?.expires_at
      ? Date.parse(subscription.expires_at)
      : NaN;
    return Number.isFinite(fromSubscription) ? new Date(fromSubscription) : null;
  }

  async function requireAccess(featureKey, options = {}) {
    /*
     * Navigation must not wait for a fresh network round-trip every time a
     * visitor taps a section. The catalogue is warmed in the background and
     * refreshed on focus/visibility changes. Reusing the current snapshot
     * keeps the first tap synchronous once that warm-up has completed while
     * preserving the same server-backed entitlement decision.
     */
    const access = await load();
    if (hasAccess(access, featureKey)) return true;
    /*
     * A cached "no" is confirmed once against the database before the
     * visitor is redirected, so a purchase completed in another tab cannot
     * leave the card locked. A cached "yes" never costs an extra read, and
     * the confirmation itself is throttled so repeated taps on a locked card
     * cannot turn into a read loop.
     */
    if (state && readCache()?.allow?.(
      'feature-access:deny-confirm',
      DENIAL_CONFIRM_MIN_INTERVAL_MS
    ) !== false) {
      const confirmed = await load({ force: true }).catch(() => null);
      if (hasAccess(confirmed, featureKey)) return true;
    }
    const isCurrent = typeof options?.isCurrent === 'function'
      ? options.isCurrent
      : () => true;
    if (!isCurrent()) return false;
    // Keep rejected navigation on the existing account/auth surface. The
    // former dedicated offers page rendered a misleading zero-balance state
    // before the account service had finished loading.
    window.setTimeout(() => {
      if (!isCurrent()) return;
      window.showProfileView?.();
      window.setTimeout(() => window.cidSetAccountTab?.('rewards', { immediate: true }), 100);
    }, 0);
    return false;
  }

  /*
   * Server-side preflight for protected Tableaux payloads.
   *
   * The entitlement snapshot is useful for painting the shell, but a
   * protected programme request must also be backed by the database function
   * user_can_access_tableau(). This second check prevents a stale browser
   * snapshot from authorising a remote loader after a grant has expired or
   * been revoked.
   */
  async function verifyTableauxAccess(featureKey) {
    const normalizedFeatureKey = normalizeFeatureKey(featureKey);
    if (!normalizedFeatureKey.startsWith('tableaux-')) return false;
    try {
      const bridge = await window.cidSupabaseReady;
      const client = bridge?.client;
      if (!client?.rpc) {
        return window.cidIsAdmin === true
          || hasAccess(state, normalizedFeatureKey);
      }
      const { data, error } = await client.rpc('user_can_access_tableau', {
        target_feature_key: normalizedFeatureKey
      });
      /*
       * The Edge Functions remain the final authority and fail closed. This
       * browser preflight may fall back to the already verified entitlement
       * snapshot so Safari/network hiccups do not hide valid content before
       * the protected function has a chance to answer.
       */
      if (error) {
        return window.cidIsAdmin === true
          || hasAccess(state, normalizedFeatureKey);
      }
      return data === true || data?.access === true || data?.allowed === true;
    } catch (_) {
      return window.cidIsAdmin === true
        || hasAccess(state, normalizedFeatureKey);
    }
  }

  window.cidFeatureAccess = Object.freeze({
    load,
    preload: () => load(),
    /*
     * `refresh()` is a revalidation request. The throttle collapses the
     * focus and visibilitychange callers into one read; callers
     * that really invalidated the state pass { force: true }.
     */
    refresh: (options = {}) => {
      if (options?.force === true) return load({ force: true });
      if (readCache()?.allow?.('feature-access:revalidate', REVALIDATE_MIN_INTERVAL_MS) === false) {
        // A throttled revalidation still answers with a snapshot: after an
        // auth switch the state is empty and must be read, not skipped.
        return state ? Promise.resolve(state) : load(options);
      }
      return load(options);
    },
    /*
     * A successful debit response already contains the authoritative access
     * snapshot. Adopt it immediately instead of allowing an older refresh
     * request to repaint the card as locked again.
     */
    adopt: (nextState) => {
      if (!nextState || typeof nextState !== 'object') return state;
      const merged = state && typeof state === 'object'
        ? { ...state, ...nextState }
        : nextState;
      state = merged;
      stateAt = Date.now();
      publishedSignature = accessSignature(merged);
      window.dispatchEvent(new CustomEvent('cid:feature-access-changed', {
        detail: state
      }));
      return state;
    },
    state: () => state,
    has: (featureKey) => hasAccess(state, featureKey),
    expiresAt: (featureKey) => accessExpiresAt(state, featureKey),
    verifyTableauxAccess,
    require: requireAccess,
    reset: () => {
      state = null;
      stateAt = 0;
      publishedSignature = '';
      pending = null;
      window.dispatchEvent(new CustomEvent('cid:feature-access-changed', { detail: null }));
    },
    protectedFeatures: Object.freeze([])
  });
  window.addEventListener('cid:auth-sync', (event) => {
    // Same account notified again: the snapshot is still the right one.
    const identity = String(event.detail?.id || '');
    if (identity === handledIdentity) return;
    handledIdentity = identity;
    authEpoch += 1;
    state = null;
    stateAt = 0;
    publishedSignature = '';
    readCache()?.resetThrottle?.('feature-access:revalidate');
    // Do not wait for the old request to finish before locking the cards.
    // Its result is ignored by the epoch check above.
    window.dispatchEvent(new CustomEvent('cid:feature-access-changed', { detail: null }));
    // Access data saved in localStorage earlier in the same publication day
    // repaints the unlocked Tableaux without a redundant database read.
    const dailySnapshot = Boolean(window.cidSiteConfig?.hasDailyAccountSnapshot?.());
    window.cidFeatureAccess.load({ force: !dailySnapshot }).catch(() => {});
  });

  /*
   * An administrator change made in this tab takes effect immediately.
   */
  window.addEventListener('cid:admin-access-updated', () => {
    window.cidFeatureAccess.refresh({ force: true }).catch(() => {});
  });
  /*
   * A completed purchase or unlock is the client-side event that must
   * invalidate the snapshot immediately.
   */
  window.addEventListener('cid:subscription-unlocked', () => {
    window.cidFeatureAccess.refresh({ force: true }).catch(() => {});
  });

  /*
   * Warm the catalogue after the current script/module batch has registered.
   * This is intentionally deferred so it never competes with the first paint
   * or makes a tap wait on an avoidable startup request.
   */
  window.setTimeout(() => {
    window.cidFeatureAccess.load().catch(() => {});
  }, 0);
})();
