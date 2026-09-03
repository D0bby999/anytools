/**
 * Minimal in-memory CacheStorage/Cache shim for testing service worker logic (public/sw-lib.js,
 * public/sw-trim.js) without a browser. Deliberately small — it implements only the handful of
 * methods those modules actually call: `caches.open/keys/delete` and
 * `cache.match/put/keys/delete`. `cache.keys()` returns entries in insertion order, same as the
 * real Cache Storage API, which the trim logic under test depends on (review finding #1).
 */
type FakeCacheEntry = { url: string; response: unknown };

export class FakeCache {
  private entries: FakeCacheEntry[] = [];

  async match(
    request: string | { url: string },
    opts?: { ignoreSearch?: boolean },
  ): Promise<unknown> {
    const key = normalize(urlOf(request), opts?.ignoreSearch);
    const found = this.entries.find((e) => normalize(e.url, opts?.ignoreSearch) === key);
    return found?.response;
  }

  async put(request: string | { url: string }, response: unknown): Promise<void> {
    const url = urlOf(request);
    // Real Cache Storage replaces an existing entry for the same URL rather than duplicating
    // it. It does not need to preserve that entry's original insertion slot for this shim to
    // be useful — nothing under test re-`put`s an already-cached URL.
    const existingIndex = this.entries.findIndex((e) => e.url === url);
    if (existingIndex !== -1) this.entries.splice(existingIndex, 1);
    this.entries.push({ url, response });
  }

  async delete(request: string | { url: string }): Promise<boolean> {
    const url = urlOf(request);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.url !== url);
    return this.entries.length !== before;
  }

  async keys(): Promise<Array<{ url: string }>> {
    return this.entries.map((e) => ({ url: e.url }));
  }
}

export class FakeCacheStorage {
  private caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  /** Test-only: peek at a cache without triggering `open()`'s auto-create-on-miss. */
  peek(name: string): FakeCache | undefined {
    return this.caches.get(name);
  }
}

function urlOf(request: string | { url: string }): string {
  return typeof request === 'string' ? request : request.url;
}

function normalize(url: string, ignoreSearch: boolean | undefined): string {
  if (!ignoreSearch) return url;
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}
