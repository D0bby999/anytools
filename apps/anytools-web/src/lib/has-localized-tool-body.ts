import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Does this tool have written body content (tutorial and/or FAQ) in this locale?
 *
 * Why this exists: `loadToolContent` deliberately degrades to empty when a locale's
 * MDX is missing, so a tool ships in every language the moment its UI strings are
 * translated. The side effect is a page that renders nothing but widget labels.
 *
 * Measured on production 2026-09-02, that side effect had taken over the site:
 *
 *   locale   tools with a body      median unique words on a tool page
 *   en       77 / 77                400-800
 *   vi       34 / 76                ~150
 *   es       22 / 76                ~130
 *   pt       22 / 76                ~130
 *
 * 150 of the 414 sitemap URLs were bodyless tool pages, and Google rejected the
 * AdSense application for insufficient content. Those pages are not wrong to
 * SERVE — someone who wants the converter in Spanish still gets a working
 * converter — but they should not be advertised to crawlers as though they were
 * articles. So the sitemap omits them and the page marks itself noindex until
 * its translation lands.
 *
 * This is a filter on what we CLAIM, not a deletion: drop a
 * `content/<locale>/tools/<cluster>/<slug>-faq.mdx` in and the page re-enters the
 * index on the next build with no code change.
 */

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

export function hasLocalizedToolBody(locale: string, cluster: string, slug: string): boolean {
  const base = join(CONTENT_ROOT, locale, 'tools', cluster);
  return (
    existsSync(join(base, `${slug}-faq.mdx`)) || existsSync(join(base, `${slug}-tutorial.mdx`))
  );
}
