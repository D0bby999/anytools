/**
 * Cache-bypass policy for the service worker — the single source of truth for "must this
 * request always go straight to the network, never touch Cache Storage".
 *
 * Loaded by public/sw.js via `importScripts('/sw-policy.js')` and by
 * src/lib/service-worker-policy.test.ts via `import('../../public/sw-policy.js')` (a
 * side-effecting classic script, not an ES module — no build step, no dependency). Both
 * callers read the same `shouldBypassCache` function; the test executes it against real
 * sample URLs instead of grepping strings in sw.js, which is how an earlier draft of this
 * rule shipped a regex that never matched a locale-prefixed path
 * (`startsWith('/dashboard')` never matches `/en/dashboard`, and next-intl's
 * `localePrefix: 'always'` means every real page has that prefix).
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

  // Locale-prefixed private/authenticated routes. `middleware.ts` rewrites the bare path
  // (`/dashboard`) to the locale-prefixed one (`/en/dashboard`) before a locale cookie is
  // set, so both forms must match or a page reached during that rewrite window would slip
  // into a cache shared across every visitor of a self-host install.
  const PRIVATE_PATH =
    /^\/(?:en|vi|es|pt)?\/?(?:dashboard|admin|sign-in|sign-up|favorites)(?:\/|$)/;

  /**
   * @param {URL} url - parsed request URL.
   * @param {{ method?: string }} [request] - optional Request-like object. Cache Storage
   *   can only key GET requests, so any other method bypasses the cache regardless of path.
   * @returns {boolean} true when this request must never be read from or written to cache.
   */
  function shouldBypassCache(url, request) {
    if (request && typeof request.method === 'string' && request.method !== 'GET') return true;

    const origin = currentOrigin();
    if (origin !== undefined && url.origin !== origin) return true;

    if (url.pathname.indexOf('/api/') === 0) return true;

    if (PRIVATE_PATH.test(url.pathname)) return true;

    return false;
  }

  root.SW_POLICY = { shouldBypassCache: shouldBypassCache };
})(typeof self !== 'undefined' ? self : globalThis);
