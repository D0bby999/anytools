/**
 * Shared knowledge between the service worker and its tests — the single source of truth for
 * "must this request always go straight to the network" (`shouldBypassCache`) AND for the cache
 * names / limits / precache list `sw.js` wires up. Splitting this out (rather than inlining it
 * in sw.js) is what lets a test *execute* the real decision instead of grepping a copy of it.
 *
 * Loaded by public/sw.js via `importScripts('/sw-policy.js')` and by every `src/lib/*.test.ts`
 * file below via `import('../../public/sw-policy.js')` (a side-effecting classic script, not an
 * ES module — no build step, no dependency). Both callers read the same `root.SW_POLICY` object.
 */
((root) => {
  // The origin this script's own scope was loaded from. Inside a real service worker,
  // `self.location` is the SW's own URL (e.g. https://anytools.world/sw.js), so comparing
  // against it is how a request to a third-party host (a CDN, an ad network) is detected
  // as cross-origin. In the vitest environment (Node, no browser globals) there is no
  // ambient `location` — the test sets `globalThis.location` before importing this module
  // so the same comparison exercises the same code path.
  function currentOrigin() {
    return root.location ? root.location.origin : undefined;
  }

  // Hand-written, not generated from @anytools/i18n at runtime (a classic script has no
  // module resolution to reach into a workspace package) — but `service-worker-policy.test.ts`
  // imports the real `locales` export and asserts this array is byte-for-byte the same list, so
  // adding a 5th locale without updating this array fails CI instead of silently under-matching
  // `PRIVATE_PATH` (review finding #6: an earlier draft's regex never matched a locale-prefixed
  // path at all, and nothing caught that until someone read the diff by hand).
  const LOCALES = ['en', 'vi', 'es', 'pt'];

  // Locale-prefixed private/authenticated routes. `middleware.ts` rewrites the bare path
  // (`/dashboard`) to the locale-prefixed one (`/en/dashboard`) before a locale cookie is
  // set, so both forms must match or a page reached during that rewrite window would slip
  // into a cache shared across every visitor of a self-host install.
  //
  // `/favorites` has no server-rendered session data (force-static, state lives in
  // localStorage — see favorites/page.tsx) so bypassing it here is defensive, not required:
  // keeping it out of `at-pages-v1` costs that one page its offline availability in exchange
  // for one less private-route regex to keep in sync by hand if that page ever grows a
  // server-rendered per-user branch. Deliberate, not a bug (review finding #21).
  const LOCALE_GROUP = LOCALES.join('|');
  const PRIVATE_PATH = new RegExp(
    `^/(?:${LOCALE_GROUP})?/?(?:dashboard|admin|sign-in|sign-up|favorites)(?:/|$)`,
  );

  // `/third-party/onnx/` and `/third-party/u2netp/` are excluded from this SW's own
  // cache-first handling on purpose: `onnx-loader.ts` already caches those two paths itself,
  // under `anytools-models`, keyed by a version/sha in the URL (`?v=<hash>`) and verified
  // against a pinned sha256 on every fresh download. Letting the SW cache-first the *bare*
  // URL too (review findings #2/#3) meant a vendor bump could leave the SW serving old bytes
  // under a URL onnx-loader's own versioning never sees, producing a permanent checksum
  // mismatch with no self-healing path, and it doubled on-disk storage for identical bytes
  // (SW's `at-vendor-v1` + onnx-loader's `anytools-models`) against a ~50 MB iOS quota. Both
  // paths must always go straight to the network/onnx-loader's own cache, never through
  // `at-vendor-v1`.
  const OWNER_CACHED_PREFIXES = ['/third-party/onnx/', '/third-party/u2netp/'];

  // Bump this — and update VENDOR_MANIFEST_SHA256 below to match — every time
  // `apps/anytools-web/vendor-assets.json` changes (a new asset, a re-pinned version, a
  // changed upstream URL). `at-vendor-v${VENDOR_CACHE_VERSION}` is the cache name sw.js opens
  // for everything under `/third-party/` except the two owner-cached prefixes above; bumping
  // the version starts a fresh cache bucket so a returning visitor's browser never serves
  // stale vendor bytes under a URL that now points at different content. There is nothing that
  // enforces this bump other than `vendor-cache-version.test.ts`, which hashes the live
  // manifest file and fails the moment it drifts from the hash recorded below — that failure
  // IS the reminder.
  const VENDOR_CACHE_VERSION = 1;
  const VENDOR_MANIFEST_SHA256 = '14e2293363c0359fa8ab00cac5335eb6f7b01c9455cb992e71fa7fa5b38432bc';

  const CACHE_NAMES = {
    STATIC: 'at-static-v1',
    VENDOR: `at-vendor-v${VENDOR_CACHE_VERSION}`,
    PAGES: 'at-pages-v1',
    ASSETS: 'at-assets-v1',
    // Not a content cache — one synthetic entry recording the most recently observed Next.js
    // build id, so a throttled trim mid-lifetime (not just at `activate`) can tell a current
    // `/_next/static/<buildId>/` chunk from a previous build's leftover (review findings #4/#5).
    META: 'at-meta-v1',
  };

  const CURRENT_CACHES = [
    CACHE_NAMES.STATIC,
    CACHE_NAMES.VENDOR,
    CACHE_NAMES.PAGES,
    CACHE_NAMES.ASSETS,
    CACHE_NAMES.META,
  ];

  // Per-cache entry caps, enforced by sw-trim.js — both at `activate` and, throttled, from
  // `fetch` (review finding #4: only `at-static-v1` had a cap before, and only at `activate`,
  // so the other three caches (and `at-static-v1` itself, mid-deploy-cycle) grew without bound
  // between deploys). These are heuristic, not exact quota math: `at-vendor-v1` holds a
  // handful of large files (a few per third-party key) so 60 is generous headroom without
  // inviting unbounded growth; `at-pages-v1` holds full HTML documents so it is capped lower
  // than `at-assets-v1`, which mostly holds small variants (`/_next/image` resizes, RSC
  // payloads) that are individually cheap but numerous.
  const TRIM_LIMITS = {
    [CACHE_NAMES.STATIC]: 300,
    [CACHE_NAMES.VENDOR]: 60,
    [CACHE_NAMES.PAGES]: 100,
    [CACHE_NAMES.ASSETS]: 200,
  };

  // Re-check the trim cap for a cache every this-many successful writes to it, from `fetch`
  // handlers — not just once per deploy at `activate` (review finding #4).
  const PUT_TRIM_CHECK_INTERVAL = 50;

  // Precached at install — exactly 5 URLs, deliberately. The 4 locale offline fallbacks are
  // what a failed navigation falls back to; `/manifest.json` is what makes the "Install app"
  // prompt possible on a first visit that never navigated again. Nothing under `/third-party/`
  // may ever appear here — it is 54 MB of WASM/model/font assets, cached on demand only, the
  // moment a tool actually fetches one. `vendor-cache-version.test.ts` and
  // `service-worker-lib.test.ts` both assert this list directly (length, contents, no
  // `/third-party/` entry) instead of grepping sw.js's source for an `addAll(...)` call that no
  // longer exists (review finding #15: precache now goes through `fetch` + `safePut` per URL,
  // not `cache.addAll`, so one bad URL can no longer fail every other precache entry too).
  const PRECACHE_ENTRIES = [
    { cacheName: CACHE_NAMES.PAGES, url: '/en/offline' },
    { cacheName: CACHE_NAMES.PAGES, url: '/vi/offline' },
    { cacheName: CACHE_NAMES.PAGES, url: '/es/offline' },
    { cacheName: CACHE_NAMES.PAGES, url: '/pt/offline' },
    { cacheName: CACHE_NAMES.ASSETS, url: '/manifest.json' },
  ];

  /** Defensive `decodeURIComponent` — a malformed `%` sequence must not throw past this point. */
  function decodePathnameSafely(pathname) {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  }

  /**
   * @param {URL} url - parsed request URL.
   * @param {{ method?: string, headers?: { get(name: string): string | null } }} [request] -
   *   optional Request-like object. Cache Storage can only key GET requests, so any other
   *   method bypasses the cache regardless of path; a `Range` header means the caller wants a
   *   206 partial response (media/wasm streaming), which `cache.match` cannot produce (review
   *   finding #17).
   * @returns {boolean} true when this request must never be read from or written to cache.
   */
  function shouldBypassCache(url, request) {
    if (request && typeof request.method === 'string' && request.method !== 'GET') return true;
    if (request?.headers && typeof request.headers.get === 'function') {
      if (request.headers.get('range')) return true;
    }

    const origin = currentOrigin();
    if (origin !== undefined && url.origin !== origin) return true;

    // Lower-cased and percent-decoded before matching: today an upper-cased or `%2F`-encoded
    // variant of a private path 404s or redirects (so `!res.ok` already keeps it uncached),
    // but that is luck, not the rule matching by design (review finding #8).
    const pathname = decodePathnameSafely(url.pathname).toLowerCase();

    if (pathname.indexOf('/api/') === 0 || pathname === '/api') return true;

    if (OWNER_CACHED_PREFIXES.some((prefix) => pathname.indexOf(prefix) === 0)) return true;

    if (PRIVATE_PATH.test(pathname)) return true;

    return false;
  }

  root.SW_POLICY = {
    shouldBypassCache,
    LOCALES,
    PRIVATE_PATH,
    OWNER_CACHED_PREFIXES,
    VENDOR_CACHE_VERSION,
    VENDOR_MANIFEST_SHA256,
    CACHE_NAMES,
    CURRENT_CACHES,
    TRIM_LIMITS,
    PUT_TRIM_CHECK_INTERVAL,
    PRECACHE_ENTRIES,
  };
})(typeof self !== 'undefined' ? self : globalThis);
