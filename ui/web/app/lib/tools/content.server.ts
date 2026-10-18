/**
 * tools/content.server.ts
 * A tool's article (`<slug>-tutorial.mdx`) and FAQ (`<slug>-faq.mdx`), from
 * ui/web/content/<locale>/tools/<cluster>/, the old site's layout kept as is.
 *
 * The files are bundled into the server build rather than read from disk, so
 * the image needs no content directory and a lookup is a map read: nothing a
 * request names ever becomes a path. They are MDX in name only: the corpus
 * uses no components, so they are rendered as Markdown with raw HTML off
 * (components/tools-site/article.tsx).
 */
import { toolMetas } from "~/tools/meta-registry";
import type { ToolMeta } from "~/tools/types";
import { isPorted } from "~/tools/ui-registry";
import type { PublicLng } from "~/lib/i18n";
import { publicLngs } from "~/lib/i18n";

const FILES = import.meta.glob<string>("/content/*/tools/*/*.mdx", {
  query: "?raw",
  import: "default",
  eager: true,
});

export type FaqItem = { q: string; a: string };
export type Article = { source: string; data: Record<string, string> };
export type ToolContent = { tutorial: Article | null; faq: { items: FaqItem[]; source: string } | null };

function file(locale: string, cluster: string, slug: string, kind: "tutorial" | "faq"): string | undefined {
  return FILES[`/content/${locale}/tools/${cluster}/${slug}-${kind}.mdx`];
}

/** `---\nkey: value\n---\n` frontmatter; the corpus holds only flat string keys. */
export function splitFrontmatter(raw: string): Article {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { source: raw, data: {} };
  const data: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv?.[1]) continue;
    data[kv[1]] = (kv[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { source: raw.slice(m[0].length), data };
}

/**
 * Q/A Markdown into items for the FAQPage JSON-LD:
 *   ## Question?
 *   Answer paragraph.
 */
export function parseFaq(source: string): FaqItem[] {
  const items: FaqItem[] = [];
  for (const section of source.split(/^##\s+/m).slice(1)) {
    const lines = section.trimEnd().split("\n");
    const q = lines[0]?.trim();
    const a = lines.slice(1).join("\n").trim();
    if (q && a) items.push({ q, a });
  }
  return items;
}

export function loadToolContent(locale: string, cluster: string, slug: string): ToolContent {
  const tutorialRaw = file(locale, cluster, slug, "tutorial");
  const faqRaw = file(locale, cluster, slug, "faq");
  const faq = faqRaw === undefined ? null : splitFrontmatter(faqRaw);
  return {
    tutorial: tutorialRaw === undefined ? null : splitFrontmatter(tutorialRaw),
    faq: faq ? { items: parseFaq(faq.source), source: faq.source } : null,
  };
}

/**
 * Floor for "this page says something", from the old site
 * (apps/anytools-web/src/lib/has-localized-tool-body.ts, measured 2026-09-02):
 * a tool page whose locale has no translated article is served, but marked
 * noindex and left out of the sitemap and hreflang, because 150 such pages of
 * widget labels were what got the old site turned down for thin content.
 * The minimum real body in the corpus was 324 words; 300 deindexes nothing
 * that has prose. It is a tripwire for empty and placeholder files.
 */
export const MIN_BODY_WORDS = 300;

export function bodyWordCount(text: string | undefined): number {
  if (text === undefined) return 0;
  // Frontmatter, import/export lines and tag-shaped spans go; the tag pattern
  // is single-line so one stray `<` in a tool about angle brackets cannot
  // swallow the paragraphs after it.
  const prose = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^(import|export)\s.*$/gm, "")
    .replace(/<\/?[A-Za-z][^>\n]*>/g, " ");
  // A stub is "TODO: …" at the start of a line, not the Spanish word "TODO".
  if (/^[ \t>*#_-]*TODO\b\s*[:：—–-]/m.test(prose)) return 0;
  return prose.split(/\s+/).filter(Boolean).length;
}

const bodyCache = new Map<string, boolean>();

/** Does this tool have a written article or FAQ in this locale? */
export function hasLocalizedToolBody(locale: string, cluster: string, slug: string): boolean {
  const key = `${locale}/${cluster}/${slug}`;
  const hit = bodyCache.get(key);
  if (hit !== undefined) return hit;
  const words =
    bodyWordCount(file(locale, cluster, slug, "faq")) + bodyWordCount(file(locale, cluster, slug, "tutorial"));
  const ok = words >= MIN_BODY_WORDS;
  bodyCache.set(key, ok);
  return ok;
}

/** The locales a tool is offered in (most: all four; a few are English only). */
export function toolLocales(meta: { availableLocales?: readonly string[] }): PublicLng[] {
  return publicLngs.filter((l) => !meta.availableLocales || meta.availableLocales.includes(l));
}

/**
 * May a crawler be told about this tool page in this locale? Published,
 * offered in the locale, with a working UI here (a "coming back soon" page is
 * not one), and with a body. The sitemap, the page's robots meta and every
 * hreflang set ask this one question, so the three cannot disagree.
 */
export function isIndexableTool(meta: ToolMeta, locale: string): boolean {
  return (
    meta.published !== false &&
    (toolLocales(meta) as string[]).includes(locale) &&
    isPorted(meta.slug) &&
    hasLocalizedToolBody(locale, meta.cluster, meta.slug)
  );
}

/**
 * A cluster page is a grid of links; where none of its tools is indexable in
 * this locale, every link points at a noindex page, so the cluster page is
 * noindex too.
 */
export function clusterIsIndexable(locale: string, cluster: string): boolean {
  return toolMetas.some((m) => m.cluster === cluster && isIndexableTool(m, locale));
}

/** Every content file, for the registry test's per-locale article report. */
export function contentFileKeys(): string[] {
  return Object.keys(FILES);
}
