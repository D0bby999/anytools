/**
 * Blog content loader — DB-backed.
 *
 * All reads go to the DB via @anytools/db-shared helpers. MDX files in git
 * remain the authoring source but are no longer read at render time. Content
 * goes live the instant a row is published — no image rebuild needed.
 *
 * Build safety: listBlogs() and listPublishedBlogRows() catch any DB error
 * (DATABASE_URL absent at build time, network failure) and return [] so the
 * build succeeds unconditionally. force-dynamic pages never run DB calls at
 * build time, so the try/catch guard is for generateStaticParams / RSS callers.
 *
 * AnyTools is English-only (no locale fallback needed — en rows only).
 */

import { getPublishedBlog, listPublishedBlogs } from '@anytools/db-shared';
import type { Blog } from '@anytools/db-shared';
import { getDb } from '@anytools/db-shared/client';

// ---------------------------------------------------------------------------
// Type exports — preserved exactly so all existing callers compile unchanged
// ---------------------------------------------------------------------------

export type BlogCategory = 'lifestyle' | 'design' | 'health' | 'finance';

export type UnsplashCredit = {
  photographer: string;
  photographer_url: string;
  unsplash_url: string;
};

export type BlogHeroImage = {
  url: string;
  alt: string;
  credit: UnsplashCredit;
};

export type BlogAuthor = {
  name: string;
  credentials?: string;
  bio?: string;
  url?: string;
  avatarUrl?: string;
};

export type BlogDisclosureType = 'affiliate' | 'amazon' | 'ymyl' | 'both';

export type BlogHowToStep = { name: string; text: string };

export type BlogFaqItem = { q: string; a: string };

export type BlogFrontmatter = {
  title: string;
  slug?: string;
  description?: string;
  category?: BlogCategory;
  keywords?: string[];
  heroImage?: BlogHeroImage;
  publishedAt?: string;
  updatedAt?: string;
  toolsLinked?: string[];
  readingTime?: number;
  author?: BlogAuthor;
  disclosureType?: BlogDisclosureType;
  howTo?: { name: string; steps: BlogHowToStep[] };
  faq?: BlogFaqItem[];
};

// AnyTools has no isFallback field (en-only, no locale fallback layer needed).
export type BlogContent = {
  source: string;
  data: BlogFrontmatter;
};

// ---------------------------------------------------------------------------
// Row → BlogContent mapping
// ---------------------------------------------------------------------------

/**
 * Maps a DB Blog row to the BlogContent shape expected by page components.
 * `frontmatter` jsonb column stores the same keys as the old MDX front matter.
 * Top-level DB columns (title, description, etc.) take precedence over jsonb
 * duplicates so the canonical indexed fields are always used.
 */
function rowToBlogContent(row: Blog, requestedLocale: string): BlogContent {
  const fm = (row.frontmatter ?? {}) as Record<string, unknown>;

  // Normalise date values to ISO-date strings (YYYY-MM-DD) safe for JSX rendering.
  const toIsoDate = (v: unknown): string | undefined => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && v.length > 0) return v;
    return undefined;
  };

  const data: BlogFrontmatter = {
    ...(fm as Partial<BlogFrontmatter>),
    title: row.title,
    description: row.description ?? (fm.description as string | undefined),
    category:
      (row.category as BlogCategory | undefined) ?? (fm.category as BlogCategory | undefined),
    keywords: row.keywords ?? (fm.keywords as string[] | undefined),
    publishedAt: toIsoDate(row.publishedAt) ?? toIsoDate(fm.publishedAt),
    updatedAt: toIsoDate(row.updatedAt) ?? toIsoDate(fm.updatedAt),
    readingTime: row.readingTime ?? (fm.readingTime as number | undefined),
  };

  // Suppress unused-variable warning — requestedLocale kept in signature for
  // consistency with besttoys's loader (isFallback logic lives there, not here).
  void requestedLocale;

  return { source: row.bodyMdx, data };
}

// ---------------------------------------------------------------------------
// loadBlog — used by [slug]/page.tsx
// NOTE: anytools arg order is (locale, slug) — do NOT flip to (slug, locale).
// ---------------------------------------------------------------------------

/**
 * Load a single published blog post for the given locale from the DB.
 * Returns null when no published row exists for that slug+locale.
 */
export async function loadBlog(locale: string, slug: string): Promise<BlogContent | null> {
  const db = getDb();
  const row = await getPublishedBlog(db, slug, locale);
  if (!row) return null;
  return rowToBlogContent(row, locale);
}

// ---------------------------------------------------------------------------
// listBlogs — used by blog index page
// ---------------------------------------------------------------------------

/**
 * List all published blogs for the given locale, ordered by publishedAt desc.
 * Returns [] when the DB is unreachable (build-safe).
 */
export async function listBlogs(
  locale: string,
): Promise<{ slug: string; data: BlogFrontmatter }[]> {
  try {
    const db = getDb();
    const rows = await listPublishedBlogs(db, locale);
    return rows.map((row) => ({
      slug: row.slug,
      data: rowToBlogContent(row, locale).data,
    }));
  } catch {
    // DB unreachable at build time or network error — degrade gracefully.
    return [];
  }
}

// ---------------------------------------------------------------------------
// listPublishedBlogRows — used by sitemap
// ---------------------------------------------------------------------------

/**
 * List raw published blog rows for a locale (slug + dates).
 * Used by sitemap.ts to emit blog URLs without loading full MDX bodies.
 * Build-safe: returns [] on any DB error.
 */
export async function listPublishedBlogRows(locale = 'en'): Promise<
  Array<{
    slug: string;
    locale: string;
    title: string;
    description: string | null;
    publishedAt: Date | null;
    updatedAt: Date | null;
  }>
> {
  try {
    const db = getDb();
    const rows = await listPublishedBlogs(db, locale);
    return rows.map((r) => ({
      slug: r.slug,
      locale: r.locale,
      title: r.title,
      description: r.description,
      publishedAt: r.publishedAt,
      updatedAt: r.updatedAt,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// BLOG_SLUGS is kept as an empty array so any stray import still compiles.
// Pages must NOT use it for generateStaticParams — use listBlogs() instead.
export const BLOG_SLUGS: string[] = [];

export const BLOG_CATEGORIES: BlogCategory[] = ['lifestyle', 'design', 'health', 'finance'];
