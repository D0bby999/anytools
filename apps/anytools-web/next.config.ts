import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
