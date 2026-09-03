import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

// Review finding #6 (2026-09-03): 8 of the 11 gated surfaces had zero test coverage —
// only self-hosted/site-url/robots/sitemap were exercised. AdSenseScript() is a plain
// function (no hooks), so unlike CookieConsentBanner it can be called directly here.
describe('AdSenseScript()', () => {
  it('renders null when self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { AdSenseScript } = await import('../components/adsense-script');
    expect(AdSenseScript()).toBeNull();
  });

  it('renders the script tag when hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { AdSenseScript } = await import('../components/adsense-script');
    expect(AdSenseScript()).not.toBeNull();
  });
});

describe('self-host-only routes return a real 404 GET/POST, not just a status code someone eyeballed once', () => {
  it('/ads.txt', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { GET } = await import('../app/ads.txt/route');
    expect(GET().status).toBe(404);
  });

  it('/api/postclaw/health', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { GET } = await import('../app/api/postclaw/health/route');
    const res = await GET(new Request('http://localhost/api/postclaw/health'));
    expect(res.status).toBe(404);
  });

  it('/api/auth/session (GET)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { GET } = await import('../app/api/auth/[...all]/route');
    const res = await GET(new Request('http://localhost/api/auth/session'));
    expect(res.status).toBe(404);
  });

  it('/api/auth/sign-in/email (POST)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { POST } = await import('../app/api/auth/[...all]/route');
    const res = await POST(new Request('http://localhost/api/auth/sign-in/email', { method: 'POST' }));
    expect(res.status).toBe(404);
  });
});

describe('requireAdmin() — the dedicated safety net for direct server-action POSTs', () => {
  it('rejects with "admin disabled" before ever touching better-auth', async () => {
    // Review finding #6: the phase's own risk table names "POST straight at a server
    // action id returns 200" as the failure signal for this exact guard, but no test
    // or verify step ever exercised it. requireAdmin() throws BEFORE importing
    // `./auth` (see auth-guards.ts), so this assertion alone proves better-auth never
    // initializes here — no BETTER_AUTH_SECRET/mocking required for this branch.
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { requireAdmin } = await import('./auth-guards');
    await expect(requireAdmin()).rejects.toThrow('admin disabled');
  });
});

describe('legal-content.ts — self-host privacy variant (review finding #3)', () => {
  const CHANGED_HEADINGS = ['What we collect', 'What we do not collect', 'Cookies', 'Third parties'];

  it('self-host (flag on): replaces the ads/analytics/third-parties/cookies/newsletter text', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { getLegalPage } = await import('./legal-content');
    const privacy = getLegalPage('privacy', 'en');
    const thirdParties = privacy.sections.find((s) => s.heading === 'Third parties')?.body.join(' ');
    // The hosted text names Hetzner/Resend as facts about who runs this install and
    // where the email goes — both are false on a stranger's self-host build and must
    // not survive (a truthful negated mention of AdSense/Umami, e.g. "no AdSense", is
    // fine and expected — that is the whole point of this variant).
    expect(thirdParties).not.toContain('Hetzner');
    expect(thirdParties).not.toContain('Resend');
    expect(thirdParties).toContain('Frankfurter');
    const cookies = privacy.sections.find((s) => s.heading === 'Cookies')?.body.join(' ');
    expect(cookies).not.toMatch(/AdSense may set|Google may set/);
  });

  it('self-host (flag on): every other section stays untouched', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
    vi.resetModules();
    const { getLegalPage } = await import('./legal-content');
    const privacyHosted = await (async () => {
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
      vi.resetModules();
      const mod = await import('./legal-content');
      const page = mod.getLegalPage('privacy', 'en');
      vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '1');
      vi.resetModules();
      return page;
    })();
    const privacySelfHost = getLegalPage('privacy', 'en');
    const untouchedHeadings = privacyHosted.sections
      .map((s) => s.heading)
      .filter((h) => !CHANGED_HEADINGS.includes(h));
    for (const heading of untouchedHeadings) {
      expect(privacySelfHost.sections.find((s) => s.heading === heading)?.body).toEqual(
        privacyHosted.sections.find((s) => s.heading === heading)?.body,
      );
    }
  });

  it('hosted (flag off): every locale keeps the original, unmodified text', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { getLegalPage } = await import('./legal-content');
    for (const locale of ['en', 'vi', 'es', 'pt']) {
      const thirdParties = getLegalPage('privacy', locale).sections.find(
        (s) => s.heading === 'Third parties' || s.heading === 'Bên thứ ba' || s.heading === 'Terceros' || s.heading === 'Terceiros',
      );
      expect(thirdParties?.body.join(' ')).toMatch(/Hetzner/);
    }
  });

  // Stored SHA-256 of the hosted EN privacy page's full text (title + every section's
  // heading/body), computed from the text as it existed before this phase's fix —
  // this is the byte-identical proof the phase's gate row requires: the hosted branch
  // must produce EXACTLY this text, not merely "some text that mentions Hetzner".
  it('hosted (flag off): EN privacy text hashes to the pre-fix value (byte-identical)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', '');
    vi.resetModules();
    const { getLegalPage } = await import('./legal-content');
    const { createHash } = await import('node:crypto');
    const page = getLegalPage('privacy', 'en');
    const canonical = JSON.stringify({
      title: page.title,
      sections: page.sections.map((s) => ({ heading: s.heading, body: s.body })),
    });
    const hash = createHash('sha256').update(canonical).digest('hex');
    expect(hash).toBe('ae9acb33a20e140f99f6a999072abc15f4f42a7eecf8b4763e787a8875769454');
  });
});

// Review finding #13 (2026-09-03): `loading.tsx` is what triggers the Suspense-
// streaming trap documented in dashboard/layout.tsx's comment (a later notFound()
// cannot change the HTTP status once the response has started streaming). This test
// fails the moment a `loading.tsx` file appears anywhere under one of the other
// self-host-gated subtrees, before anyone has to rediscover the trap by hand.
describe('self-host-gated subtrees never grow a loading.tsx', () => {
  function findLoadingTsxFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        found.push(...findLoadingTsxFiles(full));
      } else if (entry === 'loading.tsx') {
        found.push(full);
      }
    }
    return found;
  }

  const localeDir = join(process.cwd(), 'src', 'app', '[locale]');

  it.each(['sign-in', 'sign-up', 'blog', 'admin'])(
    '%s has no loading.tsx anywhere under it',
    (subtree) => {
      expect(findLoadingTsxFiles(join(localeDir, subtree))).toEqual([]);
    },
  );
});
