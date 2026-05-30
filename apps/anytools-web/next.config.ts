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
