/*
 * On-demand route modules (code splitting without a bundler).
 *
 * Tableaux, Anticipé and the publication history are the three heaviest
 * route controllers (~320 KB of JavaScript together). They used to be parsed,
 * compiled and initialized on every cold start, even for a visitor who only
 * reads Accueil, which is what made modest phones stutter while the first
 * screen was already scrolling.
 *
 * This classic script runs before every deferred module and installs small
 * stand-ins for the globals those modules publish (`showTableauxView`,
 * `showAnticipationView`, `cidShowPublicationHistory`, ...). Every existing
 * caller keeps its `typeof window.x === 'function'` contract:
 *
 *   - an entry point (show / fetch / ensure) imports the module on its first
 *     call, then forwards to the real implementation the module installed;
 *   - a teardown (hide / release / refresh) is a no-op until the module is
 *     loaded, because nothing of that route can be on screen yet.
 *
 * Once a module has been loaded, it overwrites the stand-ins and the second
 * visit is a plain function call. Its daily payloads are already in
 * localStorage, so the view repaints without waiting on the network.
 * Pressing a bottom navigation button starts the import on `pointerdown`,
 * ~100 ms before the click, so the first visit stays responsive too.
 */
(function installCidLazyViews() {
  'use strict';

  const MODULES = Object.freeze({
    tableaux: {
      url: '/src/tableaux/tableaux-view.js?tableaux-contract-v5-history-button',
      deps: [],
      routes: ['showTableauxView'],
      entries: [
        'showTableauxView',
        'preloadTableauxView',
        'cidFetchTableauxForDate',
        'cidEnsureTableauxStyles',
        'cidEnsureTableauxMounted',
        'cidEnsureTableauxAdminAccess'
      ],
      teardowns: ['hideTableauxView', 'cidReleaseTableauxStyles', 'cidRefreshTableaux']
    },
    // Anticipé and the history reuse the Tableaux mould and its synchronous
    // entitlement classifier, so Tableaux is always evaluated first.
    anticipe: {
      url: '/src/shared/anticipation-view.js?anticipation-v10-cache-first',
      deps: ['tableaux'],
      routes: ['showAnticipationView'],
      entries: ['showAnticipationView'],
      teardowns: ['hideAnticipationView', 'refreshAnticipationView']
    },
    history: {
      url: '/src/shared/publication-history-view.js?publication-history-v9-raf-mount',
      deps: ['tableaux'],
      routes: ['cidShowPublicationHistory'],
      entries: ['cidShowPublicationHistory'],
      teardowns: []
    }
  });

  const loading = new Map();
  const loaded = new Set();
  const stubs = new Map();
  /*
   * Route token per module. A tap on Tableaux followed by a tap on another
   * tab before the code has arrived must not mount Tableaux over the newer
   * route: every route call and every teardown bumps the token, and a route
   * call only proceeds if it is still the latest one when the module lands.
   */
  const routeTokens = new Map();
  const bumpRoute = (moduleName) => {
    const next = (routeTokens.get(moduleName) || 0) + 1;
    routeTokens.set(moduleName, next);
    return next;
  };

  function load(name) {
    const spec = MODULES[name];
    if (!spec) return Promise.reject(new Error(`Vue inconnue : ${name}`));
    if (loading.has(name)) return loading.get(name);
    const promise = Promise.all(spec.deps.map(load))
      .then(() => import(spec.url))
      .then(() => {
        loaded.add(name);
        // Tableaux renders its own "Voir l’historique" buttons; the history
        // module (archive + first-unlock prefetch of the nine publications)
        // follows once the main thread is idle so it never delays the tap.
        if (name === 'tableaux') {
          const idle = window.requestIdleCallback
            || ((callback) => window.setTimeout(callback, 1500));
          idle(() => load('history').catch(() => {}), { timeout: 6000 });
        }
        return true;
      })
      .catch((error) => {
        // A network failure (offline first visit) must not poison the next
        // tap: forget the attempt so it can be retried.
        loading.delete(name);
        throw error;
      });
    loading.set(name, promise);
    return promise;
  }

  function realFunction(name) {
    const fn = window[name];
    return typeof fn === 'function' && fn !== stubs.get(name) ? fn : null;
  }

  function installEntry(moduleName, globalName, isRoute) {
    if (typeof window[globalName] === 'function') return;
    const stub = function cidLazyEntry(...args) {
      const token = isRoute ? bumpRoute(moduleName) : 0;
      return load(moduleName).then(() => {
        if (isRoute && routeTokens.get(moduleName) !== token) return false;
        const fn = realFunction(globalName);
        if (!fn) throw new Error(`${globalName} indisponible après chargement.`);
        return fn(...args);
      }).catch((error) => {
        console.warn(`Chargement de la vue ${moduleName} impossible`, error);
        return false;
      });
    };
    stubs.set(globalName, stub);
    window[globalName] = stub;
  }

  function installTeardown(moduleName, globalName) {
    if (typeof window[globalName] === 'function') return;
    const stub = function cidLazyTeardown() {
      // Leaving a route that is still downloading cancels its pending mount.
      bumpRoute(moduleName);
    };
    stubs.set(globalName, stub);
    window[globalName] = stub;
  }

  Object.entries(MODULES).forEach(([moduleName, spec]) => {
    spec.entries.forEach((globalName) => (
      installEntry(moduleName, globalName, spec.routes.includes(globalName))
    ));
    spec.teardowns.forEach((globalName) => installTeardown(moduleName, globalName));
  });

  /*
   * Back/forward to a Tableaux entry. Once the module is loaded its own
   * popstate listener owns this; before that, nobody else would mount it.
   * (Anticipé back/forward is already routed by categories-view.js.)
   */
  window.addEventListener('popstate', (event) => {
    if (loaded.has('tableaux')) return;
    const section = new URLSearchParams(window.location.search).get('section');
    if (event.state?.view !== 'tableaux' && section !== 'tableaux') return;
    window.showTableauxView({ updateHistory: false });
  });

  // Start downloading a route as soon as its button is pressed.
  const INTENT = Object.freeze({
    tableauxBtn: () => load('tableaux'),
    anticipationBtn: () => load('anticipe'),
    profileBtn: () => window.cidPreloadAccountView?.()
  });
  /*
   * Instant feedback: the pressed tab lights up on pointerdown, in the same
   * frame as the finger lands, instead of after the route has been mounted
   * by the click handler. The route itself still runs on `click`; a press
   * that is cancelled (finger slid away) restores the previous tab.
   */
  const NAV_TABS = Object.freeze({
    categoryAccueilButton: 'accueil',
    tableauxBtn: 'tableaux',
    categoryCategoriesButton: 'categories',
    anticipationBtn: 'anticipe',
    profileBtn: 'compte'
  });
  let pressedFrom = null;
  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.category-bar .category-item');
    if (!button) return;
    const tab = NAV_TABS[button.id];
    if (tab && typeof window.setBottomNavActiveTab === 'function'
      && event.isPrimary !== false && (event.button === 0 || event.button === undefined)) {
      pressedFrom = window.__activeTab || null;
      window.setBottomNavActiveTab(tab);
    }
    const start = INTENT[button.id];
    if (!start) return;
    Promise.resolve().then(start).catch(() => {});
  }, { capture: true, passive: true });
  document.addEventListener('pointercancel', () => {
    if (pressedFrom === null) return;
    window.setBottomNavActiveTab?.(pressedFrom);
    pressedFrom = null;
  }, { capture: true, passive: true });
  document.addEventListener('click', () => { pressedFrom = null; }, { capture: true, passive: true });
  // iOS Safari only applies :active styles when a touch listener exists.
  document.addEventListener('touchstart', () => {}, { passive: true });

  window.cidLazyViews = Object.freeze({
    load,
    isLoaded: (name) => loaded.has(name)
  });
})();
