/**
 * Runs the real fetch-handling strategies from public/sw-lib.js against an in-memory fake
 * CacheStorage and a scripted fake fetch — behaviour tests, not source-text grepping. Replaces
 * the 5 grep-on-source-string tests that used to live in service-worker-policy.test.ts (review
 * finding #14): those stayed green if the condition they described was inverted, if `safePut`
 * were never called on some branch, or if the matched string only appeared in a comment.
 */
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from './test-support/fake-cache-storage';

const SW_LIB_PATH = resolve(__dirname, '..', '..', 'public', 'sw-lib.js');

type FakeResponseInit = {
  ok?: boolean;
  status?: number;
  redirected?: boolean;
  headers?: Record<string, string>;
  body?: string;
};

type FakeResponse = {
  ok: boolean;
  status: number;
  redirected: boolean;
  headers: { get(name: string): string | null };
  body: string;
  clone(): FakeResponse;
  text(): Promise<string>;
};

function makeResponse(init: FakeResponseInit = {}): FakeResponse {
  const headerMap = init.headers ?? {};
  const res: FakeResponse = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    redirected: init.redirected ?? false,
    headers: { get: (name: string) => headerMap[name.toLowerCase()] ?? null },
    body: init.body ?? 'body',
    clone: () => ({ ...res }),
    text: async () => res.body,
  };
  return res;
}

type SwLib = {
  safePut: (
    caches: FakeCacheStorage,
    cacheName: string,
    request: string,
    res: FakeResponse | undefined,
    onWrite?: () => void,
  ) => Promise<boolean>;
  cacheFirst: (
    caches: FakeCacheStorage,
    fetchFn: (request: string) => Promise<FakeResponse>,
    cacheName: string,
    request: string,
    onWrite?: () => void,
  ) => Promise<FakeResponse>;
  staleWhileRevalidate: (
    caches: FakeCacheStorage,
    fetchFn: (request: string) => Promise<FakeResponse>,
    cacheName: string,
    request: string,
    waitUntil?: (p: Promise<unknown>) => void,
    onWrite?: () => void,
  ) => Promise<FakeResponse>;
  localeFromPathname: (pathname: string, locales: string[]) => string;
  networkFirstNavigate: (
    caches: FakeCacheStorage,
    fetchFn: (request: string) => Promise<FakeResponse>,
    pagesCacheName: string,
    request: string,
    url: URL,
    locales: string[],
    onWrite?: () => void,
  ) => Promise<FakeResponse>;
  runInstall: (
    caches: FakeCacheStorage,
    fetchFn: (url: string) => Promise<FakeResponse>,
    entries: Array<{ cacheName: string; url: string }>,
    logError: (message: string, err?: unknown) => void,
  ) => Promise<void>;
};

let SW_LIB: SwLib;

beforeAll(async () => {
  await import(/* @vite-ignore */ SW_LIB_PATH);
  SW_LIB = (globalThis as unknown as { SW_LIB: SwLib }).SW_LIB;
});

describe('safePut', () => {
  it('writes a plain 200 response and reports the write via onWrite', async () => {
    const caches = new FakeCacheStorage();
    const onWrite = vi.fn();
    const written = await SW_LIB.safePut(caches, 'c1', '/x', makeResponse(), onWrite);
    expect(written).toBe(true);
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect(await caches.peek('c1')?.match('/x')).toBeTruthy();
  });

  it('never writes a redirected response (would throw on replay to a navigation)', async () => {
    const caches = new FakeCacheStorage();
    const written = await SW_LIB.safePut(caches, 'c1', '/', makeResponse({ redirected: true }));
    expect(written).toBe(false);
    expect(await caches.peek('c1')?.match('/')).toBeUndefined();
  });

  it.each([
    ['non-ok response', makeResponse({ ok: false, status: 404 })],
    ['non-200 status', makeResponse({ status: 206 })],
    ['missing response', undefined],
  ])('never writes a %s', async (_label, res) => {
    const caches = new FakeCacheStorage();
    const written = await SW_LIB.safePut(caches, 'c1', '/x', res);
    expect(written).toBe(false);
  });

  it.each([
    ['Cache-Control: no-store', { 'cache-control': 'no-store' }],
    ['Cache-Control: private', { 'cache-control': 'private, max-age=0' }],
    ['Set-Cookie present', { 'set-cookie': 'session=abc; Path=/' }],
  ])('never writes a response marked %s (review finding #7)', async (_label, headers) => {
    const caches = new FakeCacheStorage();
    const written = await SW_LIB.safePut(caches, 'c1', '/x', makeResponse({ headers }));
    expect(written).toBe(false);
    expect(await caches.peek('c1')?.match('/x')).toBeUndefined();
  });

  it('swallows a cache-write failure (QuotaExceededError) without throwing', async () => {
    const throwingCaches = {
      open: async () => ({
        match: async () => undefined,
        put: async () => {
          throw new DOMException('quota exceeded', 'QuotaExceededError');
        },
      }),
    };
    await expect(
      SW_LIB.safePut(throwingCaches as unknown as FakeCacheStorage, 'c1', '/x', makeResponse()),
    ).resolves.toBe(false);
  });
});

