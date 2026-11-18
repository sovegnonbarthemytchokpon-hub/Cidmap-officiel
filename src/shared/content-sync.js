/*
 * Background content synchronisation (offline-first).
 *
 * Every view paints from localStorage first. This module decides when those
 * local copies are no longer valid and refreshes them without a page reload:
 *
 *   1. Daily publication: at 16:00:00 UTC (Date.now() against
 *      Date.UTC(y, m, d, 16, 0, 0), never the phone's local clock), through
 *      the shared useDailyDataRefresh lifecycle (timer + visibilitychange /
 *      focus / pageshow on wake-up). Croix and Tableaux already register
 *      their own refresh; this one re-checks the administrator stamp and
 *      refreshes Anticipé when it is on screen.
 *
 *   2. Administrator changes: /content-revision (netlify/functions) keeps a
 *      revision per kind of change. When one moved since this device last
 *      looked, the matching local copies are dropped and the existing
 *      `cid:admin-*` events make the mounted views re-read and repaint in
 *      place. The administrator's tab announces its own writes here.
 *
 * Checks run on wake-up, on focus, when the network comes back and every few
 * minutes while the app is visible. The stamp is a few bytes; no publication
 * data goes through it.
 */
import {
  publicationDayIso,
  useDailyDataRefresh
} from './daily-data-refresh.js';

const ENDPOINT = '/content-revision';
const STORAGE_KEY = 'cidmap:content-revision:v1';
const POLL_INTERVAL_MS = 3 * 60 * 1000;
// Several wake-up events (focus + visibilitychange + pageshow) fire together.
const MIN_CHECK_INTERVAL_MS = 20 * 1000;
const NETWORK_TIMEOUT_MS = 6000;

/*
 * Local copies tied to programme content. They are only dropped when the
 * administrator changed publications, never for a price or banner edit.
 */
const PUBLICATION_CACHE_PREFIXES = Object.freeze([
  'cidgroup.publication.',
  'cidmap:tableaux-daily:v1:',
  'cidgroup.anticipation.v1.',
  'cidgroup.anticipation-snapshot.v1.',
  'cidgroup_neuf_publications:v1:',
  'cidgroup_neuf_publications_sync:v1:'
]);

let lastCheckAt = 0;
let inFlight = null;
let pollTimer = 0;

function readSeen() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch (_) {
    return null;
  }
}

function writeSeen(stamp) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      revision: Number(stamp?.revision) || 0,
      scopes: { ...(stamp?.scopes || {}) }
    }));
  } catch (_) {}
}

function purgePublicationCaches() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && PUBLICATION_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {}
}

function changedScopes(previous, next) {
  return Object.entries(next?.scopes || {})
    .filter(([scope, revision]) => Number(revision) > (Number(previous?.scopes?.[scope]) || 0))
    .map(([scope]) => scope);
}

function apply(scopes, stamp) {
  if (!scopes.length) return;
  const detail = { source: 'content-revision', scopes, revision: stamp.revision };
  if (scopes.includes('publication')) purgePublicationCaches();
  // Existing listeners: site-config, feature-access, banners, offers and
  // comments re-read on admin-config; Tableaux and Anticipé repaint on
  // admin-access when they are on screen.
  if (scopes.includes('config') || scopes.includes('publication')) {
    window.dispatchEvent(new CustomEvent('cid:admin-config-updated', { detail }));
    window.dispatchEvent(new CustomEvent('cid:admin-access-updated', { detail }));
  }
  // Croix, results and statistics refresh themselves on this one.
  window.dispatchEvent(new CustomEvent('cid:content-updated', { detail }));
}

async function fetchStamp() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = window.setTimeout(() => controller?.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller?.signal
    });
    if (!response.ok) return null;
    const stamp = await response.json();
    if (!stamp || typeof stamp !== 'object') return null;
    // Deployment detection for the installed app (pwa-register.js).
    if (stamp.deploy) {
      window.dispatchEvent(new CustomEvent('cid:deploy-stamp', {
        detail: { deploy: stamp.deploy }
      }));
    }
    return stamp;
  } finally {
    window.clearTimeout(timer);
  }
}

export function checkContentRevision({ force = false } = {}) {
  if (inFlight) return inFlight;
  if (document.visibilityState === 'hidden' && !force) return Promise.resolve(false);
  if (navigator.onLine === false) return Promise.resolve(false);
  const now = Date.now();
  if (!force && now - lastCheckAt < MIN_CHECK_INTERVAL_MS) return Promise.resolve(false);
  lastCheckAt = now;
  inFlight = fetchStamp()
    .then((stamp) => {
      if (!stamp) return false;
      const seen = readSeen();
      writeSeen(stamp);
      // First run on this device: the views have just loaded fresh data, so
      // the current stamp is only recorded as the baseline.
      if (!seen) return false;
      const scopes = changedScopes(seen, stamp);
      apply(scopes, stamp);
      return scopes.length > 0;
    })
    .catch(() => false)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/*
 * Called by the administrator dashboard after a successful write. The
 * administrator's own tab already refreshed through the local events, so the
 * returned stamp is recorded as seen and not applied a second time.
 */
export async function announceContentChange(scope = 'config') {
  try {
    const bridge = await Promise.resolve(window.cidSupabaseReady);
    const result = await bridge?.client?.auth?.getSession?.();
    const token = result?.data?.session?.access_token;
    if (!token) return false;
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ scope })
    });
    if (!response.ok) return false;
    writeSeen(await response.json());
    return true;
  } catch (error) {
    console.warn('Signal de mise à jour administrateur non envoyé', error);
    return false;
  }
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  if (document.visibilityState === 'hidden') return;
  pollTimer = window.setTimeout(() => {
    checkContentRevision().finally(schedulePoll);
  }, POLL_INTERVAL_MS);
}

function onWake() {
  if (document.visibilityState === 'hidden') {
    // No background polling: the next wake-up catches up.
    window.clearTimeout(pollTimer);
    return;
  }
  checkContentRevision();
  schedulePoll();
}

document.addEventListener('visibilitychange', onWake);
window.addEventListener('focus', onWake);
window.addEventListener('pageshow', (event) => { if (event.persisted) onWake(); });
window.addEventListener('online', onWake);

/*
 * 16:00 UTC publication boundary. The publication day in force when the app
 * started is already painted by each view; the hook fires once the next
 * boundary has passed, whether the app was open at that instant or woke up
 * after it.
 */
let boundaryDay = publicationDayIso();
useDailyDataRefresh({
  name: 'Synchronisation',
  hasPublication: (day) => boundaryDay === day,
  refresh: ({ day }) => {
    boundaryDay = day;
    window.dispatchEvent(new CustomEvent('cid:daily-publication', { detail: { day } }));
    // Anticipé has no timer of its own: its "next day" just became today.
    if (document.body.classList.contains('anticipation-active')) {
      window.refreshAnticipationView?.();
    }
    return checkContentRevision({ force: true });
  }
});

// First check once the startup work has settled.
const idle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 2500));
idle(() => {
  checkContentRevision({ force: true });
  schedulePoll();
}, { timeout: 5000 });

window.cidContentSync = Object.freeze({
  check: checkContentRevision,
  announce: announceContentChange
});
