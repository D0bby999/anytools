/**
 * Next.js sitemap route for anytools.world.
 *
 * Blog URLs are now read from the DB at request time (via listPublishedBlogRows)
 * so a newly published post appears in the sitemap without a rebuild.
 *
 * Build safety: listPublishedBlogRows() returns [] on DB error so the build
 * and initial sitemap render succeed without a live DB connection.
 */

import { routing } from '@/i18n/routing';
import { listPublishedBlogRows } from '@/lib/load-blog-content';
import { GUIDE_SLUGS } from '@/lib/load-guide-content';
import { toolMetas } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';
import type { MetadataRoute } from 'next';

// Revalidate the sitemap at request time so new posts appear immediately.
export const dynamic = 'force-dynamic';

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
    // Blog index — emit for every locale for crawl breadth.
    urls.push({
      url: `${BASE}/${locale}/blog`,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
    // Cluster landing pages (one per cluster per locale).
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

  // Dynamic blog routes — fetched from DB at request time.
  // AnyTools is EN-only so we emit one URL per slug (no locale loop needed).
  const blogRows = await listPublishedBlogRows('en');
  for (const row of blogRows) {
    const lastMod = row.updatedAt ?? row.publishedAt ?? undefined;
    urls.push({
      url: `${BASE}/en/blog/${row.slug}`,
      changeFrequency: 'monthly',
      priority: 0.85,
      lastModified: lastMod ?? undefined,
      alternates: { languages: { en: `${BASE}/en/blog/${row.slug}` } },
    });
  }

  return urls;
}
