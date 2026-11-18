/*
 * Supabase browser boundary.
 *
 * The anon key is safe to expose in a browser, but it must always be
 * protected by Supabase RLS policies. The values are kept in
 * /src/auth/supabase-config.js. If Supabase is not configured, account
 * operations fail explicitly instead of switching to a local account.
 */
/*
 * Never block the first paint on the network.
 *
 * The SDK used to be a static `import` from the CDN. Every module script in
 * index.html (feed, navigation, render readiness...) is executed in document
 * order, so a slow CDN response held the whole application behind a white
 * screen or the "Chargement des publications..." overlay. The SDK is now
 * loaded dynamically: this module evaluates immediately, the page renders
 * from local caches, and Supabase joins in the background when it arrives.
 */
const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
// Strict budget for any Supabase round trip (REST, RPC, Auth, Edge
// Functions). Past it the request is aborted and callers fall back to their
// local cache instead of leaving a spinner on screen.
export const SUPABASE_NETWORK_TIMEOUT_MS = 8000;
// User-initiated writes that are not part of page loading and legitimately
// take longer: administrator operations, assistant/support replies (already
// budgeted at 30 s by resultat-aide.js) and payment creation. Aborting them
// early would lose the user's action, not unblock a screen.
const EXTENDED_NETWORK_TIMEOUT_MS = 45000;
const EXTENDED_FUNCTIONS = /\/functions\/v1\/(?:admin-|support-chat|result-helf|create-paystack-payment)/;

const config = window.CIDGROUP_SUPABASE_CONFIG || {};
const supabaseUrl = String(config.url || '').trim();
const supabaseAnonKey = String(config.anonKey || '').trim();
const isConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function timeoutFor(input) {
  const url = typeof input === 'string' ? input : String(input?.url || input || '');
  return EXTENDED_FUNCTIONS.test(url)
    ? EXTENDED_NETWORK_TIMEOUT_MS
    : SUPABASE_NETWORK_TIMEOUT_MS;
}

function timeoutError() {
  const error = new Error('Supabase n’a pas répondu à temps.');
  error.name = 'TimeoutError';
  error.code = 'CID_NETWORK_TIMEOUT';
  return error;
}

/*
 * fetch() with a hard deadline. A caller-supplied AbortSignal (supabase-js
 * `.abortSignal()`) is still honoured.
 */
