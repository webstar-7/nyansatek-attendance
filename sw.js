const CACHE_NAME = 'nyansatek-school-v1';
const APP_SHELL = [
  './',              // the actual page (index.html), whatever it's served as
  './manifest.json',
  './apple-touch-icon.png',
  './favicon-32x32.png',
  './favicon.svg'
];

// Install: pre-cache the app shell. Each resource is fetched and cached
// individually (not one cache.addAll call) so that if any single item is
// missing or renamed, it doesn't take down the whole install -- this is
// exactly the bug that silently broke the POS app's first service worker,
// so this one is written defensively from the start.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        APP_SHELL.map(url =>
          fetch(url)
            .then(res => {
              if (res && res.ok) return cache.put(url, res);
              console.warn('[sw] Skipping precache, bad response for', url, res && res.status);
            })
            .catch(err => console.warn('[sw] Skipping precache, fetch failed for', url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: only handle same-origin GET requests. Everything else (Supabase
// API calls, CDN scripts like jsPDF/QRCode, etc.) goes straight to the
// network so live data is never served from a stale cache.
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET' || url.origin !== self.location.origin) {
    return; // let the browser handle it normally
  }

  // Navigation requests (loading the page itself) are NETWORK-FIRST, so
  // every reload while online shows the latest deploy immediately rather
  // than a stale cached page. Falls back to the cached shell only when
  // the network request genuinely fails (i.e. offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./')))
    );
    return;
  }

  // Everything else (icons, manifest, CDN-cached-locally, etc.) keeps a
  // cache-first-with-background-revalidation strategy for speed.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // offline fallback

      return cached || network;
    })
  );
});
