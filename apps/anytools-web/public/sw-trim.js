/**
 * Cache lifecycle: which caches `activate` is allowed to delete, and how each cache's entry
 * count is kept bounded across a lifetime that spans many deploys.
 *
 * Same shape as sw-lib.js: every function takes its collaborators as arguments so
 * `src/lib/service-worker-trim.test.ts` can run this exact code against an in-memory fake
 * CacheStorage (see `src/lib/test-support/fake-cache-storage.ts`) instead of asserting on
 * sw.js's source text.
 */
((root) => {
  /**
   * Which of `allCacheNames` `activate` should delete: only caches THIS app created (the
   * `at-` prefix) that are not in the current version list. Everything else survives —
   * including `anytools-models` (owned by `packages/anytools-tools/src/shared/onnx-loader.ts`,
   * no `at-` prefix) and any cache a future third party might add. An earlier version of this
   * deleted every cache not in `CURRENT_CACHES`, full stop — which wiped `anytools-models` (a
   * 14 MB ORT runtime + 4.4 MB model bucket) on every single SW update, silently, for every
   * visitor who had already downloaded it (review finding #1, Critical).
   *
   * @returns {string[]} cache names to delete.
   */
  function pickCachesToDelete(allCacheNames, currentCacheNames) {
    const keep = new Set(currentCacheNames);
    return allCacheNames.filter((name) => name.startsWith('at-') && !keep.has(name));
  }

  /** The Next.js build id segment of a `/_next/static/<buildId>/...` pathname, else null. */
  function extractBuildId(pathname) {
    const match = /\/_next\/static\/([^/]+)\//.exec(pathname);
    return match ? match[1] : null;
  }

  function pathnameOf(requestUrl) {
    try {
      return new URL(requestUrl).pathname;
    } catch {
      return requestUrl;
    }
  }

  /**
   * Which of `urls` (full cached request URLs) belong to a Next.js build other than
   * `currentBuildId`. Entries whose pathname carries no detectable build id (not a
   * `/_next/static/` URL, or a shape this regex does not recognise) are never treated as
   * stale here — this function only ever *adds* candidates for deletion, it does not decide
   * what "not stale" means for entries it cannot classify.
   */
  function pickStaleBuildEntries(urls, currentBuildId) {
    if (!currentBuildId) return [];
    return urls.filter((url) => {
      const buildId = extractBuildId(pathnameOf(url));
      return buildId !== null && buildId !== currentBuildId;
    });
  }

  /**
   * FIFO victims once `urls.length` exceeds `limit` — `urls` must already be in insertion
   * order (which is what `cache.keys()` returns), so slicing from the front deletes the
   * oldest-inserted entries first.
   */
  function trimToLimit(urls, limit) {
    if (urls.length <= limit) return [];
    return urls.slice(0, urls.length - limit);
  }

  /**
   * Full trim plan for one cache: purge entries from a stale build first (review findings
   * #4/#5 — plain FIFO alone can delete a same-build, still-referenced chunk before an
   * old build's leftover, because FIFO only tracks insertion order, not which build a chunk
   * belongs to), then FIFO the remainder down to `limit`.
   */
  function planCacheTrim(urls, limit, currentBuildId) {
    const stale = pickStaleBuildEntries(urls, currentBuildId || null);
    const staleSet = new Set(stale);
    const remaining = urls.filter((url) => !staleSet.has(url));
    return stale.concat(trimToLimit(remaining, limit));
  }

  async function deleteUrls(cache, urlsToDelete) {
    const urlSet = new Set(urlsToDelete);
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((key) => urlSet.has(key.url)).map((key) => cache.delete(key).catch(() => false)),
    );
  }

  /** Runs `planCacheTrim` against a real/fake cache and deletes the resulting victims. */
  async function trimCache(caches, cacheName, limit, currentBuildId) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    const urls = keys.map((key) => key.url);
    const victims = planCacheTrim(urls, limit, currentBuildId || null);
    await deleteUrls(cache, victims);
    return victims;
  }

  /**
   * Counts writes per cache name and reports when a cache has crossed `threshold` writes since
   * the last time it did — how `fetch` handlers know to re-check a cache's trim limit
   * periodically instead of only once per deploy at `activate` (review finding #4).
   */
  function createPutCounter(threshold) {
    const counts = Object.create(null);
    return {
      increment(cacheName) {
        const next = (counts[cacheName] || 0) + 1;
        if (next >= threshold) {
          counts[cacheName] = 0;
          return true;
        }
        counts[cacheName] = next;
        return false;
      },
    };
  }

  /** Reads the last build id this SW instance persisted, or null if there is none yet. */
  async function readStoredBuildId(caches, metaCacheName, key) {
    const cache = await caches.open(metaCacheName);
    const cached = await cache.match(key);
    if (!cached) return null;
    return (await cached.text()) || null;
  }

  /** Persists the current build id so the next `activate` (a fresh SW instance) can read it. */
  async function writeStoredBuildId(caches, metaCacheName, key, buildId) {
    const cache = await caches.open(metaCacheName);
    await cache.put(key, new Response(buildId));
  }

  root.SW_TRIM = {
    pickCachesToDelete,
    extractBuildId,
    pickStaleBuildEntries,
    trimToLimit,
    planCacheTrim,
    trimCache,
    createPutCounter,
    readStoredBuildId,
    writeStoredBuildId,
  };
})(typeof self !== 'undefined' ? self : globalThis);
