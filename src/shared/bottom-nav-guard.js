/*
 * Bottom navigation guard.
 *
 * Views used to hide the persistent navigation from focus/blur events. A tap
 * on a button inside the same view (e.g. "Calculer" in Déchiffrement MT), the
 * Android back key closing the keyboard without blurring the field, or a
 * return from the Google sign-in page could leave those flags set, and the
 * visitor was stuck on a screen without navigation.
 *
 * This guard owns one measured state: html.cid-soft-keyboard-open is set only
 * while an editable field is focused AND the visible viewport has actually
 * shrunk. Whenever that is not the case, stale legacy keyboard flags are
 * released so bottom-nav.css keeps the bar on screen.
 */
(() => {
  'use strict';

  if (window.__cidBottomNavGuard) return;
  window.__cidBottomNavGuard = true;

  const root = document.documentElement;
  const KEYBOARD_MIN_HEIGHT = 150;
  const NON_TEXT_INPUTS = new Set([
    'button', 'submit', 'reset', 'checkbox', 'radio', 'range',
    'color', 'file', 'image', 'hidden'
  ]);
  const baselines = new Map();

  const isTouchDevice = () => (
    window.matchMedia?.('(pointer: coarse)').matches
      || Number(navigator.maxTouchPoints) > 0
  );

  const isEditable = (element) => {
    if (!(element instanceof Element)) return false;
    if (element.isContentEditable) return true;
    if (element instanceof HTMLTextAreaElement) {
      return !element.readOnly && !element.disabled;
    }
    if (element instanceof HTMLInputElement) {
      const type = String(element.type || 'text').toLowerCase();
      return !NON_TEXT_INPUTS.has(type) && !element.readOnly && !element.disabled;
    }
    return false;
  };

  const orientationKey = () => (
    window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
  );

  const visibleHeight = () => (
    Number(window.visualViewport?.height) || window.innerHeight || 0
  );

  const keyboardIsVisible = () => {
    const key = orientationKey();
    const height = visibleHeight();
    const baseline = Math.max(baselines.get(key) || 0, height);
    baselines.set(key, baseline);

    if (!isTouchDevice() || !isEditable(document.activeElement)) return false;
    if (!window.visualViewport) return true;
    return baseline - height > KEYBOARD_MIN_HEIGHT;
  };

  // bottom-nav.css already ignores these flags while no keyboard is visible;
  // clearing them once the field has lost focus also restores the views' own
  // spacing. classList.remove() is guarded because it always writes the
  // attribute, which would re-trigger the observer below.
  const releaseStaleFlags = () => {
    const body = document.body;
    if (!body || isEditable(document.activeElement)) return;
    const panel = document.getElementById('matrixCalculatorPanel');
    [
      [body, 'matrix-keyboard-open'],
      [body, 'cid-keyboard-input-active'],
      [panel, 'matrix-keyboard-open']
    ].forEach(([element, className]) => {
      if (element?.classList.contains(className)) element.classList.remove(className);
    });
  };

  const sync = () => {
    const open = keyboardIsVisible();
    if (root.classList.contains('cid-soft-keyboard-open') !== open) {
      root.classList.toggle('cid-soft-keyboard-open', open);
    }
    if (!open) releaseStaleFlags();
  };

  let frame = 0;
  const scheduleSync = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };

  // The keyboard animates in/out after focus changes; re-measure a few times.
  const syncSoon = () => {
    scheduleSync();
    [120, 360, 720].forEach((delay) => window.setTimeout(scheduleSync, delay));
  };

  document.addEventListener('focusin', syncSoon, true);
  document.addEventListener('focusout', syncSoon, true);
  window.visualViewport?.addEventListener('resize', scheduleSync, { passive: true });
  window.addEventListener('resize', scheduleSync, { passive: true });
  window.addEventListener('orientationchange', syncSoon, { passive: true });
  window.addEventListener('pageshow', syncSoon);
  window.addEventListener('popstate', syncSoon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncSoon();
  });

  // Any navigation tap is an explicit request to use the bar: make sure no
  // stale flag survives it.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.category-bar, [data-cid-back-button], #cidSectionBack')) {
      syncSoon();
    }
  }, true);

  ['pushState', 'replaceState'].forEach((method) => {
    const original = window.history?.[method];
    if (typeof original !== 'function') return;
    window.history[method] = function bottomNavGuardHistory(...args) {
      const result = original.apply(this, args);
      syncSoon();
      return result;
    };
  });

  // Views keep adding the legacy flags from their own focus handlers; release
  // them as soon as they are set without a visible keyboard.
  const observeFlags = () => {
    if (!document.body) return;
    new MutationObserver(scheduleSync).observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-cid-dedicated-view']
    });
  };

  if (document.body) observeFlags();
  else document.addEventListener('DOMContentLoaded', observeFlags, { once: true });

  window.cidSyncBottomNav = syncSoon;
  syncSoon();
})();
