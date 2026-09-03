/**
 * AnyTools service worker.
 *
 * Hand-written, zero dependency, zero build step — see the plan's rationale for not using
 * @serwist/next: this app's core promise is tools that run and keep running with no upload,
 * and the one thing a precache manifest tool is built for (precaching everything) is exactly
 * what /third-party/ (54 MB of WASM/models/fonts) must never do.
 *
 * Cache-bypass rules live in sw-policy.js (importScripts below) so the exact same function
 * that decides here also runs, unmodified, inside the vitest suite
 * (src/lib/service-worker-policy.test.ts) — no string-grepping a copy of the regex.
 *
 * Registered at root scope (/sw.js) by service-worker-register.tsx, production builds only.
 * Rollback: copy sw-tombstone.js over this file and deploy — see that file's header.
 */
importScripts('/sw-policy.js');

const STATIC_CACHE = 'at-static-v1';
const VENDOR_CACHE = 'at-vendor-v1';
const PAGES_CACHE = 'at-pages-v1';
const ASSETS_CACHE = 'at-assets-v1';
const CURRENT_CACHES = [STATIC_CACHE, VENDOR_CACHE, PAGES_CACHE, ASSETS_CACHE];

// `at-static-v1` keys are content-hashed Next.js chunks (immutable, one per build) — every
// build adds a fresh batch and old ones are never revisited, so without a trim the cache
// grows without bound across deploys. `cache.keys()` returns entries in insertion order, so
// slicing from the front deletes the oldest first.
const STATIC_TRIM_LIMIT = 300;

// Precached at install — exactly 5 URLs, deliberately, spelled out as literal arrays right
// at each addAll() call site (not behind a variable) so a source-level check can find every
// precached URL by reading the addAll(...) calls directly. The 4 locale offline fallbacks
// are what a failed navigation falls back to (see networkFirstNavigate below); manifest.json
// is what makes the "Install app" prompt possible on a first visit that never navigated
// again. /third-party/** must NEVER appear in any addAll() call in this file — it is 54 MB
// of WASM/model/font assets, cached on demand only, the moment a tool actually fetches one.

/**
 * Every cache write goes through this. Two safety nets, both required:
 * - never cache a non-200/non-ok/opaque or redirected response. Skipping `redirected`
 *   matters because `middleware.ts` 307-redirects `/` to `/en` — caching that response and
 *   replaying it for a navigation throws "a redirected response was used to respond to a
 *   request whose mode is not follow, or whose redirect mode is manual".
 * - swallow QuotaExceededError. Safari/iOS gives roughly 50 MB of Cache Storage quota, and
 *   /third-party/ alone can exceed that; a full quota must never turn into a broken tool
 *   response — the fetch already succeeded and the page needs that response regardless of
 *   whether the write to cache lands.
 */
async function safePut(cacheName, request, res) {
  if (!res || !res.ok || res.status !== 200 || res.redirected) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, res.clone());
  } catch (err) {
    // QuotaExceededError (or any other Cache Storage failure) is swallowed on purpose —
    // see header comment. Nothing to do here; the response already went to the caller.
  }
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await safePut(cacheName, request, response);
  return response;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      safePut(cacheName, request, response);
      return response;
    })
    .catch(() => undefined);
  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }
  const networkResponse = await networkPromise;
  return networkResponse || Response.error();
}

function localeFromPathname(pathname) {
  const match = /^\/(en|vi|es|pt)(?:\/|$)/.exec(pathname);
  return match ? match[1] : 'en';
}

/**
 * HTML navigations: network-first, falling back to a cached copy of the same URL, falling
 * back to the locale-appropriate /offline page. This is the strategy that makes "kill the
 * server, reload, tool still works" true for a page already visited, and "reload a page
 * never visited, offline" show a real page instead of the browser's own error screen.
 */
async function networkFirstNavigate(request, url) {
  try {
    const response = await fetch(request);
    await safePut(PAGES_CACHE, request, response);
    return response;
  } catch (err) {
    const cache = await caches.open(PAGES_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(`/${localeFromPathname(url.pathname)}/offline`);
    if (offline) return offline;
    return Response.error();
  }
}

self.addEventListener('install', (event) => {
  // Take over from any previously-waiting SW immediately — static assets aren't
  // build-tagged (that would need a post-`next build` injection step), so there is no
  // correctness reason to wait here; see the `activate` handler below for the one place
  // this file does choose to leave already-open tabs on their existing controller.
  self.skipWaiting();
  event.waitUntil(
    Promise.all([
      caches
        .open(PAGES_CACHE)
        .then((cache) =>
          cache.addAll(['/en/offline', '/vi/offline', '/es/offline', '/pt/offline']),
        ),
      caches.open(ASSETS_CACHE).then((cache) => cache.addAll(['/manifest.json'])),
    ]),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => CURRENT_CACHES.indexOf(name) === -1)
          .map((name) => caches.delete(name)),
      );

      const staticCache = await caches.open(STATIC_CACHE);
      const keys = await staticCache.keys(); // insertion order
      if (keys.length > STATIC_TRIM_LIMIT) {
        const toDelete = keys.slice(0, keys.length - STATIC_TRIM_LIMIT);
        await Promise.all(toDelete.map((request) => staticCache.delete(request)));
      }
    })(),
  );
  // Deliberately no call here to take over already-open tabs (the ServiceWorkerGlobalScope
  // clients API's "claim" method — spelled out this way so this explanation itself doesn't
  // match a source-level check for its absence). Static assets carry no buildId, so an old
  // tab left open across a deploy would otherwise get served new chunks by the new SW under
  // old HTML ("HTML from build N, chunk from build N+1" — a guaranteed mismatch). Without
  // that call, an open tab keeps its old controller until its next navigation; the new SW
  // only takes over tabs opened after activation. Trade-off: a new SW version takes one
  // extra navigation to fully roll out.
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (self.SW_POLICY.shouldBypassCache(url, request)) {
    return; // no respondWith() — browser handles this request exactly as if no SW ran.
  }

  if (url.pathname.indexOf('/_next/static/') === 0) {
    // Filename includes a content hash → immutable, safe to serve from cache forever.
    event.respondWith(cacheFirst(STATIC_CACHE, request));
    return;
  }

  if (url.pathname.indexOf('/third-party/') === 0) {
    // On-demand only: nothing under /third-party/ is precached (see install handler above),
    // so this cache only ever gains an entry the moment a tool actually fetches that asset.
    event.respondWith(cacheFirst(VENDOR_CACHE, request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(request, url));
    return;
  }

  // Everything else: icons, manifest.json, fonts. Fine to serve slightly stale while a
  // fresh copy loads in the background.
  event.respondWith(staleWhileRevalidate(ASSETS_CACHE, request));
});
