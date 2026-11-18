/*
 * Cidmap service worker — one single, locked application version.
 *
 * Earlier workers answered pages, scripts and stylesheets from the cache first
 * and refreshed them in the background. After a deployment the phone kept
 * showing the previous build (old blue theme, old layouts) and could even mix
 * an old index.html with new scripts, leaving a blank page.
 *
 * Rules now:
 *  - HTML, JS, CSS and JSON always come from the network. The cache is only an
 *    offline fallback, never a preferred source.
 *  - A new version installs with skipWaiting() and takes over with
 *    clients.claim(). It then deletes every previous application cache and
 *    announces itself: up-to-date pages reload on `controllerchange` /
 *    CID_SW_ACTIVATED (src/shared/pwa-register.js); pages still running an
 *    older script that never answers are navigated by the worker, so an
 *    installed home-screen app can never stay on a previous build.
 *  - The daily look (national cross colour) is injected at runtime by the
 *    application; it never depends on which build was cached.
 *
 * Bump CACHE_VERSION on each release that must invalidate offline copies.
 */
const CACHE_VERSION = 'v64-mt-textarea-no-duplicate';
const CACHE_NAME = `cidmap-cache-${CACHE_VERSION}`;
// Application caches owned by this worker (current and every legacy name).
const APP_CACHE_PREFIXES = ['cidmap-cache-', 'cidgroup-cache-'];
const NETWORK_TIMEOUT_MS = 10000;
// How long pages get to acknowledge the new version before being navigated.
const ACK_TIMEOUT_MS = 1500;
// Window clients that reload themselves (they answered CID_SW_ACTIVATED).
const acknowledged = new Set();

// Minimal offline shell. Scripts and stylesheets are cached as they are
// fetched from the network, so this list never needs to mirror the exact
// query strings used in index.html.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/shared/images/squirrel-croix-192.png',
  '/src/shared/images/squirrel-croix-512.png',
  '/src/shared/fonts/noto-sans-latin.woff2',
  '/src/shared/fonts/noto-sans-latin-ext.woff2',
  '/src/shared/fonts/archivo-black-latin.woff2',
  '/src/shared/fonts/archivo-black-latin-ext.woff2',
  '/src/shared/fonts/audiowide-latin.woff2',
  '/src/shared/fonts/audiowide-latin-ext.woff2'
];

// Daily cross images change in place: always prefer the network.
const NETWORK_FIRST_IMAGES = [
  '/src/shared/images/croix-canonical.png',
  '/src/shared/images/redCross-610x601.png'
];

const isAppCache = (name) => APP_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));

async function fetchFresh(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    // Navigation requests cannot be rebuilt with a new cache mode, but they
    // already bypass the HTTP cache for HTML served with no-cache headers.
    const init = request.mode === 'navigate'
      ? { signal: controller.signal }
      : { cache: 'no-store', signal: controller.signal };
    return await fetch(request, init);
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetchFresh(request);
    if (response && response.ok && response.type === 'basic') {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('/index.html') || await cache.match('/');
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.allSettled(
      // One unavailable asset must not abort the whole install.
      PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    const stale = names.filter((name) => isAppCache(name) && name !== CACHE_NAME);
    await Promise.all(stale.map((name) => caches.delete(name)));
    await self.clients.claim();

    // Replacing an older version: every open page must leave the previous
    // build now, not on the next visit.
    if (stale.length) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach((client) => client.postMessage({
        type: 'CID_SW_ACTIVATED',
        version: CACHE_VERSION
      }));
      await new Promise((resolve) => setTimeout(resolve, ACK_TIMEOUT_MS));
      await Promise.all(windows
        .filter((client) => !acknowledged.has(client.id))
        .map((client) => client.navigate(client.url).catch(() => null)));
      acknowledged.clear();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CID_SW_ACK' && event.source?.id) acknowledged.add(event.source.id);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch API, authentication or third-party requests.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/.netlify/')) {
    return;
  }
  // The worker script itself is always fetched by the browser directly, and
  // the administrator revision stamp must never be answered from a cache.
  if (url.pathname === '/service-worker.js' || url.pathname === '/content-revision') return;

  const isApplicationCode = request.mode === 'navigate'
    || url.pathname === '/'
    || /\.(html?|js|mjs|css|json)$/i.test(url.pathname);

  if (isApplicationCode || NETWORK_FIRST_IMAGES.includes(url.pathname)) {
    event.respondWith(networkFirst(event));
    return;
  }

  // Fonts, icons, images and sounds: versioned or rarely changing assets.
  event.respondWith(cacheFirst(event));
});
