/**
 * Executes the real cache-bypass decision function instead of grepping a copy of its regex.
 * Red-team finding #1 on this plan: an earlier draft's rule was `startsWith('/dashboard')`,
 * which never matches `/en/dashboard` — next-intl's `localePrefix: 'always'` means every
 * real page carries a locale prefix. A test that only greps the source string would not
 * have caught that; this one imports public/sw-policy.js (the same file public/sw.js loads
 * via `importScripts`) and calls `shouldBypassCache` on real sample URLs.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = resolve(__dirname, '..', '..');
const SW_POLICY_PATH = resolve(APP_ROOT, 'public', 'sw-policy.js');
const SW_PATH = resolve(APP_ROOT, 'public', 'sw.js');

type ShouldBypassCache = (url: URL, request?: { method?: string }) => boolean;

let shouldBypassCache: ShouldBypassCache;

beforeAll(async () => {
  // sw-policy.js reads `root.location` lazily (only when shouldBypassCache actually runs),
  // so this can be set any time before the assertions below — it stands in for
  // `self.location` inside a real service worker scope.
  (globalThis as unknown as { location: { origin: string } }).location = {
    origin: 'http://localhost:3000',
  };

  // sw-policy.js is a classic script (no import/export), loaded by sw.js via
  // `importScripts` — importing it here runs the same side effect: it assigns
  // `globalThis.SW_POLICY`.
  await import(/* @vite-ignore */ SW_POLICY_PATH);
  shouldBypassCache = (
    globalThis as unknown as { SW_POLICY: { shouldBypassCache: ShouldBypassCache } }
  ).SW_POLICY.shouldBypassCache;
});

function url(pathname: string, origin = 'http://localhost:3000'): URL {
  return new URL(pathname, origin);
}

describe('shouldBypassCache', () => {
  it.each([
    ['/en/dashboard', 'GET'],
    ['/vi/admin/distribution', 'GET'],
    ['/pt/sign-in', 'GET'],
    ['/es/favorites', 'GET'],
    ['/dashboard', 'GET'], // bare path, pre-locale-cookie rewrite window (middleware.ts)
    ['/api/fx', 'GET'],
    ['/api/curl-convert', 'GET'],
  ])('bypasses cache for private/API path %s', (pathname) => {
    expect(shouldBypassCache(url(pathname), { method: 'GET' })).toBe(true);
  });

  it.each([
    ['/en/pdf/merge-pdf'],
    ['/vi/finance/loan-calculator'],
    ['/en'],
    ['/_next/static/chunk.js'],
    ['/_next/static/x.js'],
    ['/third-party/pdfjs/pdf.worker.min.mjs'],
  ])('is cacheable (does not bypass) for %s', (pathname) => {
    expect(shouldBypassCache(url(pathname), { method: 'GET' })).toBe(false);
  });

  it('bypasses any non-GET request regardless of path', () => {
    // Otherwise-cacheable path — the only reason to bypass here is the method.
    expect(shouldBypassCache(url('/en/pdf/merge-pdf'), { method: 'POST' })).toBe(true);
    expect(shouldBypassCache(url('/en/pdf/merge-pdf'), { method: 'DELETE' })).toBe(true);
  });

  it('bypasses a cross-origin request', () => {
    expect(shouldBypassCache(url('/script.js', 'https://cdn.example.com'))).toBe(true);
  });

  it('does not bypass when no request object is supplied (method unknown, assume GET)', () => {
    expect(shouldBypassCache(url('/en/pdf/merge-pdf'))).toBe(false);
  });
});

describe('public/sw.js', () => {
  const source = readFileSync(SW_PATH, 'utf8');

  it('loads the shared policy via importScripts and calls the real decision function', () => {
    expect(source).toContain("importScripts('/sw-policy.js')");
    expect(source).toContain('SW_POLICY.shouldBypassCache');
  });

  it('never caches a redirected response', () => {
    expect(source).toMatch(/res\.redirected/);
  });

  it('swallows cache-write failures (QuotaExceededError) in a try/catch around cache.put', () => {
    const putIndex = source.indexOf('cache.put(');
    expect(putIndex).toBeGreaterThan(-1);
    const around = source.slice(Math.max(0, putIndex - 200), putIndex + 200);
    expect(around).toMatch(/try\s*{/);
    expect(around).toMatch(/}\s*catch/);
  });

  it('calls skipWaiting but never clients.claim', () => {
    expect(source).toContain('skipWaiting()');
    expect(source).not.toContain('clients.claim()');
  });

  it('precaches exactly 5 URLs across all addAll() calls, none under /third-party/', () => {
    const addAllCalls = [...source.matchAll(/addAll\(\[([\s\S]*?)\]\)/g)];
    expect(addAllCalls.length).toBeGreaterThan(0);
    const urls = addAllCalls.flatMap((match) => {
      const arrayLiteral = match[1] ?? '';
      return [...arrayLiteral.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
    });
    expect(urls).toHaveLength(5);
    expect(urls).toEqual(
      expect.arrayContaining([
        '/en/offline',
        '/vi/offline',
        '/es/offline',
        '/pt/offline',
        '/manifest.json',
      ]),
    );
    expect(urls.some((u) => u.includes('third-party'))).toBe(false);
  });
});
