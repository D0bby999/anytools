import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Can't import `@/lib/self-hosted` here — next.config.ts runs outside the `@/` path
// alias Next.js's own bundler sets up for `src/**`, so this reads the same
// `NEXT_PUBLIC_SELF_HOSTED` build-arg directly (see self-hosted.ts for the single
// source of truth every other file imports from — this file is the one documented
// exception).
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === '1';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Minimal Docker image: emits .next/standalone with only the runtime deps.
  output: 'standalone',
  // Monorepo: include workspace files in standalone trace.
  outputFileTracingRoot: process.cwd() + '/../..',
  transpilePackages: ['@anytools/ui', '@anytools/tools', '@anytools/i18n', '@anytools/analytics'],
  serverExternalPackages: [
    'curlconverter',
    'tree-sitter',
    'tree-sitter-bash',
    'better-sqlite3',
    'better-auth',
  ],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // www serves the whole site on its own hostname, and the TLS cert covers it, so Google indexed
  // BOTH hosts. Inspection on 2026-08-31: `https://www.anytools.world/` came back "Submitted and
  // indexed" while the apex homepage came back "Duplicate, Google chose different canonical than
  // user" — Google picked the www copy over the one the sitemap and every canonical tag declare.
  // A canonical tag is a hint; a 301 is not. This runs before the locale middleware, so the
  // redirect lands on the apex host with the path intact and the middleware resolves the locale
  // there, exactly as it does for direct apex traffic.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.anytools.world' }],
        destination: 'https://anytools.world/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    const responseHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // HSTS + preload assumes the browser reached this response over TLS on a domain
      // this operator controls forever. A self-host install is commonly reached over
      // plain HTTP on a LAN/localhost — sending `preload` there is a trap: browsers
      // that have cached the preload directive will refuse to load the site over HTTP
      // ever again, even after the operator points a real domain + cert at it later.
      // Filtered out below (rather than made conditional on scheme, which this
      // function has no way to know at build time).
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      // Report-only to start. The PDF tools parse attacker-supplied files with pdf.js,
      // which has a documented class of arbitrary-JS-execution bugs through the font
      // path (CVE-2024-4367 and successors), and better-auth keeps a 30-day session
      // cookie on this same origin. Until now there was no CSP at all.
      //
      // Report-only rather than enforcing because AdSense loads a chain of scripts
      // whose hosts are not fully enumerable in advance, and an over-tight policy would
      // silently kill the site's only revenue. Collect violations first, then enforce.
      // The value below is deliberately permissive about Google's ad hosts and strict
      // about everything else.
      { key: 'Reporting-Endpoints', value: 'csp="/api/csp-report"' },
      {
        key: 'Content-Security-Policy-Report-Only',
        value: [
          "default-src 'self'",
          // 'unsafe-inline'/'unsafe-eval' are required by Next's inline bootstrap and by
          // the ad stack. They are what a later enforcing policy should try to remove,
          // via nonces, once the report data shows what actually loads.
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://*.doubleclick.net https://*.adtrafficquality.google https://fundingchoicesmessages.google.com https://stats.besttoys.world",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          // blob: is what the PDF and image tools use for their output; worker-src is
          // what pdf.js needs for pdf.worker.
          "worker-src 'self' blob:",
          "connect-src 'self' https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.adtrafficquality.google https://*.google-analytics.com https://stats.besttoys.world",
          "frame-src 'self' https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://*.safeframe.googlesyndication.com https://*.adtrafficquality.google",
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          // Without a destination the header only prints into each visitor's own console
          // and the operator learns nothing — the "collect, then enforce" plan above
          // cannot reach its second step. report-uri is the legacy form and still the
          // one browsers reliably honour for report-only.
          'report-uri /api/csp-report',
          'report-to csp',
        ].join('; '),
      },
    ];
    return [
      {
        source: '/(.*)',
        headers: responseHeaders.filter(
          (h) => !(IS_SELF_HOSTED && h.key === 'Strict-Transport-Security'),
        ),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