export function fetchWithTimeout(input, init = {}, timeoutMs = timeoutFor(input)) {
  const controller = new AbortController();
  const upstream = init?.signal;
  let timedOut = false;
  const onUpstreamAbort = () => controller.abort(upstream.reason);
  if (upstream) {
    if (upstream.aborted) controller.abort(upstream.reason);
    else upstream.addEventListener('abort', onUpstreamAbort, { once: true });
  }
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // Edge Function answers (daily publications) must never come from the
  // browser or Service Worker cache: the 16:00 UTC refresh needs the network.
  const url = typeof input === 'string' ? input : String(input?.url || input || '');
  const cache = init?.cache || (/\/functions\/v1\//.test(url) ? 'no-store' : undefined);
  return window.fetch(input, {
    ...init,
    ...(cache ? { cache } : {}),
    signal: controller.signal
  })
    .catch((error) => {
      throw timedOut ? timeoutError() : error;
    })
    .finally(() => {
      window.clearTimeout(timer);
      upstream?.removeEventListener?.('abort', onUpstreamAbort);
    });
}

// Live binding: null until the SDK has loaded.
let client = null;
const clientWaiters = [];

/*
 * Run `callback(client)` as soon as the client exists (immediately when it
 * already does). Used by modules that must attach auth listeners even if the
 * SDK arrives after their own evaluation.
 */
export function whenSupabaseClient(callback) {
  if (typeof callback !== 'function') return;
  if (client) {
    callback(client);
    return;
  }
  clientWaiters.push(callback);
}

function clearAuthCallbackUrl() {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  const hasAuthFragment = /(?:^|&)(?:access_token|refresh_token|provider_token|expires_at|expires_in|token_type)=/i
    .test(url.hash.replace(/^#/, ''));
  const authQueryKeys = ['code', 'error', 'error_code', 'error_description'];
  const hasAuthQuery = authQueryKeys.some((key) => url.searchParams.has(key));
  if (!hasAuthFragment && !hasAuthQuery) return;
  url.hash = '';
  authQueryKeys.forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

/*
 * `auth.getUser()` is a server round trip that reads auth.users on every
 * call. Repositories call it defensively before almost every query, so the
 * same token used to be validated dozens of times per page. Memoize the
 * validated user per access token for a short window: the token itself is
 * already signed and short-lived, any auth state change clears the entry
 * below, and privileged reads/writes remain gated by RLS and by the Edge
 * Functions rather than by this local snapshot.
 */
const USER_VALIDATION_TTL_MS = 60 * 1000;
let validatedUser = null;

function invalidateValidatedUser() {
  validatedUser = null;
}

const bridge = {
  // Getters so callers that captured the bridge before the SDK finished
  // loading see the client as soon as it is available.
  get client() { return client; },
  get functions() { return client?.functions || null; },
  get auth() { return client?.auth || null; },
  isConfigured,
  get isReady() { return Boolean(client); },
  async getUser() {
    if (!client) return null;
    /*
     * Read the local session envelope first so anonymous visits stay
     * completely quiet and avoid an unnecessary round trip. When a session
     * exists, retain the server-side validation before exposing the user to
     * callers - but only once per token per TTL window.
     */
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const session = sessionData?.session || null;
    if (sessionError || !session?.user?.id) {
      invalidateValidatedUser();
      return null;
    }
    const token = String(session.access_token || '');
    if (validatedUser
      && validatedUser.token === token
      && Date.now() - validatedUser.at < USER_VALIDATION_TTL_MS) {
      return validatedUser.user;
    }
    if (validatedUser?.pending && validatedUser.token === token) {
      return validatedUser.pending;
    }
    const pending = (async () => {
      const { data, error } = await client.auth.getUser();
      if (error) {
        invalidateValidatedUser();
        return null;
      }
      const user = data?.user || null;
      validatedUser = { token, user, at: Date.now(), pending: null };
      return user;
    })();
    validatedUser = { token, user: null, at: 0, pending };
    return pending;
  },
  async getSession() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) return null;
    return data?.session || null;
  }
};

function installClient(createClient) {
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Keep OAuth callbacks out of the URL fragment. The implicit flow
      // exposes bearer tokens in copied links; PKCE returns a short-lived
      // code that the client exchanges for the session.
      flowType: 'pkce'
    },
    global: { fetch: fetchWithTimeout }
  });

  // Supabase has already been initialized with detectSessionInUrl, so this
  // listener runs after the callback has been consumed. Removing the
  // callback parameters prevents access tokens from being copied or stored
  // in browser history.
  client.auth.onAuthStateChange((event) => {
    // Any session transition (including a silent token refresh) retires the
    // memoized validation above so the next read revalidates once.
    invalidateValidatedUser();
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
      window.setTimeout(clearAuthCallbackUrl, 0);
    }
  });

  clientWaiters.splice(0).forEach((callback) => {
    try { callback(client); } catch (error) { console.warn(error); }
  });
  window.dispatchEvent(new CustomEvent('cid:supabase-ready', { detail: { bridge } }));
  return bridge;
}

const sdkLoad = isConfigured
  ? import(SUPABASE_SDK_URL)
    .then(({ createClient }) => installClient(createClient))
    .catch((error) => {
      console.warn('Supabase SDK indisponible, affichage depuis le cache local.', error?.message || error);
      return bridge;
    })
  : Promise.resolve(bridge);

// auth.js is intentionally kept as a classic script for legacy embeds.
// Expose the small bridge globally while retaining named module exports for
// future modules.
window.cidSupabase = bridge;
/*
 * Resolves with the bridge once the SDK is ready, or after the network budget
 * with a client-less bridge so no caller waits indefinitely. Repositories
 * then throw "Supabase est indisponible" and the UI keeps its cached data; a
 * late SDK still installs itself and announces `cid:supabase-ready`.
 */
window.cidSupabaseReady = Promise.race([
  sdkLoad,
  new Promise((resolve) => window.setTimeout(() => resolve(bridge), SUPABASE_NETWORK_TIMEOUT_MS))
]);

export { client as supabaseClient };
export const supabase = bridge;
export default bridge;
