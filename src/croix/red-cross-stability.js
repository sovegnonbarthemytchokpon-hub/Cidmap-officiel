/*
 * First-paint guard for the home Croix nationale.
 *
 * The cross markup and its CSS are intentionally kept untouched. This small
 * script only makes the already-rendered static shell visible immediately;
 * redCrossService.js can then replace the single-character placeholders with
 * the official
 * record when it is available.
 */
(function ensureStaticCroixFirstPaint() {
  'use strict';

  const cross = document.getElementById('redCross');
  if (!cross) return;

  function programmeDayAt16h() {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Abidjan',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        hourCycle: 'h23'
      }).formatToParts(now);
      const value = (type) => Number(
        parts.find((part) => part.type === type)?.value
      );
      const date = new Date(Date.UTC(
        value('year'),
        value('month') - 1,
        value('day') + (value('hour') >= 16 ? 1 : 0),
        12
      ));
      return date.getUTCDay();
    } catch (_) {
      return new Date().getDay();
    }
  }

  const requestedSection = new URLSearchParams(window.location.search)
    .get('section')
    ?.trim()
    .toLowerCase();

  // Keep the dedicated section routing contract: a direct Categories (or
  // another view) navigation must not flash the home cross during startup.
  const isHomeRoute = !requestedSection || requestedSection === 'accueil';
  const isLoadingSkeleton = cross.dataset.crossReady !== 'true';
  const crossDay = programmeDayAt16h();

  // The HTML already contains the canonical single-character skeleton. While
  // the card is still marked as not ready, force every slot to 0; after a real payload
  // has been painted, never overwrite its official values.
  cross.querySelectorAll('.cross-numbers .num').forEach((number) => {
    if (isLoadingSkeleton || !String(number.textContent || '').trim()) {
      number.textContent = '0';
    }
  });

  const termTitle = cross.querySelector('.term-title');
  if (termTitle && (isLoadingSkeleton || !String(termTitle.textContent || '').trim())) {
    termTitle.textContent = 'Terminaison 0';
  }
  const termParen = cross.querySelector('.term-paren');
  if (termParen && (isLoadingSkeleton || !String(termParen.textContent || '').trim())) {
    termParen.textContent = '(00)';
  }

  // data-cross-ready=false is the only CSS visibility gate for this card.
  // Marking the static skeleton ready prevents a server response from
  // controlling first paint; the service still owns all official values.
  cross.dataset.crossReady = 'true';
  cross.dataset.crossDay = String(crossDay);
  const clone = document.getElementById('redCrossClone');
  if (clone) {
    clone.dataset.crossReady = 'true';
    clone.dataset.crossDay = String(crossDay);
  }

  if (isHomeRoute) {
    cross.style.display = 'flex';
    cross.setAttribute('aria-hidden', 'false');
  }
})();
