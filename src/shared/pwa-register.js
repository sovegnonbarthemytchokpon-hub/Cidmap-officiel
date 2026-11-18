/*
 * Cidmap PWA bootstrap and automatic update.
 *
 * The main entry point owns the service-worker registration so the installed
 * app and the browser version use the same application shell.
 *
 * An app launched from the home screen is usually resumed from memory rather
 * than reloaded, so it could keep showing an old build for days while the
 * website was already up to date. Three things keep it current:
 *
 *   - update checks on start, on every wake-up (visibilitychange / focus /
 *     pageshow / online) and hourly while visible;
 *   - the worker installs with skipWaiting() and takes over with
 *     clients.claim(): `controllerchange` (or its CID_SW_ACTIVATED message)
 *     reloads the page once, transparently, on the new build;
 *   - the deploy id returned by /content-revision (polled by
 *     content-sync.js). A deployment that does not change the worker script
 *     still moves that id: the page then checks the worker and reloads.
 */
(() => {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  /*
   * This module can be evaluated again after a hot revision or an installed
   * PWA navigation. Keep registration and update checks idempotent, and move
   * them off the visual startup path so a worker update cannot compete with
   * the shell's first layout.
   */
  if (window.__cidPwaRegistrationPromise) return;

  const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
  const MIN_UPDATE_GAP_MS = 30 * 1000;
  const RELOADED_DEPLOY_KEY = 'cidmap:pwa-reloaded-deploy';

  // The first controller of a fresh install is not an update.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  let lastUpdateAt = 0;
  let pageDeploy = '';

  const isEditing = () => {
    const active = document.activeElement;
    return Boolean(active && (
      active.isContentEditable
      || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)
    ));
  };

  /*
   * Reload once. A visitor typing in a field keeps their text: the reload
   * waits until the app is backgrounded or the field loses focus.
   */
  const reloadOnce = () => {
    if (reloading) return;
    if (document.visibilityState === 'visible' && isEditing()) {
      const later = () => {
        document.removeEventListener('focusout', later, true);
        document.removeEventListener('visibilitychange', later);
        window.setTimeout(reloadOnce, 0);
      };
      document.addEventListener('focusout', later, true);
      document.addEventListener('visibilitychange', later);
      return;
    }
    reloading = true;
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    // Tell the new worker this page reloads itself (no forced navigation).
    navigator.serviceWorker.controller?.postMessage({ type: 'CID_SW_ACK' });
    reloadOnce();
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'CID_SW_ACTIVATED') return;
    event.source?.postMessage?.({ type: 'CID_SW_ACK' });
    if (hadController) reloadOnce();
  });

  const checkForUpdate = ({ force = false } = {}) => {
    const promise = window.__cidPwaRegistrationPromise;
    if (!promise || navigator.onLine === false) return Promise.resolve(null);
    const now = Date.now();
    if (!force && now - lastUpdateAt < MIN_UPDATE_GAP_MS) return promise;
    lastUpdateAt = now;
    return promise.then((registration) => {
      if (!registration) return null;
      // A worker already waiting (older script without skipWaiting) is
      // promoted now instead of on the next cold start.
      registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      return registration.update().then(() => registration).catch(() => registration);
    });
  };

  const register = () => {
    if (window.__cidPwaRegistrationPromise) return window.__cidPwaRegistrationPromise;
    window.__cidPwaRegistrationPromise = navigator.serviceWorker
      .register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none'
      })
      .then((registration) => {
        lastUpdateAt = Date.now();
        registration.update().catch(() => {});
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && registration.waiting === worker) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
        if (!window.__cidPwaReadyDispatched) {
          window.__cidPwaReadyDispatched = true;
          window.dispatchEvent(new CustomEvent('cid:pwa-ready', {
            detail: { registration }
          }));
        }
        return registration;
      })
      .catch((error) => {
        window.__cidPwaRegistrationPromise = null;
        console.warn('Service Worker Cidmap indisponible', error);
        return null;
      });
    return window.__cidPwaRegistrationPromise;
  };

  const onWake = () => {
    if (document.visibilityState === 'hidden') return;
    checkForUpdate();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  window.addEventListener('pageshow', (event) => { if (event.persisted) onWake(); });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') checkForUpdate();
  }, UPDATE_INTERVAL_MS);

  /*
   * New deployment on the server. The first id seen is the build this page
   * runs; a different one later means the site moved on. The worker is
   * checked first (a new script reloads through controllerchange); if the
   * script did not change, the page reloads itself since application code
   * is always served from the network. One reload per deploy id at most.
   */
  window.addEventListener('cid:deploy-stamp', (event) => {
    const deploy = String(event.detail?.deploy || '');
    if (!deploy) return;
    if (!pageDeploy) {
      pageDeploy = deploy;
      return;
    }
    if (deploy === pageDeploy) return;
    pageDeploy = deploy;
    try {
      if (sessionStorage.getItem(RELOADED_DEPLOY_KEY) === deploy) return;
      sessionStorage.setItem(RELOADED_DEPLOY_KEY, deploy);
    } catch (_) {}
    checkForUpdate({ force: true }).finally(() => {
      window.setTimeout(reloadOnce, 2000);
    });
  });

  const schedule = () => {
    const run = () => register();
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 4000 });
    } else {
      window.setTimeout(run, 1200);
    }
  };

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });

  window.cidPwa = Object.freeze({ checkForUpdate });
})();
