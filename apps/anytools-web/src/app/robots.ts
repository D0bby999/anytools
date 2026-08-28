import type { MetadataRoute } from 'next';

const BASE =
  process.env.NEXT_PUBLIC_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://anytools.world' : 'http://localhost:3000');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] },
      // Named explicitly so a future wildcard tightening cannot silently cut off
      // AI search. The wildcard above already permits them; this records intent.
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'anthropic-ai', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      { userAgent: 'Bingbot', allow: '/' },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
