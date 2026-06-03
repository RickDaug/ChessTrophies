/* ChessTrophies Service Worker — offline-first PWA shell. */
const CACHE = 'chesstrophies-v17';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './academy.js',
  './sounds.js',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js'
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isHtml = req.headers.get('accept')?.includes('text/html');
  const isAppCode = url.origin === self.location.origin && /\.(?:js|css)$/.test(url.pathname);

  // Strategy: NETWORK-FIRST for HTML/navigations and app code (so fresh code is
  // preferred while online), falling back to cache when offline.
  //
  // Cache lookups use { ignoreSearch: true } so a versioned request such as
  // `app.js?v=20260601a` resolves to the precached base entry `./app.js`. The
  // index.html `?v=` query strings exist only as cache-busting hints for the
  // network; freshness is guaranteed by network-first, and offline matching
  // ignores the query so precached base files still resolve.
  //
  // We deliberately re-fetch/put under the *base* (search-stripped) URL so the
  // runtime cache never accumulates per-version duplicates and stays aligned
  // with the precache list.
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
          // Asset (js/css) offline: resolve the versioned request to the
          // precached base file via ignoreSearch. NEVER fall back to
          // index.html here — returning HTML for a .js request white-screens
          // the app. If nothing is cached, return a proper error response.
          return caches.match(req, { ignoreSearch: true })
            .then((m) => m || new Response('', { status: 504, statusText: 'Offline and not cached' }));
        })
    );
  } else {
    // Cache-first for cross-origin/static assets (fonts, CDN libs).
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        return (
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }).catch(() => cached)
        );
      })
    );
  }
});
