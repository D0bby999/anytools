/**
 * AnyTools service worker.
 *
 * Hand-written, zero dependency, zero build step — see the plan's rationale for not using
 * @serwist/next: this app's core promise is tools that run and keep running with no upload,
 * and the one thing a precache manifest tool is built for (precaching everything) is exactly
 * what /third-party/ (54 MB of WASM/models/fonts) must never do.
 *
 * This file is deliberately thin wiring: routing table + event listeners. The decision logic
 * lives in sw-policy.js (what to bypass, cache names/limits/precache list), sw-lib.js (fetch
 * strategies, safePut), and sw-trim.js (cache GC) — all three loaded below via importScripts so
 * the exact same functions run here AND, unmodified, inside the vitest suites under
 * src/lib/*.test.ts (no string-grepping a copy of this file's logic).
 *
 * Registered at root scope (/sw.js) by service-worker-register.tsx, production builds only.
 * Rollback: copy sw-tombstone.js over this file and deploy — see that file's header.
 */
importScripts('/sw-policy.js', '/sw-lib.js', '/sw-trim.js');

const {
  CACHE_NAMES,
  CURRENT_CACHES,
  TRIM_LIMITS,
  PUT_TRIM_CHECK_INTERVAL,
  PRECACHE_ENTRIES,
  LOCALES,
  shouldBypassCache,
} = self.SW_POLICY;
const { cacheFirst, staleWhileRevalidate, networkFirstNavigate, runInstall } = self.SW_LIB;
const {
  pickCachesToDelete,
  extractBuildId,
  trimCache,
  createPutCounter,
  readStoredBuildId,
  writeStoredBuildId,
} = self.SW_TRIM;

// Synthetic Cache Storage key (never a real request URL) for the one entry `at-meta-v1` holds:
// the most recently observed Next.js build id, read at `activate` and refreshed on every
// `/_next/static/` fetch — see the `fetch` handler below and sw-trim.js's stale-build purge.
const BUILD_ID_KEY = '/__meta__/build-id';

// In-memory mirror of the persisted build id, populated from `at-meta-v1` at `activate` and
// kept current for the rest of this SW instance's life without an extra cache read per fetch.
let currentBuildId = null;

// Throttles trim re-checks to once every N successful writes per cache, from `fetch` — not
// just once per deploy at `activate` (review finding #4).
const putCounter = createPutCounter(PUT_TRIM_CHECK_INTERVAL);

function trimForCache(cacheName) {
  const limit = TRIM_LIMITS[cacheName];
  if (!limit) return Promise.resolve();
  const buildId = cacheName === CACHE_NAMES.STATIC ? currentBuildId : null;
  return trimCache(caches, cacheName, limit, buildId);
}

self.addEventListener('install', (event) => {
  // Take over from any previously-waiting SW immediately — static assets aren't
  // build-tagged in their own right (that would need a post-`next build` injection step;
  // see the stale-build purge in sw-trim.js for how staleness is detected instead), so there
  // is no correctness reason to wait here; see the `activate` handler below for the one place
  // this file does choose to leave already-open tabs on their existing controller.
  self.skipWaiting();
  event.waitUntil(
    runInstall(caches, fetch, PRECACHE_ENTRIES, (message, err) => console.error(message, err)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const toDelete = pickCachesToDelete(names, CURRENT_CACHES);
      await Promise.all(toDelete.map((name) => caches.delete(name)));

      currentBuildId = await readStoredBuildId(caches, CACHE_NAMES.META, BUILD_ID_KEY);
      if (currentBuildId) {
        await trimCache(
          caches,
          CACHE_NAMES.STATIC,
          TRIM_LIMITS[CACHE_NAMES.STATIC],
          currentBuildId,
        );
      }
    })(),
  );
  // Deliberately no call here to the ServiceWorkerGlobalScope Clients API's `claim()` method.
  // `skipWaiting()` above only shortens the WAITING phase — on its own it does not hand control
  // of already-open tabs to the new worker; that is standard, documented service worker
  // behaviour (https://web.dev/articles/service-worker-lifecycle#the_lifecycle), not this
  // file's own invention. Without `clients.claim()`, a tab that was already open when this
  // activation ran — whether it was controlled by an older SW, or (a visitor's very first-ever
  // page load on this site) by no SW at all — keeps that same controller until its NEXT
  // navigation; only navigations that start AFTER this activation are controlled by the newly
  // active worker. Static assets carry no build id of their own, so an open tab left on old
  // HTML must not be handed a newer chunk by a new SW mid-session (a guaranteed mismatch:
  // "HTML from build N, chunk from build N+1"). Trade-offs this buys: a deployed SW update
  // takes one extra navigation to fully roll out, and a visitor's very first page load on this
  // site is never SW-controlled regardless of skipWaiting/claim — a service worker cannot
  // intercept the network request that fetches the page which goes on to register it.
  // This handler never references `self.clients` at all (verified by reading this function,
  // not by a source-text grep for the string "clients.claim"); the cache-deletion decision it
  // does make is exercised as real behaviour in `service-worker-trim.test.ts`'s
  // `pickCachesToDelete` tests, run against a fake CacheStorage.
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypassCache(url, request)) {
    return; // no respondWith() — browser handles this request exactly as if no SW ran.
  }

  function onWrite(cacheName) {
    return () => {
      if (putCounter.increment(cacheName)) event.waitUntil(trimForCache(cacheName));
    };
  }

  if (url.pathname.indexOf('/_next/static/') === 0) {
    // Filename includes a content hash → immutable, safe to serve from cache forever.
    const buildId = extractBuildId(url.pathname);
    if (buildId && buildId !== currentBuildId) {
      currentBuildId = buildId;
      event.waitUntil(writeStoredBuildId(caches, CACHE_NAMES.META, BUILD_ID_KEY, buildId));
    }
    event.respondWith(
      cacheFirst(caches, fetch, CACHE_NAMES.STATIC, request, onWrite(CACHE_NAMES.STATIC)),
    );
    return;
  }

  if (url.pathname.indexOf('/third-party/') === 0) {
    // On-demand only: nothing under /third-party/ is precached (see PRECACHE_ENTRIES in
    // sw-policy.js), so this cache only ever gains an entry the moment a tool actually fetches
    // that asset. /third-party/onnx/ and /third-party/u2netp/ never reach here at all —
    // shouldBypassCache() above already sent them straight to the network/onnx-loader's own
    // cache (see sw-policy.js's OWNER_CACHED_PREFIXES comment).
    event.respondWith(
      cacheFirst(caches, fetch, CACHE_NAMES.VENDOR, request, onWrite(CACHE_NAMES.VENDOR)),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirstNavigate(
        caches,
        fetch,
        CACHE_NAMES.PAGES,
        request,
        url,
        LOCALES,
        onWrite(CACHE_NAMES.PAGES),
      ),
    );
    return;
  }

  // Everything else: icons, manifest.json, fonts, `/_next/image` variants, RSC payloads. Fine
  // to serve slightly stale while a fresh copy loads in the background.
  event.respondWith(
    staleWhileRevalidate(
      caches,
      fetch,
      CACHE_NAMES.ASSETS,
      request,
      event.waitUntil.bind(event),
      onWrite(CACHE_NAMES.ASSETS),
    ),
  );
});
