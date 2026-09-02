import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolMetas } from '@anytools/tools/meta';

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
 *
 * The check counts WORDS, not files. An existence check passes on an empty file,
 * which would flip a page to index:true and into the sitemap with nothing on it —
 * recreating the exact defect above via the mechanism meant to prevent it.
 */

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

/**
 * Floor for "this page says something". This is a tripwire for empty and placeholder
 * files, NOT a quality bar — it must never deindex a page that has real prose on it.
 *
 * Calibrated against the shipped corpus rather than picked as a round number.
 * Measured 2026-09-02 with this exact counter: 76 English tools, mean 434 words,
 * minimum 324 (date-diff). vi/es/pt minimums are 545 / 1140 / 518. Nothing live
 * falls under 300, so this floor deindexes nothing today.
 *
 * Raising it later is a content decision, not a mechanical one — measure what it
 * would deindex first. (A first pass at this used a naive `\bTODO\b` match, which
 * zeroed regex-tester's tutorial for discussing "finding TODO comments" and made
 * the corpus look thinner than it is. Measure with the real counter, not a proxy.)
 */
export const MIN_BODY_WORDS = 300;

/**
 * `sitemap.ts` is force-dynamic, so it re-runs per request and calls this once per
 * locale per tool plus once more inside each hreflang filter — roughly 40x the tool
 * count in filesystem hits every time. The content directory is baked into the image
 * and immutable for the life of the process, so a process-lifetime cache is correct
 * by construction rather than a staleness trade-off.
 */
const cache = new Map<string, boolean>();

// …except in dev, where the content directory is a live working tree. MDX files are read
// through fs and are not in the module graph, so writing a new translation would not
// invalidate anything and the author would keep seeing a stale noindex until they restarted
// the dev server. Caching is a production optimisation only.
const CACHEABLE = process.env.NODE_ENV === 'production';

function bodyWordCount(file: string): number {
  if (!existsSync(file)) return 0;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 0;
  }
  // Drop YAML frontmatter, import/export lines, and JSX tags so the count reflects
  // prose a reader would see rather than MDX scaffolding.
  //
  // The tag pattern is tag-SHAPED and single-line on purpose. A naive /<[^>]+>/ matches
  // across newlines, so one unpaired `<` swallows everything up to the next `>` — measured
  // at up to 120 words in a single match on html-entity-tutorial.mdx, 145 words lost from
  // that file overall. This vertical is full of tools that manipulate angle brackets, so
  // that undercount lands hardest on exactly the pages most at risk of the deindex gate.
  const prose = text
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^(import|export)\s.*$/gm, '')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, ' ');

  // A placeholder is not a body. Requires a line-initial marker AND a following colon or
  // dash, which is the shape a stub actually takes ("TODO: write the FAQ").
  //
  // Both looser forms were tried and both were wrong. A bare \bTODO\b zeroed regex-tester's
  // tutorial for discussing "finding TODO comments". Line-initial alone still fired on
  // "**TODO lo que necesitas saber sobre JSON**" — TODO is the Spanish and Portuguese word
  // for "all", and the corpus already contains "TODOS os objetos". Deindexing a Spanish page
  // for its first word is a worse failure than missing a rare "- TODO write this", which the
  // word count catches anyway because stubs are short.
  if (/^[ \t>*#_-]*TODO\b\s*[:：—–-]/m.test(prose)) return 0;
  return prose.split(/\s+/).filter(Boolean).length;
}

export function hasLocalizedToolBody(locale: string, cluster: string, slug: string): boolean {
  const key = `${locale}/${cluster}/${slug}`;
  if (CACHEABLE) {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
  }

  const base = join(CONTENT_ROOT, locale, 'tools', cluster);
  const words =
    bodyWordCount(join(base, `${slug}-faq.mdx`)) +
    bodyWordCount(join(base, `${slug}-tutorial.mdx`));
  const ok = words >= MIN_BODY_WORDS;
  if (CACHEABLE) cache.set(key, ok);
  return ok;
}

/**
 * Does this cluster have at least one tool with a body in this locale?
 *
 * A cluster landing page is a grid of links plus ~200 words of intro. Where none of its
 * tools have a body in this locale, every link in that grid points at a page our own
 * robots tag marks noindex — so the page exists only to advertise pages we are telling
 * Google to skip. That is the same pattern, one level up, that put 150 thin tool URLs in
 * the sitemap.
 *
 * Shared deliberately: the sitemap, the page's robots tag and its hreflang set must agree.
 * They did not when the sitemap gate landed alone — the URL was dropped from the sitemap
 * while the page still declared itself indexable and the English page still hreflang-linked
 * to it. Nothing in the app links to a cluster page, so those three are the only signals.
 */
export function clusterHasBodiedTool(locale: string, cluster: string): boolean {
  return toolMetas.some(
    (m) =>
      m.cluster === cluster &&
      m.published !== false &&
      (!m.availableLocales || m.availableLocales.includes(locale as never)) &&
      hasLocalizedToolBody(locale, m.cluster, m.slug),
  );
}
