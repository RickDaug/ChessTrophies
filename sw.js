/* ChessTrophies Service Worker — offline-first PWA shell. */
const CACHE = 'chesstrophies-v22';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './academy.js',
  './sounds.js',
  './checkers.js',
  './checkers-ai.js',
  './ct-checkers.js',
  './ct-onerror.js',
  './ct-boot.js',
  './ct-chess-check.js',
  './ct-socket-fallback.js',
  './ct-sw-register.js',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Let the page activate a waiting SW on demand (the update prompt posts this).
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Only these third-party hosts/extensions are safe to cache. Everything dynamic
// (the backend API, sockets) must always hit the network.
function isStaticThirdParty(url) {
  return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url.href) ||
         /^https:\/\/cdnjs\.cloudflare\.com\//.test(url.href);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // CRITICAL: never cache or intercept backend API / realtime traffic, on EITHER
  // origin (the web app talks cross-origin to Railway; a same-origin deploy uses
  // /api/ directly). Caching dynamic API GETs (e.g. /api/friends, /api/me,
  // /api/progress, /api/users/search) silently serves users stale data — that is
  // exactly what made a freshly-added friend never appear. Let the browser fetch
  // these normally with no SW involvement.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  const isHtml = req.headers.get('accept')?.includes('text/html');
  const isAppCode = url.origin === self.location.origin && /\.(?:js|css)$/.test(url.pathname);
  const isSameOriginAsset = url.origin === self.location.origin &&
    /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname);

  // NETWORK-FIRST for HTML/navigations and app code (so fresh code is preferred
  // while online), falling back to cache when offline. Cache lookups use
  // { ignoreSearch: true } so a versioned request such as `app.js?v=20260601a`
  // resolves to the precached base entry `./app.js`, and we store under the
  // search-stripped URL so the runtime cache never accumulates per-version dupes.
  if (isHtml || isAppCode) {
    const baseUrl = url.origin + url.pathname; // versionless key
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(baseUrl, copy));
          return res;
        })
        .catch(() => {
          if (isHtml) {
            // Navigation offline fallback: serve the cached app shell.
            return caches.match(req, { ignoreSearch: true })
              .then((m) => m || caches.match('./index.html'));
          }
          // Asset (js/css) offline: resolve the versioned request to the precached
          // base file via ignoreSearch. NEVER fall back to index.html here —
          // returning HTML for a .js request white-screens the app.
          return caches.match(req, { ignoreSearch: true })
            .then((m) => m || new Response('', { status: 504, statusText: 'Offline and not cached' }));
        })
    );
    return;
  }

  // CACHE-FIRST only for genuinely static assets: same-origin images/fonts and the
  // known static third-party hosts (Google Fonts, cdnjs). Anything else (e.g. an
  // unknown cross-origin request) passes straight through to the network uncached.
  if (isSameOriginAsset || isStaticThirdParty(url)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) =>
        cached ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }).catch(() => cached)
      )
    );
  }
  // else: not cacheable -> no respondWith -> default browser network fetch.
});
