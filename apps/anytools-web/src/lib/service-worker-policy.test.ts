import { resolve } from 'node:path';
/**
 * Executes the real cache-bypass decision function instead of grepping a copy of its regex.
 * Red-team finding #1 on this plan: an earlier draft's rule was `startsWith('/dashboard')`,
 * which never matches `/en/dashboard` — next-intl's `localePrefix: 'always'` means every
 * real page carries a locale prefix. A test that only greps the source string would not
 * have caught that; this one imports public/sw-policy.js (the same file public/sw.js loads
 * via `importScripts`) and calls `shouldBypassCache` on real sample URLs.
 */
import { locales } from '@anytools/i18n';
import { beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = resolve(__dirname, '..', '..');
const SW_POLICY_PATH = resolve(APP_ROOT, 'public', 'sw-policy.js');

type ShouldBypassCache = (
  url: URL,
  request?: { method?: string; headers?: { get(name: string): string | null } },
) => boolean;

type SwPolicy = {
  shouldBypassCache: ShouldBypassCache;
  LOCALES: string[];
  PRIVATE_PATH: RegExp;
};

let SW_POLICY: SwPolicy;
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
  SW_POLICY = (globalThis as unknown as { SW_POLICY: SwPolicy }).SW_POLICY;
  shouldBypassCache = SW_POLICY.shouldBypassCache;
});

function url(pathname: string, origin = 'http://localhost:3000'): URL {
  return new URL(pathname, origin);
}

function headers(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
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
    ['/api', 'GET'], // exact match, no trailing slash (review finding #20)
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

  // Review finding #8: an upper-cased or %-encoded variant of a private path used to slip
  // through — harmless today only because those exact forms 404/redirect and `!res.ok`
  // already keeps them uncached, not because the rule matched them.
  it.each([['/EN/dashboard'], ['/en/Dashboard'], ['/en%2Fdashboard']])(
    'bypasses case/encoding variants of a private path: %s',
    (pathname) => {
      expect(shouldBypassCache(url(pathname), { method: 'GET' })).toBe(true);
    },
  );

  // Review findings #2/#3: onnx-loader.ts owns caching for these two prefixes itself (a
  // versioned, sha-verified Cache API path under `anytools-models`) — the SW must never
  // cache-first the bare URL, or a vendor bump can leave it serving stale bytes forever.
  it.each([['/third-party/onnx/ort-wasm-simd-threaded.wasm'], ['/third-party/u2netp/u2netp.onnx']])(
    'bypasses cache for onnx-loader-owned path %s',
    (pathname) => {
      expect(shouldBypassCache(url(pathname), { method: 'GET' })).toBe(true);
    },
  );

  // Review finding #17: a Range request wants a 206 partial response, which `cache.match`
  // cannot produce — it must go straight to the network regardless of path.
  it('bypasses a request carrying a Range header', () => {
    expect(
      shouldBypassCache(url('/third-party/onnx/ort-wasm-simd-threaded.wasm'), {
        method: 'GET',
        headers: headers({ range: 'bytes=0-1023' }),
      }),
    ).toBe(true);
    expect(
      shouldBypassCache(url('/en/pdf/merge-pdf'), {
        method: 'GET',
        headers: headers({ range: 'bytes=0-1023' }),
      }),
    ).toBe(true);
  });

  it('does not bypass a GET with no Range header, even when headers.get exists', () => {
    expect(
      shouldBypassCache(url('/en/pdf/merge-pdf'), { method: 'GET', headers: headers({}) }),
    ).toBe(false);
  });
});

// Review finding #6: the locale list in sw-policy.js is hand-written plain JS (a classic
// script has no module resolution to reach into @anytools/i18n at runtime), so nothing
// stopped it drifting from the real locale list. This test imports the real `locales` export
// and fails the moment someone adds/removes a locale in @anytools/i18n without updating
// sw-policy.js's own `LOCALES` array to match.
describe('sw-policy.js locale list (drift guard)', () => {
  it('matches @anytools/i18n exactly', () => {
    expect(SW_POLICY.LOCALES).toEqual([...locales]);
  });

  it('is what PRIVATE_PATH was actually built from — not a decorative second copy', () => {
    for (const locale of locales) {
      expect(SW_POLICY.PRIVATE_PATH.source).toContain(locale);
    }
  });
});
