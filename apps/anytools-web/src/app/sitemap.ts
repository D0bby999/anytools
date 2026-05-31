import { routing } from '@/i18n/routing';
import { BLOG_SLUGS } from '@/lib/load-blog-content';
import { GUIDE_SLUGS } from '@/lib/load-guide-content';
import { toolMetas } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';
import type { MetadataRoute } from 'next';

const BASE =
  process.env.NEXT_PUBLIC_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://anytools.world' : 'http://localhost:3000');

// All cluster landing IDs — must match the ClusterId union in @anytools/tools/types.
// Each gets its own landing page emitted to the sitemap.
const CLUSTERS: ClusterId[] = [
  'encoding',
  'formatters',
  'generators',
  'converters',
  'text-regex',
  'time-date',
  'web3',
  'marketing',
  'ecommerce-vn',
  'finance',
  'health',
  'lifestyle',
  'design',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const urls: MetadataRoute.Sitemap = [];
  // Tools dark-launched via published:false are excluded until translations land.
  const publishedTools = toolMetas.filter((m) => m.published !== false);

  for (const locale of routing.locales) {
    urls.push({
      url: `${BASE}/${locale}`,
      changeFrequency: 'weekly',
      priority: 1.0,
    });
    for (const slug of ['privacy', 'terms', 'about', 'contact']) {
      urls.push({
        url: `${BASE}/${locale}/${slug}`,
        changeFrequency: 'yearly',
        priority: 0.3,
      });
    }
    urls.push({
      url: `${BASE}/${locale}/guides`,
      changeFrequency: 'monthly',
      priority: 0.7,
    });
    for (const slug of GUIDE_SLUGS) {
      urls.push({
        url: `${BASE}/${locale}/guides/${slug}`,
        changeFrequency: 'monthly',
        priority: 0.9,
        alternates: {
          languages: Object.fromEntries(
            routing.locales.map((l) => [l, `${BASE}/${l}/guides/${slug}`]),
          ),
        },
      });
    }
    // Blog index (Phase 1 EN-only — emit for every locale anyway for crawl breadth)
    urls.push({
      url: `${BASE}/${locale}/blog`,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
    // Blog posts (Phase 1 EN-only; only emit URLs for English).
    // When VI/ES/PT translations land, loop locales like GUIDE_SLUGS above.
    if (locale === 'en') {
      for (const slug of BLOG_SLUGS) {
        urls.push({
          url: `${BASE}/${locale}/blog/${slug}`,
          changeFrequency: 'monthly',
          priority: 0.85,
          alternates: { languages: { en: `${BASE}/en/blog/${slug}` } },
        });
      }
    }
    // Cluster landing pages (one per cluster per locale). Auto-loop on toolMetas
    // does NOT cover these — landings must be emitted explicitly.
    for (const cluster of CLUSTERS) {
      urls.push({
        url: `${BASE}/${locale}/${cluster}`,
        changeFrequency: 'weekly',
        priority: 0.7,
        alternates: {
          languages: Object.fromEntries(routing.locales.map((l) => [l, `${BASE}/${l}/${cluster}`])),
        },
      });
    }
    for (const m of publishedTools) {
      // Skip tools that don't support this locale (e.g. gpa-calculator is en-only)
      if (m.availableLocales && !m.availableLocales.includes(locale as never)) continue;
      urls.push({
        url: `${BASE}/${locale}/${m.cluster}/${m.slug}`,
        changeFrequency: 'monthly',
        priority: 0.8,
        alternates: {
          languages: Object.fromEntries(
            (m.availableLocales ?? routing.locales).map((l) => [
              l,
              `${BASE}/${l}/${m.cluster}/${m.slug}`,
            ]),
          ),
        },
      });
    }
  }
  return urls;
}
