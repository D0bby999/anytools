import { afterEach, describe, expect, it, vi } from 'vitest';

// next.config.ts reads NEXT_PUBLIC_SELF_HOSTED at module top level (same reason
// self-hosted.test.ts needs vi.resetModules() + dynamic import for self-hosted.ts and
// site-url.ts) — a static import here would bake in whatever env vitest started with.
//
// next-intl/plugin is mocked so this test never touches next-intl's own module
// resolution (it expects to run inside a full Next.js build, not vitest) — the plugin
// wraps `nextConfig` with webpack/turbopack config for `next-intl/server`; for this
// test we only care about the plain object next.config.ts builds before the plugin
// touches it, so the mock is the identity function.
vi.mock('next-intl/plugin', () => ({
  default: () => (config: unknown) => config,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function headersOf(selfHosted: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', selfHosted ? '1' : '');
  vi.resetModules();
  const config = (await import('../../next.config')).default as {
    headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
  };
  const groups = await config.headers();
  const [firstGroup] = groups;
  if (!firstGroup) throw new Error('next.config headers() returned no header groups');
  return firstGroup.headers;
}

describe('next.config headers() — HSTS gated by NEXT_PUBLIC_SELF_HOSTED', () => {
  it('hosted (flag off): Strict-Transport-Security is present', async () => {
    const headers = await headersOf(false);
    expect(headers.find((h) => h.key === 'Strict-Transport-Security')).toBeDefined();
  });

  it('self-host (flag on): Strict-Transport-Security is absent', async () => {
    const headers = await headersOf(true);
    expect(headers.find((h) => h.key === 'Strict-Transport-Security')).toBeUndefined();
  });
});

// Gate row #13 (review-260903-phase-03.md finding #6): the CSP's script-src/connect-src/
// frame-src directives allowlisted AdSense + Google Analytics + a leftover
// stats.besttoys.world host even in the self-host build, contradicting "no ads, no
// analytics" — visible with a plain `curl -I`, no browser needed. `Reporting-Endpoints`/
// `report-uri` are NOT part of this gate: `/api/csp-report` itself is not gated in
// self-host, so both builds keep reporting configured.
describe('next.config headers() — CSP ad/analytics hosts gated by NEXT_PUBLIC_SELF_HOSTED', () => {
  const AD_ANALYTICS_HOSTS = [
    'pagead2.googlesyndication.com',
    'doubleclick.net',
    'googleadservices.com',
    'adtrafficquality.google',
    'fundingchoicesmessages.google.com',
    'google-analytics.com',
    'stats.besttoys.world',
  ];

  it('hosted (flag off): CSP allowlists every ad/analytics host', async () => {
    const headers = await headersOf(false);
    const csp = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value ?? '';
    for (const host of AD_ANALYTICS_HOSTS) {
      expect(csp).toContain(host);
    }
    // Reporting stays wired up in the hosted build too.
    expect(headers.find((h) => h.key === 'Reporting-Endpoints')?.value).toBe(
      'csp="/api/csp-report"',
    );
    expect(csp).toContain('report-uri /api/csp-report');
  });

  it('self-host (flag on): CSP contains none of the ad/analytics hosts', async () => {
    const headers = await headersOf(true);
    const csp = headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value ?? '';
    for (const host of AD_ANALYTICS_HOSTS) {
      expect(csp).not.toContain(host);
    }
    // 'self', blob:, data: and Next's inline-bootstrap allowances stay — this gate is
    // about the ad/analytics hosts only, not the whole policy.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'self'");
    // Reporting stays wired up in self-host too — /api/csp-report is not gated.
    expect(headers.find((h) => h.key === 'Reporting-Endpoints')?.value).toBe(
      'csp="/api/csp-report"',
    );
    expect(csp).toContain('report-uri /api/csp-report');
  });
});
