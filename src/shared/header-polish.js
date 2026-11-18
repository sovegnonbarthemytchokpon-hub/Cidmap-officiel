/*
 * Keep the header glass state in sync with the app's actual scroll surface.
 * The main app uses #results instead of document scrolling, while a few
 * dedicated views expose their own scroll container.
 */
(function initAdaptiveHeader() {
  function bind() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    const surfaces = [
      '#results',
      '#tableauxViewContainer',
      '#categoriesView',
      '#croixViewContainer',
      '#anticipationViewContainer',
      '#historyViewContainer'
    ].map((selector) => document.querySelector(selector)).filter(Boolean);

    // Scroll events fire faster than the display refreshes; read scrollTop
    // at most once per frame so the header never competes with scrolling.
    let frame = 0;
    let pendingSurface = null;
    function updateHeaderState(event) {
      pendingSurface = event && event.currentTarget !== window ? event.currentTarget : null;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const scrollTop = pendingSurface
          ? pendingSurface.scrollTop
          : Math.max(
              window.scrollY || 0,
              document.documentElement.scrollTop || 0,
              ...surfaces.map((surface) => surface.scrollTop || 0)
            );
        const scrolled = scrollTop > 4;
        if (header.classList.contains('is-scrolled') !== scrolled) {
          header.classList.toggle('is-scrolled', scrolled);
        }
      });
    }

    surfaces.forEach((surface) => {
      surface.addEventListener('scroll', updateHeaderState, { passive: true });
    });
    window.addEventListener('scroll', updateHeaderState, { passive: true });
    updateHeaderState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
