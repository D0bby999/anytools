/**
 * Runs the real cache-lifecycle logic from public/sw-trim.js — which caches `activate` may
 * delete, and how each cache's entry count stays bounded across many deploys — against an
 * in-memory fake CacheStorage instead of asserting on sw.js's source text.
 */
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FakeCacheStorage } from './test-support/fake-cache-storage';

const SW_TRIM_PATH = resolve(__dirname, '..', '..', 'public', 'sw-trim.js');

type SwTrim = {
  pickCachesToDelete: (allCacheNames: string[], currentCacheNames: string[]) => string[];
  extractBuildId: (pathname: string) => string | null;
  pickStaleBuildEntries: (urls: string[], currentBuildId: string | null) => string[];
  trimToLimit: (urls: string[], limit: number) => string[];
  planCacheTrim: (urls: string[], limit: number, currentBuildId: string | null) => string[];
  trimCache: (
    caches: FakeCacheStorage,
    cacheName: string,
    limit: number,
    currentBuildId: string | null,
  ) => Promise<string[]>;
  createPutCounter: (threshold: number) => { increment(cacheName: string): boolean };
  readStoredBuildId: (
    caches: FakeCacheStorage,
    metaCacheName: string,
    key: string,
  ) => Promise<string | null>;
  writeStoredBuildId: (
    caches: FakeCacheStorage,
    metaCacheName: string,
    key: string,
    buildId: string,
  ) => Promise<void>;
};

let SW_TRIM: SwTrim;

beforeAll(async () => {
  await import(/* @vite-ignore */ SW_TRIM_PATH);
  SW_TRIM = (globalThis as unknown as { SW_TRIM: SwTrim }).SW_TRIM;
});

// Review finding #1 (Critical): an earlier `activate` deleted every cache not in the current
// version list, full stop — which silently wiped `anytools-models` (owned by
// packages/anytools-tools/src/shared/onnx-loader.ts, 18.5 MB of ORT runtime + model, no `at-`
// prefix) on every single SW update. This exercises the real Cache Storage delete sequence
// sw.js's `activate` handler runs, against the fake CacheStorage, and proves the foreign-owned
// bucket and an unrelated third-party cache both survive while only the app's own stale
// version is removed.
describe('pickCachesToDelete (review finding #1)', () => {
  it("deletes only this app's own stale at-* caches, never a foreign-owned or unknown cache", async () => {
    const caches = new FakeCacheStorage();
    await (await caches.open('at-static-v0')).put('/chunk-old.js', 'stale-build-chunk');
    await (await caches.open('at-static-v1')).put('/chunk-new.js', 'current-build-chunk');
    await (await caches.open('anytools-models')).put('/third-party/onnx/model.onnx', 'weights');
    await (await caches.open('some-other-vendors-cache')).put('/x', 'not ours');

    const currentCacheNames = ['at-static-v1', 'at-vendor-v1', 'at-pages-v1', 'at-assets-v1'];
    const allNames = await caches.keys();
    const toDelete = SW_TRIM.pickCachesToDelete(allNames, currentCacheNames);
    expect(toDelete).toEqual(['at-static-v0']);

    await Promise.all(toDelete.map((name) => caches.delete(name)));
    const remaining = await caches.keys();
    expect(remaining).not.toContain('at-static-v0');
    expect(remaining).toContain('anytools-models');
    expect(remaining).toContain('some-other-vendors-cache');
    expect(remaining).toContain('at-static-v1');
  });

  it('deletes nothing when every existing cache is current or foreign-owned', () => {
    const toDelete = SW_TRIM.pickCachesToDelete(
      ['at-static-v1', 'anytools-models'],
      ['at-static-v1'],
    );
    expect(toDelete).toEqual([]);
  });
});

