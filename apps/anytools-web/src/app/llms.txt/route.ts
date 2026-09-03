/**
 * llms.txt — LLM-friendly site index per llmstxt.org spec.
 *
 * Served at /llms.txt. Gives AI agents a structured overview of the site so
 * answer engines can cite the right page: tools grouped by cluster, pillar
 * guides, then published blog posts.
 *
 * anytools is tool-first (unlike the review sites, whose llms.txt is just a
 * post list), so the tools come first — they are what someone asking an
 * assistant "what can I use to decode base64 / format SQL" actually wants.
 *
 * Build safety: listPublishedBlogRows() returns [] on DB error, so this route
 * still renders without a database.
 */

import { listPublishedBlogRows } from '@/lib/load-blog-content';
import { GUIDE_SLUGS } from '@/lib/load-guide-content';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { SITE_URL } from '@/lib/site-url';
import { toolMetas } from '@anytools/tools/meta';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const titleCase = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export async function GET(): Promise<NextResponse> {
  // Self-host builds point at no known public origin (see site-url.ts) and ship with no
  // DATABASE_URL for the blog-row fetch below — 404 rather than serve an index full of
  // placeholder URLs.
  if (IS_SELF_HOSTED) {
    return new NextResponse(null, { status: 404 });
  }
  const rows = await listPublishedBlogRows('en');
  const published = toolMetas.filter((m) => m.published !== false);

  // Group tools by cluster so an agent can scan a category rather than a flat
  // list of ~69 entries.
  const byCluster = new Map<string, typeof published>();
  for (const m of published) {
    const list = byCluster.get(m.cluster) ?? [];
    list.push(m);
    byCluster.set(m.cluster, list);
  }

  const toolSections = [...byCluster.entries()]
    .map(([cluster, metas]) => {
      // title/description are LocalizedText ({ en, vi, es, pt }), not strings.
      const lines = metas
        .map((m) => {
          const name = m.title?.en ?? titleCase(m.slug);
          const desc = m.description?.en ? `: ${m.description.en}` : '';
          return `- [${name}](${SITE_URL}/en/${cluster}/${m.slug})${desc}`;
        })
        .join('\n');
      return `### ${titleCase(cluster)}\n\n${lines}`;
    })
    .join('\n\n');

  const guideLines = GUIDE_SLUGS.map(
    (slug) => `- [${titleCase(slug)}](${SITE_URL}/en/guides/${slug})`,
  ).join('\n');

  const blogLines = rows
    .map((row) => {
      const url = `${SITE_URL}/en/blog/${row.slug}`;
      const desc = row.description ? `: ${row.description}` : '';
      return `- [${row.title}](${url})${desc}`;
    })
    .join('\n');

  const body = `# AnyTools
> Free, browser-based developer and everyday utilities — encoders, formatters, converters, and calculators. Everything runs client-side: no upload, no account, no data leaves the browser.

## About

AnyTools (${SITE_URL}) is a free toolbox of ${published.length} single-purpose web tools plus long-form guides. Tools process input locally in the browser, which matters for anything sensitive (tokens, config, personal figures). Available in English, Vietnamese, Spanish, and Portuguese.

## Tools

${toolSections || '- (No published tools yet.)'}

## Guides

${guideLines}

## Articles

${blogLines || '- (No published articles yet.)'}

## Feeds & Indexes

- [Sitemap](${SITE_URL}/sitemap.xml): Full URL index across all locales.
- [All Tools](${SITE_URL}/en): Human-readable tool index.
- [All Guides](${SITE_URL}/en/guides): Long-form reference guides.
`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
