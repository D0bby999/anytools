/**
 * tools/pages.server.ts
 * The guides (`content/<locale>/guides/<slug>.mdx`, ported from the old site
 * as they were) and the about, privacy, terms and contact pages
 * (`content/<locale>/pages/<page>.md`, written for the merged site: one text
 * covers the tools and the study app).
 *
 * Bundled into the server build like the tool articles (content.server.ts),
 * so a request's slug is a map key, never a path. Both are Markdown in the
 * same sense as the articles: no components, rendered with raw HTML off.
 */
import { publicLngs, type PublicLng } from "~/lib/i18n";
import { splitFrontmatter } from "./content.server";

const GUIDE_FILES = import.meta.glob<string>("/content/*/guides/*.mdx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const PAGE_FILES = import.meta.glob<string>("/content/*/pages/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The old site's order (load-guide-content.ts): the three deep guides, then one per cluster. */
export const GUIDE_SLUGS = [
  "json-complete-guide",
  "regex-mastery",
  "encoding-encyclopedia",
  "finance-calculators",
  "health-fitness-tools",
  "lifestyle-utilities",
  "design-color-tools",
] as const;

export const STATIC_PAGES = ["about", "privacy", "terms", "contact"] as const;
export type StaticPage = (typeof STATIC_PAGES)[number];

export function isStaticPage(s: string): s is StaticPage {
  return (STATIC_PAGES as readonly string[]).includes(s);
}

export type GuideSummary = {
  slug: string;
  title: string;
  description: string;
  updated: string | null;
  readingTime: number | null;
};

export type PageDoc = {
  title: string;
  description: string;
  updated: string | null;
  source: string;
};

/**
 * A guide opens with its own `# Title`, which the page already shows as its
 * h1; the copy in the body goes, so the page has one h1.
 */
function dropLeadingTitle(source: string): string {
  return source.replace(/^\s*#\s+[^\n]*\n/, "");
}

function doc(raw: string | undefined): PageDoc | null {
  if (raw === undefined) return null;
  const { source, data } = splitFrontmatter(raw);
  if (!data.title) return null;
  return {
    title: data.title,
    description: data.description ?? "",
    updated: /^\d{4}-\d{2}-\d{2}$/.test(data.updated ?? "") ? (data.updated ?? null) : null,
    source: dropLeadingTitle(source),
  };
}

export function loadGuide(locale: string, slug: string): (PageDoc & { readingTime: number | null }) | null {
  if (!(GUIDE_SLUGS as readonly string[]).includes(slug)) return null;
  const raw = GUIDE_FILES[`/content/${locale}/guides/${slug}.mdx`];
  const page = doc(raw);
  if (!page || raw === undefined) return null;
  const minutes = Number(splitFrontmatter(raw).data.readingTime);
  return { ...page, readingTime: Number.isInteger(minutes) && minutes > 0 ? minutes : null };
}

export function listGuides(locale: string): GuideSummary[] {
  return GUIDE_SLUGS.flatMap((slug) => {
    const g = loadGuide(locale, slug);
    return g ? [{ slug, title: g.title, description: g.description, updated: g.updated, readingTime: g.readingTime }] : [];
  });
}

/** The locales a guide is written in: its page's language switcher and hreflang. */
export function guideLocales(slug: string): PublicLng[] {
  return publicLngs.filter((l) => loadGuide(l, slug) !== null);
}

export function loadPage(locale: string, page: StaticPage): PageDoc | null {
  return doc(PAGE_FILES[`/content/${locale}/pages/${page}.md`]);
}

/** Every bundled guide and page file, for the test that no file is orphaned. */
export function pageFileKeys(): string[] {
  return [...Object.keys(GUIDE_FILES), ...Object.keys(PAGE_FILES)];
}
