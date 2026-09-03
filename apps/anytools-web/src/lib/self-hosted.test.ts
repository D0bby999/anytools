import { afterEach, describe, expect, it, vi } from 'vitest';

// Every module under test reads its gating env var at MODULE TOP LEVEL
// (`self-hosted.ts`, `site-url.ts`) — a plain `import` at the top of this file would
// bake in whatever env vitest happened to start with, and the two describe blocks
// below would silently test the exact same cached module. `vi.resetModules()` +
// dynamic `import()` inside each test is what actually re-evaluates them per env.
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('IS_SELF_HOSTED — cờ bật (NEXT_PUBLIC_SELF_HOSTED=1)', () => {
  it('is true, and SITE_URL never leaks the hosted domain', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { IS_SELF_HOSTED } = await import('./self-hosted');
    const { SITE_URL } = await import('./site-url');
    expect(IS_SELF_HOSTED).toBe(true);
    expect(SITE_URL).not.toContain('anytools.world');
  });

  it('selfHostSafeAlternates() strips any alternates object to undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { selfHostSafeAlternates } = await import('./site-url');
    expect(
      selfHostSafeAlternates({ canonical: '/en/pdf/merge-pdf', languages: { en: '/en' } }),
    ).toBeUndefined();
  });

  it('robots() disallows everything and carries no sitemap key', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const robots = (await import('../app/robots')).default;
    const result = robots();
    expect(result.rules).toEqual([{ userAgent: '*', disallow: '/' }]);
    expect(result).not.toHaveProperty('sitemap');
  });

  it('sitemap() 404s instead of serving a URL list', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const sitemap = (await import('../app/sitemap')).default;
    // notFound() throws; a route that served [] with a 200 would look identical to
    // a site with zero pages instead of one that does not exist here at all — the
    // phase's own risk assessment calls that out as the wrong shape for this gate.
    // Asserting the digest (not just `.rejects.toThrow()`) is what actually proves
    // this is Next's notFound() and not some unrelated thrown error (a DB import
    // failure would also make a bare `.rejects.toThrow()` pass) — review finding #12.
    await expect(sitemap()).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' });
  });
});

describe('IS_SELF_HOSTED — cờ tắt (mặc định, hosted build)', () => {
  it('is false, and SITE_URL resolves to the hosted domain in a production build', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { IS_SELF_HOSTED } = await import('./self-hosted');
    const { SITE_URL } = await import('./site-url');
    expect(IS_SELF_HOSTED).toBe(false);
    expect(SITE_URL).toContain('anytools.world');
  });

  it('SITE_URL falls back to the production URL when NEXT_PUBLIC_URL is an empty string', async () => {
    // Docker's `ARG NEXT_PUBLIC_URL` declared but not passed at build time yields ''
    // (not undefined) — `?? fallback` treated that as "set" and fed `new URL('')`,
    // which throws during `next build` (caught building Phase 2's Docker default
    // target with no build-args). `.trim() || fallback` must treat '' as absent.
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { SITE_URL, METADATA_BASE } = await import('./site-url');
    expect(SITE_URL).toContain('anytools.world');
    expect(() => new URL(SITE_URL)).not.toThrow();
    expect(METADATA_BASE).toBeInstanceOf(URL);
  });

  it('selfHostSafeAlternates() passes its argument through unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { selfHostSafeAlternates } = await import('./site-url');
    const alternates = { canonical: '/en/pdf/merge-pdf', languages: { en: '/en' } };
    expect(selfHostSafeAlternates(alternates)).toBe(alternates);
  });

  it('robots() allows crawling and links the sitemap', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const robots = (await import('../app/robots')).default;
    const result = robots();
    expect(result.sitemap).toContain('/sitemap.xml');
    expect(result.rules).not.toEqual([{ userAgent: '*', disallow: '/' }]);
  });

  it('sitemap() serves a non-empty URL list', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const sitemap = (await import('../app/sitemap')).default;
    const urls = await sitemap();
    expect(urls.length).toBeGreaterThan(0);
  });
});

// CookieConsentBanner is deliberately NOT exercised here: it calls
// useCookieConsent() and useTranslations(), both of which throw outside their
// providers under vitest.config.ts's `environment: 'node'`. Its self-host gating is
// verified by grepping rendered HTML (`role="dialog"` absent) in the phase's browser
// Verify step instead.
