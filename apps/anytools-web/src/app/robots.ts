import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { SITE_URL } from '@/lib/site-url';
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  // Self-host builds have no sitemap (see sitemap.ts) and no public URL worth crawling
  // — no `sitemap` key here, and disallow everything rather than advertise a stranger's
  // private install to search engines.
  if (IS_SELF_HOSTED) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
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
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