describe('cacheFirst', () => {
  it('serves from cache on a hit without calling fetch again', async () => {
    const caches = new FakeCacheStorage();
    await SW_LIB.safePut(caches, 'c1', '/x', makeResponse({ body: 'first' }));
    const fetchFn = vi.fn(async () => makeResponse({ body: 'second' }));
    const response = await SW_LIB.cacheFirst(caches, fetchFn, 'c1', '/x');
    expect(response.body).toBe('first');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches and caches on a miss', async () => {
    const caches = new FakeCacheStorage();
    const fetchFn = vi.fn(async () => makeResponse({ body: 'fresh' }));
    const response = await SW_LIB.cacheFirst(caches, fetchFn, 'c1', '/x');
    expect(response.body).toBe('fresh');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await caches.peek('c1')?.match('/x')).toBeTruthy();
  });
});

describe('staleWhileRevalidate', () => {
  it('returns the cached copy immediately and revalidates via waitUntil in the background', async () => {
    const caches = new FakeCacheStorage();
    await SW_LIB.safePut(caches, 'c1', '/x', makeResponse({ body: 'stale' }));
    const fetchFn = vi.fn(async () => makeResponse({ body: 'fresh' }));
    const waitUntil = vi.fn();
    const response = await SW_LIB.staleWhileRevalidate(caches, fetchFn, 'c1', '/x', waitUntil);
    expect(response.body).toBe('stale');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // Let the background revalidation promise (handed to waitUntil) settle, then confirm it
    // actually wrote the fresh copy — this is the "background write" review finding #16 is
    // about: it must happen, just not block the response already returned above.
    await waitUntil.mock.calls[0]?.[0];
    expect((await caches.peek('c1')?.match('/x')) as FakeResponse | undefined).toMatchObject({
      body: 'fresh',
    });
  });

  it('awaits the network on a miss', async () => {
    const caches = new FakeCacheStorage();
    const fetchFn = vi.fn(async () => makeResponse({ body: 'fresh' }));
    const response = await SW_LIB.staleWhileRevalidate(caches, fetchFn, 'c1', '/x');
    expect(response.body).toBe('fresh');
  });
});

describe('networkFirstNavigate', () => {
  it('returns the network response and caches it when the network succeeds', async () => {
    const caches = new FakeCacheStorage();
    const fetchFn = vi.fn(async () => makeResponse({ body: 'online' }));
    const response = await SW_LIB.networkFirstNavigate(
      caches,
      fetchFn,
      'pages',
      '/en/pdf/merge-pdf',
      new URL('http://localhost/en/pdf/merge-pdf'),
      ['en', 'vi', 'es', 'pt'],
    );
    expect(response.body).toBe('online');
    expect(await caches.peek('pages')?.match('/en/pdf/merge-pdf')).toBeTruthy();
  });

  it('falls back to a cached copy, matched with ignoreSearch, when the network fails', async () => {
    const caches = new FakeCacheStorage();
    await SW_LIB.safePut(caches, 'pages', '/en/pdf/merge-pdf', makeResponse({ body: 'cached' }));
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network down');
    });
    // A visitor arriving via `?utm_source=newsletter` must still hit the page cached from a
    // bare visit (review finding #11) instead of dropping straight to the offline fallback.
    const response = await SW_LIB.networkFirstNavigate(
      caches,
      fetchFn,
      'pages',
      '/en/pdf/merge-pdf?utm_source=newsletter',
      new URL('http://localhost/en/pdf/merge-pdf?utm_source=newsletter'),
      ['en', 'vi', 'es', 'pt'],
    );
    expect(response.body).toBe('cached');
  });

  it('falls back to the locale offline page when nothing else matches', async () => {
    const caches = new FakeCacheStorage();
    await SW_LIB.safePut(caches, 'pages', '/vi/offline', makeResponse({ body: 'offline-vi' }));
    const fetchFn = vi.fn(async () => {
      throw new TypeError('network down');
    });
    const response = await SW_LIB.networkFirstNavigate(
      caches,
      fetchFn,
      'pages',
      '/vi/finance/loan-calculator',
      new URL('http://localhost/vi/finance/loan-calculator'),
      ['en', 'vi', 'es', 'pt'],
    );
    expect(response.body).toBe('offline-vi');
  });
});

describe('localeFromPathname', () => {
  it.each([
    ['/en/pdf/merge-pdf', 'en'],
    ['/vi/finance/loan-calculator', 'vi'],
    ['/pt', 'pt'],
    ['/no-locale-prefix', 'en'], // falls back to the first configured locale
  ])('%s -> %s', (pathname, expected) => {
    expect(SW_LIB.localeFromPathname(pathname, ['en', 'vi', 'es', 'pt'])).toBe(expected);
  });
});

describe('runInstall', () => {
  it('caches each entry via fetch + safePut and tolerates one URL failing (review finding #15)', async () => {
    const caches = new FakeCacheStorage();
    const fetchFn = vi.fn(async (url: string) => {
      if (url === '/vi/offline') throw new TypeError('network down');
      return makeResponse({ body: url });
    });
    const logError = vi.fn();
    const entries = [
      { cacheName: 'pages', url: '/en/offline' },
      { cacheName: 'pages', url: '/vi/offline' },
      { cacheName: 'pages', url: '/es/offline' },
      { cacheName: 'pages', url: '/pt/offline' },
      { cacheName: 'assets', url: '/manifest.json' },
    ];
    await SW_LIB.runInstall(caches, fetchFn, entries, logError);

    expect(await caches.peek('pages')?.match('/en/offline')).toBeTruthy();
    expect(await caches.peek('pages')?.match('/vi/offline')).toBeUndefined();
    expect(await caches.peek('pages')?.match('/es/offline')).toBeTruthy();
    expect(await caches.peek('pages')?.match('/pt/offline')).toBeTruthy();
    expect(await caches.peek('assets')?.match('/manifest.json')).toBeTruthy();
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toContain('/vi/offline');
  });
});
