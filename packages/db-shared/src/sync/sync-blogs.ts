/**
 * MDX -> Postgres mirror sync (multi-DB architecture).
 *
 * Each project owns its own Postgres DB. This script reads the project's MDX
 * files and mirrors them into the DB pointed at by DATABASE_URL.
 *
 * Source of truth = content/{locale}/blog/*.mdx (git-versioned, per project).
 * Postgres DB = read-only mirror for SQL queries + analytics joins.
 *
 * Usage:
 *   DATABASE_URL=postgres://...   # set per project (different DB per project)
 *   pnpm --filter @anytools/db-shared sync:blogs
 *
 * Override defaults for non-AnyTools projects:
 *   SYNC_CONTENT_ROOT=/path/to/project2/content \
 *   SYNC_LOCALES=en \
 *   pnpm --filter @anytools/db-shared sync:blogs
 *
 * Idempotent: unchanged files (same content SHA) skip re-write.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import matter from 'gray-matter';
import { isDraftMdx } from '../blog-draft-markers';
import { closeDb, getDb } from '../client';
import { type NewBlog, affiliateProducts, blogProducts, blogs } from '../schema';

const CONTENT_ROOT = resolve(
  process.cwd(),
  process.env.SYNC_CONTENT_ROOT ?? '../../apps/anytools-web/content',
);

// NOTE: when run from packages/db-shared via `pnpm sync:blogs`, cwd = that package dir,
// so the default resolves to apps/anytools-web/content. Override SYNC_CONTENT_ROOT
// for other projects (see docs/platform/add-new-project.md).
const LOCALES = (process.env.SYNC_LOCALES ?? 'en,vi,es,pt').split(',');

type BlogFrontmatter = {
  title?: string;
  slug?: string;
  description?: string;
  category?: string;
  keywords?: string[];
  updated?: string | Date;
  published?: string | Date;
  readingTime?: number;
  products?: { asin: string; label?: string; rating?: number }[];
  toolsLinked?: string[];
};

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function wordCount(mdx: string): number {
  return mdx.trim().split(/\s+/).filter(Boolean).length;
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function syncOne(
  db: ReturnType<typeof getDb>,
  locale: string,
  filePath: string,
  fileName: string,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const data = parsed.data as BlogFrontmatter;
  const body = parsed.content;

  const slug = data.slug ?? fileName.replace(/\.mdx$/, '');
  const sha = sha256(raw);

  const existing = await db
    .select()
    .from(blogs)
    .where(and(eq(blogs.slug, slug), eq(blogs.locale, locale)))
    .limit(1);

  if (existing[0]?.contentSha === sha) {
    return 'unchanged';
  }

  // Gate check: draft markers in the raw MDX → status='draft', else 'published'
  const { draft } = isDraftMdx(raw);

  const record: NewBlog = {
    slug,
    locale,
    title: data.title ?? slug,
    description: data.description ?? null,
    category: data.category ?? null,
    keywords: data.keywords ?? null,
    frontmatter: data as Record<string, unknown>,
    bodyMdx: body,
    wordCount: wordCount(body),
    readingTime: data.readingTime ?? Math.max(1, Math.ceil(wordCount(body) / 250)),
    contentSha: sha,
    status: draft ? 'draft' : 'published',
    publishedAt: readDate(data.published),
    updatedAt: readDate(data.updated) ?? new Date(),
    syncedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(blogs)
      .set({
        title: record.title,
        description: record.description,
        category: record.category,
        keywords: record.keywords,
        frontmatter: record.frontmatter,
        bodyMdx: record.bodyMdx,
        wordCount: record.wordCount,
        readingTime: record.readingTime,
        contentSha: record.contentSha,
        status: record.status,
        publishedAt: record.publishedAt,
        updatedAt: record.updatedAt,
        syncedAt: record.syncedAt,
      })
      .where(eq(blogs.id, existing[0].id));
    await linkProducts(db, existing[0].id, data.products);
    return 'updated';
  }

  const [inserted] = await db.insert(blogs).values(record).returning({ id: blogs.id });
  if (inserted) await linkProducts(db, inserted.id, data.products);
  return 'inserted';
}

async function linkProducts(
  db: ReturnType<typeof getDb>,
  blogId: number,
  products: BlogFrontmatter['products'],
): Promise<void> {
  if (!products || products.length === 0) return;

  const existing = await db
    .select({ id: affiliateProducts.id, asin: affiliateProducts.asin })
    .from(affiliateProducts);
  const byAsin = new Map(existing.map((r) => [r.asin, r.id]));

  await db.delete(blogProducts).where(eq(blogProducts.blogId, blogId));
  for (const p of products) {
    const productId = byAsin.get(p.asin);
    if (productId) {
      await db.insert(blogProducts).values({ blogId, productId }).onConflictDoNothing();
    }
  }
}

async function main(): Promise<void> {
  const db = getDb();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const locale of LOCALES) {
    const dir = join(CONTENT_ROOT, locale, 'blog');
    if (!(await dirExists(dir))) continue;

    const files = (await readdir(dir)).filter((f) => f.endsWith('.mdx'));
    for (const f of files) {
      const result = await syncOne(db, locale, join(dir, f), f);
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else unchanged++;
    }
  }

  console.log(`[sync-blogs] inserted=${inserted} updated=${updated} unchanged=${unchanged}`);
  await closeDb();
}

main().catch(async (err) => {
  console.error('[sync-blogs] FAILED', err);
  await closeDb();
  process.exit(1);
});
