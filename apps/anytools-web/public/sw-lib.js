/**
 * Fetch-handling strategies for the service worker — cache-first, stale-while-revalidate,
 * network-first-navigate, and the one gate every cache write goes through (`safePut`).
 *
 * Every function here takes its collaborators (`caches`, `fetch`) as arguments instead of
 * reading the ambient `self.caches` / `self.fetch` globals directly. That is what lets
 * `src/lib/service-worker-lib.test.ts` run this exact code against an in-memory fake
 * CacheStorage and a scripted fake fetch — asserting real behaviour (a redirected response is
 * never cached; a `QuotaExceededError` from `cache.put` never breaks the response already
 * handed to the page) instead of grepping sw.js's source for `res.redirected` and a
 * `try { … } catch` around `cache.put(` (review finding #14).
 *
 * Loaded by public/sw.js via `importScripts('/sw-policy.js', '/sw-lib.js', '/sw-trim.js')` and
 * by the test above via `import('../../public/sw-lib.js')` (classic script side effect,
 * assigns `globalThis.SW_LIB` — same pattern as sw-policy.js).
 */
((root) => {
  /**
   * A response Cache Storage does not itself refuse to store, but that must never be replayed
   * to a different visitor from a shared cache: `Cache-Control: no-store`/`private`, or a
   * `Set-Cookie` header (review finding #7). Cache Storage does not enforce `no-store` on its
   * own — this is the backstop for a future page that renders per-session HTML and forgets to
   * add itself to sw-policy.js's `PRIVATE_PATH` regex.
   */
  function isPrivateResponse(res) {
    const headers = res?.headers;
    if (!headers || typeof headers.get !== 'function') return false;
    const cacheControl = headers.get('cache-control') || '';
    if (/(?:^|,)\s*(?:no-store|private)\s*(?:;|,|$)/i.test(cacheControl)) return true;
    if (headers.get('set-cookie')) return true;
    return false;
  }

  /**
   * Every cache write goes through this. Two safety nets besides `isPrivateResponse` above:
   * - never cache a non-200/non-ok/opaque or redirected response. Skipping `redirected`
   *   matters because `middleware.ts` 307-redirects `/` to `/en` — caching that response and
   *   replaying it for a navigation throws "a redirected response was used to respond to a
   *   request whose mode is not follow, or whose redirect mode is manual".
   * - swallow QuotaExceededError. Safari/iOS gives roughly 50 MB of Cache Storage quota, and
   *   /third-party/ alone can exceed that; a full quota must never turn into a broken tool
   *   response — the fetch already succeeded and the page needs that response regardless of
   *   whether the write to cache lands.
   *
   * `onWrite`, when given, runs only after a real write lands — sw.js uses it to throttle
   * trim checks (review finding #4) without this module needing to know about trim limits.
   *
   * @returns {Promise<boolean>} whether the response was actually written to cache.
   */
  async function safePut(caches, cacheName, request, res, onWrite) {
    if (!res || !res.ok || res.status !== 200 || res.redirected) return false;
    if (isPrivateResponse(res)) return false;
    try {
      const cache = await caches.open(cacheName);
      await cache.put(request, res.clone());
    } catch {
      // QuotaExceededError (or any other Cache Storage failure) is swallowed on purpose — see
      // header comment. Nothing to do here; the response already went to the caller.
      return false;
    }
    if (onWrite) onWrite();
    return true;
  }

  async function cacheFirst(caches, fetchFn, cacheName, request, onWrite) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetchFn(request);
    await safePut(caches, cacheName, request, response, onWrite);
    return response;
  }

  /**
   * The background revalidation fetch+write is handed to `waitUntil` (when supplied) so the
   * service worker is not killed mid-write once the (already-returned) cached response has been
   * sent to the page (review finding #16).
   */
  async function staleWhileRevalidate(caches, fetchFn, cacheName, request, waitUntil, onWrite) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const networkPromise = fetchFn(request)
      .then((response) =>
        safePut(caches, cacheName, request, response, onWrite).then(() => response),
      )
      .catch(() => undefined);
    if (waitUntil) waitUntil(networkPromise.catch(() => undefined));
    if (cached) return cached;
    const networkResponse = await networkPromise;
    return networkResponse || Response.error();
  }

  function localeFromPathname(pathname, locales) {
    const group = locales.join('|');
    const match = new RegExp(`^/(${group})(?:/|$)`).exec(pathname);
    return match ? match[1] : locales[0];
  }

  /**
   * HTML navigations: network-first, falling back to a cached copy of the same URL — matched
   * with `ignoreSearch` so a link carrying `?utm_source=…` still hits a page cached from a bare
   * visit instead of missing and dropping straight to the offline page (review finding #11) —
   * falling back to the locale-appropriate /offline page.
   */
  async function networkFirstNavigate(
    caches,
    fetchFn,
    pagesCacheName,
    request,
    url,
    locales,
    onWrite,
  ) {
    try {
      const response = await fetchFn(request);
      await safePut(caches, pagesCacheName, request, response, onWrite);
      return response;
    } catch {
      const cache = await caches.open(pagesCacheName);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const offline = await cache.match(`/${localeFromPathname(url.pathname, locales)}/offline`);
      if (offline) return offline;
      return Response.error();
    }
  }

  /**
   * Precache, one URL at a time — `fetch` then `safePut`, not `cache.addAll` (review finding
   * #15). `addAll` is all-or-nothing: one URL failing (a redirect, a transient 5xx) fails the
   * *entire* install, leaving the site with no service worker at all and no record of why.
   * Here, one failed entry is logged and every other entry still gets cached.
   */
  async function runInstall(caches, fetchFn, precacheEntries, logError) {
    await Promise.all(
      precacheEntries.map(async ({ cacheName, url }) => {
        try {
          const response = await fetchFn(url);
          const written = await safePut(caches, cacheName, url, response);
          if (!written) logError(`[sw] precache did not cache (unexpected response): ${url}`);
        } catch (err) {
          logError(`[sw] precache failed: ${url}`, err);
        }
      }),
    );
  }

  root.SW_LIB = {
    isPrivateResponse,
    safePut,
    cacheFirst,
    staleWhileRevalidate,
    localeFromPathname,
    networkFirstNavigate,
    runInstall,
  };
})(typeof self !== 'undefined' ? self : globalThis);
