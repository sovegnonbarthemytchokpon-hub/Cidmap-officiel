/*
 * Daily data refresh (shared by Accueil / Croix nationale and Tableaux).
 *
 * The next day's publication is produced at one absolute instant:
 * 16:00:00 UTC (Africa/Abidjan, GMT+0 all year). Every calculation here is
 * done on Date.now() against Date.UTC(year, month, day, 16, 0, 0) — never on
 * the device's local "16h". A phone in China (UTC+8) therefore triggers at
 * 00:00 local time, which is 16:00 UTC, and never at its own 16:00.
 *
 * The contract, identical for every view that uses it:
 *
 *   - Previously stored publications are always read from localStorage by
 *     the view itself; this module never sends a request on its own.
 *   - `hasPublication(day)` tells whether the publication of `day` is already
 *     stored locally. Only when the latest 16:00 UTC boundary has passed AND
 *     that publication is missing is `refresh(day)` called — once.
 *   - Triggers: the real-time timer armed for the next 16:00 UTC (the app is
 *     open at that instant), and returning to the foreground
 *     (visibilitychange, focus, back/forward cache restore).
 */

export const PUBLICATION_HOUR_UTC = 16;

const DAY_MS = 24 * 60 * 60 * 1000;
// A failed or empty answer (network error, row not yet written) is retried
// by the next foreground return, but never more than once per interval.
const RETRY_INTERVAL_MS = 60 * 1000;
// setTimeout overflows above 2^31-1 ms; the boundary is always < 24 h away.
const MAX_TIMER_MS = 2 ** 31 - 1;

function utcBoundaryOf(now) {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    PUBLICATION_HOUR_UTC,
    0,
    0
  );
}

// Most recent 16:00:00 UTC instant at or before `now`.
export function latestPublicationBoundary(now = Date.now()) {
  const today = utcBoundaryOf(now);
  return now >= today ? today : today - DAY_MS;
}

// Next 16:00:00 UTC instant strictly after `now`.
export function nextPublicationBoundary(now = Date.now()) {
  const today = utcBoundaryOf(now);
  return now < today ? today : today + DAY_MS;
}

/*
 * Programme day (YYYY-MM-DD) of the publication currently in force: the
 * day following the latest 16:00 UTC boundary.
 */
export function publicationDayIso(now = Date.now()) {
  return new Date(latestPublicationBoundary(now) + DAY_MS).toISOString().slice(0, 10);
}

/*
 * Reusable lifecycle "hook". Returns `{ check, dispose }`; `check(reason)`
 * can also be called manually.
 */
export function useDailyDataRefresh({
  name = 'daily',
  hasPublication,
  refresh,
  isActive = () => true
} = {}) {
  if (typeof hasPublication !== 'function' || typeof refresh !== 'function') {
    throw new TypeError('useDailyDataRefresh requires hasPublication and refresh.');
  }
  let timer = 0;
  let inFlight = null;
  let lastAttemptDay = '';
  let lastAttemptAt = 0;
  let disposed = false;

  const check = (reason = 'manual') => {
    if (disposed || inFlight) return inFlight;
    if (document.visibilityState === 'hidden' && reason !== 'timer') return null;
    // The publication in force is always the one produced by the latest
    // 16:00 UTC boundary already passed, whatever the device time zone.
    const now = Date.now();
    const day = publicationDayIso(now);
    let active = false;
    let present = true;
    try {
      active = isActive() !== false;
      present = active ? Boolean(hasPublication(day)) : true;
    } catch (_) {}
    if (!active || present) return null;
    // The real-time boundary always gets its single request; foreground
    // returns are rate-limited so a missing row cannot cause a burst.
    if (reason !== 'timer' && day === lastAttemptDay
      && now - lastAttemptAt < RETRY_INTERVAL_MS) return null;
    lastAttemptDay = day;
    lastAttemptAt = now;
    inFlight = Promise.resolve()
      .then(() => refresh({ day, reason }))
      .catch((error) => {
        console.warn(`Actualisation ${name} de 16:00 UTC impossible`, error);
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };

  const arm = () => {
    window.clearTimeout(timer);
    if (disposed) return;
    const delay = Math.min(MAX_TIMER_MS, Math.max(0, nextPublicationBoundary() - Date.now()));
    timer = window.setTimeout(() => {
      check('timer');
      // Re-arm for the following day.
      arm();
    }, delay);
  };

  // Mobile browsers suspend timers in the background, so the timer is
  // re-armed whenever the app comes back and the missed boundary is
  // caught up by the foreground check.
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    arm();
    check('visibilitychange');
  };
  const onFocus = () => {
    arm();
    check('focus');
  };
  const onPageShow = (event) => {
    if (!event.persisted) return;
    arm();
    check('pageshow');
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  arm();

  return {
    check,
    dispose() {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onPageShow);
    }
  };
}
