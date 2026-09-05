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
import { POPULATED_CLUSTERS } from '@/lib/cluster-config';
import { clusterLastModified, guideLastModified, toolLastModified } from '@/lib/content-lastmod';
import { clusterHasBodiedTool, hasLocalizedToolBody } from '@/lib/has-localized-tool-body';
import { listPublishedBlogRows } from '@/lib/load-blog-content';
import { GUIDE_SLUGS } from '@/lib/load-guide-content';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { SITE_URL, withXDefault } from '@/lib/site-url';
import { toolMetas } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';
import type { MetadataRoute } from 'next';
import { notFound } from 'next/navigation';

// force-dynamic on purpose — do NOT switch this to ISR/revalidate: the image
// builds on CI runners with no DB, so an ISR sitemap gets BAKED without the
// DB-sourced blog URLs and serves that truncated copy after every deploy
// (shipped and reverted 2026-08-05).
export const dynamic = 'force-dynamic';

// This file used to declare its own BASE constant duplicating site-url.ts's logic (and
// drifting: it had no IS_SELF_HOSTED awareness), which meant a self-host build would
// still emit `https://anytools.world` URLs here even though NEXT_PUBLIC_URL is unset,
// because NODE_ENV=production in the Dockerfile. SITE_URL is now the one place that
// decides this — imported directly, used below in place of the old BASE.

// Cluster landing pages, derived from the tool registry — a cluster with zero
// published tools is a dead end for a crawler and is left out. Previously this
// was a hand-maintained list and shipped `marketing` + `ecommerce-vn` with no
// tools behind them.
const CLUSTERS: ClusterId[] = POPULATED_CLUSTERS;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Self-host builds point at no known public origin and ship with no DATABASE_URL for
  // the blog-URL loop below — 404 rather than serve a sitemap full of placeholder URLs.
  if (IS_SELF_HOSTED) notFound();
  const urls: MetadataRoute.Sitemap = [];
  // Tools dark-launched via published:false are excluded until translations land.
  const publishedTools = toolMetas.filter((m) => m.published !== false);

  // No `priority` / `changeFrequency` on any entry: Google has ignored both since 2020,
  // and they doubled the payload. `lastModified` is the one freshness signal it reads,
  // sourced from git history when content/.lastmod.json exists (see content-lastmod.ts)
  // and omitted otherwise — a uniform or fabricated date is worse than none.
  for (const locale of routing.locales) {
    urls.push({ url: `${SITE_URL}/${locale}` });
    for (const slug of ['privacy', 'terms', 'about', 'contact']) {
      urls.push({ url: `${SITE_URL}/${locale}/${slug}` });
    }
    urls.push({ url: `${SITE_URL}/${locale}/guides` });
    for (const slug of GUIDE_SLUGS) {
      urls.push({
        url: `${SITE_URL}/${locale}/guides/${slug}`,
        lastModified: guideLastModified(locale, slug),
        alternates: {
          languages: withXDefault(
            Object.fromEntries(routing.locales.map((l) => [l, `${SITE_URL}/${l}/guides/${slug}`])),
          ),
        },
      });
    }
    // Blog index — emit for every locale for crawl breadth.
    urls.push({ url: `${SITE_URL}/${locale}/blog` });
    // Cluster landing pages (one per cluster per locale).
    //
    // Gated the same way tool URLs are. A cluster page is a grid of links; if none of
    // its tools have a body in this locale, every link points at a page our own robots
    // tag marks noindex — so the URL exists only to advertise pages we are telling
    // Google to skip. That is a smaller version of the pattern that got the AdSense
    // application declined, and the fix shipped on 2026-09-02 gated the tool loop below
    // while leaving this one emitting all four locales unconditionally.
    for (const cluster of CLUSTERS) {
      if (!clusterHasBodiedTool(locale, cluster)) continue;
      urls.push({
        url: `${SITE_URL}/${locale}/${cluster}`,
        lastModified: clusterLastModified(locale, cluster),
        alternates: {
          // Same predicate the page's own robots tag and hreflang use, so the three
          // signals cannot disagree.
          languages: withXDefault(
            Object.fromEntries(
              routing.locales
                .filter((l) => clusterHasBodiedTool(l, cluster))
                .map((l) => [l, `${SITE_URL}/${l}/${cluster}`]),
            ),
          ),
        },
      });
    }
    for (const m of publishedTools) {
      // Skip tools that don't support this locale (e.g. gpa-calculator is en-only)
      if (m.availableLocales && !m.availableLocales.includes(locale as never)) continue;
      // Skip tools whose body content has not been translated into this locale.
      // The page still works and is still reachable — it just isn't submitted as
      // indexable content while it consists of nothing but widget labels. See
      // has-localized-tool-body.ts for the measurements behind this.
      if (!hasLocalizedToolBody(locale, m.cluster, m.slug)) continue;
      urls.push({
        url: `${SITE_URL}/${locale}/${m.cluster}/${m.slug}`,
        lastModified: toolLastModified(locale, m.cluster, m.slug),
        alternates: {
          // Only advertise a translation that actually exists — hreflang pointing
          // at a bodyless page is what spread the thin pages through the index.
          languages: withXDefault(
            Object.fromEntries(
              (m.availableLocales ?? routing.locales)
                .filter((l) => hasLocalizedToolBody(l, m.cluster, m.slug))
                .map((l) => [l, `${SITE_URL}/${l}/${m.cluster}/${m.slug}`]),
            ),
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
      url: `${SITE_URL}/en/blog/${row.slug}`,
      lastModified: lastMod ?? undefined,
      alternates: { languages: withXDefault({ en: `${SITE_URL}/en/blog/${row.slug}` }) },
    });
  }

  return urls;
}