describe('extractBuildId', () => {
  it.each([
    ['/_next/static/abc123/chunks/main.js', 'abc123'],
    ['/_next/static/xyz-789/css/app.css', 'xyz-789'],
    ['/manifest.json', null],
    ['/_next/image?url=%2Ffoo.png', null],
  ])('%s -> %s', (pathname, expected) => {
    expect(SW_TRIM.extractBuildId(pathname)).toBe(expected);
  });
});

describe('pickStaleBuildEntries / planCacheTrim (review findings #4/#5)', () => {
  it('flags only entries from a different build id, keeping unrecognised entries', () => {
    const urls = [
      'http://localhost/_next/static/build-A/chunks/main.js',
      'http://localhost/_next/static/build-B/chunks/main.js',
      'http://localhost/_next/static/build-B/chunks/framework.js',
      'http://localhost/manifest.json', // no detectable build id — never treated as stale
    ];
    expect(SW_TRIM.pickStaleBuildEntries(urls, 'build-B')).toEqual([
      'http://localhost/_next/static/build-A/chunks/main.js',
    ]);
  });

  it('purges the stale build first, then FIFO-trims the remainder to the limit', () => {
    // Plain FIFO alone would delete `framework.js` (inserted first) before the truly stale
    // build-A entry, even though `framework.js` is still referenced by the CURRENT build —
    // exactly the false eviction review finding #5 flagged.
    const urls = [
      'http://localhost/_next/static/build-B/chunks/framework.js', // current build, oldest slot
      'http://localhost/_next/static/build-A/chunks/main.js', // stale build
      'http://localhost/_next/static/build-B/chunks/page.js', // current build
    ];
    const victims = SW_TRIM.planCacheTrim(urls, 2, 'build-B');
    expect(victims).toContain('http://localhost/_next/static/build-A/chunks/main.js');
    expect(victims).not.toContain('http://localhost/_next/static/build-B/chunks/framework.js');
  });

  it('falls back to plain FIFO when there is no known build id yet', () => {
    const urls = ['a', 'b', 'c', 'd'];
    expect(SW_TRIM.planCacheTrim(urls, 2, null)).toEqual(['a', 'b']);
  });
});

describe('trimToLimit', () => {
  it('returns no victims under the limit', () => {
    expect(SW_TRIM.trimToLimit(['a', 'b'], 5)).toEqual([]);
  });

  it('returns the oldest-inserted entries first once over the limit', () => {
    expect(SW_TRIM.trimToLimit(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b']);
  });
});

describe('trimCache (integration against the fake CacheStorage)', () => {
  it('deletes exactly the planned victims from the real cache object', async () => {
    const caches = new FakeCacheStorage();
    const cache = await caches.open('at-static-v1');
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      await cache.put(name, `body-${name}`);
    }
    const victims = await SW_TRIM.trimCache(caches, 'at-static-v1', 3, null);
    expect(victims).toEqual(['a', 'b']);
    const remainingKeys = (await cache.keys()).map((k) => k.url);
    expect(remainingKeys).toEqual(['c', 'd', 'e']);
  });
});

describe('createPutCounter', () => {
  it('reports true only every `threshold` increments, independently per cache name', () => {
    const counter = SW_TRIM.createPutCounter(3);
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push(counter.increment('cache-a'));
    expect(results).toEqual([false, false, true, false, false, true]);

    // A fresh cache name starts its own count from zero.
    expect(counter.increment('cache-b')).toBe(false);
  });
});

describe('readStoredBuildId / writeStoredBuildId', () => {
  it('round-trips a build id through the meta cache', async () => {
    const caches = new FakeCacheStorage();
    expect(await SW_TRIM.readStoredBuildId(caches, 'at-meta-v1', '/__meta__/build-id')).toBeNull();

    await SW_TRIM.writeStoredBuildId(caches, 'at-meta-v1', '/__meta__/build-id', 'build-xyz');
    expect(await SW_TRIM.readStoredBuildId(caches, 'at-meta-v1', '/__meta__/build-id')).toBe(
      'build-xyz',
    );
  });
});
