/**
 * Framework-agnostic read helpers for published blog content.
 *
 * Both functions accept a `db` argument (from getDb()) so callers can pass
 * either a request-scoped client or the module-level singleton. They never
 * open their own connection.
 *
 * Locale fallback rule: if no published row exists for the requested locale,
 * both helpers fall back to the 'en' published row for the same slug. This
 * lets the besttoys app render a page (and include it in sitemap/RSS) even
 * when a translation is absent or still draft.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './client';
import { type Blog, blogs } from './schema';

// ---------------------------------------------------------------------------
// getPublishedBlog
// ---------------------------------------------------------------------------

/**
 * Fetch a single published blog row.
 *
 * 1. Returns the row for (slug, locale) when status='published'.
 * 2. Falls back to the 'en' published row for the same slug when the locale
 *    row is absent or draft.
 * 3. Returns null when neither the locale row nor the 'en' fallback is published.
 *
 * @param db     Drizzle client (from getDb())
 * @param slug   Blog slug (e.g. 'best-stem-kits-2026')
 * @param locale BCP-47 locale string (e.g. 'en', 'vi', 'es')
 */
export async function getPublishedBlog(db: Db, slug: string, locale: string): Promise<Blog | null> {
  // Try the exact locale first
  const [exact] = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.slug, slug), eq(blogs.locale, locale), eq(blogs.status, 'published')))
    .limit(1);

  if (exact) return exact;

  // locale row missing or draft → try 'en' fallback
  if (locale === 'en') return null;

  const [fallback] = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.slug, slug), eq(blogs.locale, 'en'), eq(blogs.status, 'published')))
    .limit(1);

  return fallback ?? null;
}

// ---------------------------------------------------------------------------
// listPublishedBlogs
// ---------------------------------------------------------------------------

/**
 * List all published blogs for a locale, ordered by publishedAt desc.
 *
 * For each slug that has no published row in `locale`, the 'en' published row
 * is included as fallback so the index/sitemap/RSS is never empty due to
 * missing translations.
 *
 * Implementation: fetch published rows for the requested locale + all 'en'
 * published rows in one query, then merge — locale row wins when both exist.
 *
 * @param db     Drizzle client (from getDb())
 * @param locale BCP-47 locale string (e.g. 'en', 'vi', 'es')
 */
export async function listPublishedBlogs(db: Db, locale: string): Promise<Blog[]> {
  if (locale === 'en') {
    // Simple path: only fetch en published rows
    return db
      .select()
      .from(blogs)
      .where(and(eq(blogs.locale, 'en'), eq(blogs.status, 'published')))
      .orderBy(desc(blogs.publishedAt));
  }

  // Fetch the requested locale's published rows
  const localeRows = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.locale, locale), eq(blogs.status, 'published')))
    .orderBy(desc(blogs.publishedAt));

  // Fetch 'en' published rows to fill gaps
  const enRows = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.locale, 'en'), eq(blogs.status, 'published')))
    .orderBy(desc(blogs.publishedAt));

  // Merge: locale row wins; en fills slugs with no locale translation
  const covered = new Set(localeRows.map((r) => r.slug));
  const fallbacks = enRows.filter((r) => !covered.has(r.slug));

  const merged = [...localeRows, ...fallbacks];
  // Re-sort combined list by publishedAt desc (nulls last)
  merged.sort((a, b) => {
    const ta = a.publishedAt?.getTime() ?? 0;
    const tb = b.publishedAt?.getTime() ?? 0;
    return tb - ta;
  });

  return merged;
}
