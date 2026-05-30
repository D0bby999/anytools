import type { MetadataRoute } from 'next';

const BASE =
  process.env.NEXT_PUBLIC_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://anytools.world' : 'http://localhost:3000');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
