import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

// Resolve relative to this script (packages/db-shared/mdx-to-sql.mjs).
//
// Two ways to point this at content:
//   1. Single en-only dir  — CONTENT_DIR=/abs/path/to/content/en/blog
//      (legacy single-locale mode; the locale is hardcoded 'en' below)
//   2. Multi-locale root    — SYNC_CONTENT_ROOT=/abs/path/to/content
//                             SYNC_LOCALES=en,vi,es,...   (defaults to en)
//      Iterates <root>/<locale>/blog/*.mdx and stamps each row's locale.
//
// When SYNC_CONTENT_ROOT is set it wins; otherwise CONTENT_DIR (or the
// anytools default) is treated as a single en directory. This keeps the
// existing anytools en-only sync working untouched.
const HERE = dirname(fileURLToPath(import.meta.url));

const SYNC_CONTENT_ROOT = process.env.SYNC_CONTENT_ROOT;
const SYNC_LOCALES = (process.env.SYNC_LOCALES ?? 'en')
  .split(',')
  .map((l) => l.trim())
  .filter(Boolean);

// Build the list of { dir, locale } sources to read.
async function resolveSources() {
  if (SYNC_CONTENT_ROOT) {
    const root = resolve(SYNC_CONTENT_ROOT);
    return SYNC_LOCALES.map((locale) => ({
      dir: resolve(root, locale, 'blog'),
      locale,
    }));
  }
  // Legacy single-dir mode: CONTENT_DIR or the anytools en default, locale = en.
  const dir = process.env.CONTENT_DIR ?? resolve(HERE, '../../apps/anytools-web/content/en/blog');
  return [{ dir, locale: 'en' }];
}

async function listMdx(dir) {
  try {
    // Skip `_`-prefixed files (templates/partials like _template-review.mdx) — they
    // are not blog posts. Matches the filesystem sync (src/sync/sync-blogs.ts).
    return (await readdir(dir)).filter((f) => f.endsWith('.mdx') && !f.startsWith('_'));
  } catch {
    // A locale dir may not exist yet (e.g. translations not generated). Skip.
    return [];
  }
}

function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const sources = await resolveSources();

// Gate-driven status (mirrors src/blog-draft-markers.ts): a post with unfinished
// affiliate markers stays a draft (not rendered live) until a human finishes it.
// Kept inline because this file runs via plain `node` in CI (no TS loader).
function isDraftMdx(raw) {
  return /TODO \(hands-on\)/i.test(raw) || /#\s*verify\b/i.test(raw) || /\bTODO:/i.test(raw);
}

console.log('BEGIN;');
// Rebuild only MDX-mirrored rows. Rows with external_id set are authored via
// the PostClaw custom_blog endpoints and exist ONLY in the DB — deleting them
// would destroy live posts, and a TRUNCATE ... RESTART IDENTITY would also
// re-issue serial ids out from under them. blog_products rows cascade via FK.
console.log('DELETE FROM blogs WHERE external_id IS NULL;');

for (const { dir, locale } of sources) {
  const files = await listMdx(dir);
  for (const f of files) {
    const raw = await readFile(join(dir, f), 'utf-8');
    const { content, data } = matter(raw);
    const slug = data.slug ?? f.replace(/\.mdx$/, '');
    const sha = createHash('sha256').update(raw).digest('hex');
    const wordCount = content.trim().split(/\s+/).length;
    const readingTime = data.readingTime ?? Math.ceil(wordCount / 250);
    const fm = JSON.parse(
      JSON.stringify(data, (k, v) => (v instanceof Date ? v.toISOString() : v)),
    );
    const keywords = JSON.stringify(data.keywords ?? []);
    const publishedAt = data.publishedAt ? new Date(data.publishedAt).toISOString() : null;
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).toISOString() : null;
    const status = isDraftMdx(raw) ? 'draft' : 'published';

    console.log(
      'INSERT INTO blogs (slug, locale, title, description, category, keywords, frontmatter, body_mdx, word_count, reading_time, content_sha, published_at, updated_at, synced_at, status)',
    );
    // ON CONFLICT: after the scoped DELETE above, the only possible (slug, locale)
    // conflict is a surviving PostClaw-authored row — keep it, skip the MDX insert
    // (the TS sync path logs the same collision loudly for a human to resolve).
    console.log(
      `VALUES (${sqlEscape(slug)}, ${sqlEscape(locale)}, ${sqlEscape(data.title)}, ${sqlEscape(data.description)}, ${sqlEscape(data.category)}, ${sqlEscape(keywords)}::jsonb, ${sqlEscape(JSON.stringify(fm))}::jsonb, ${sqlEscape(content)}, ${wordCount}, ${readingTime}, ${sqlEscape(sha)}, ${publishedAt ? `${sqlEscape(publishedAt)}::timestamptz` : 'NULL'}, ${updatedAt ? `${sqlEscape(updatedAt)}::timestamptz` : 'NULL'}, NOW(), ${sqlEscape(status)}) ON CONFLICT (slug, locale) DO NOTHING;`,
    );
  }
}

console.log('COMMIT;');
console.log('SELECT slug, locale, word_count FROM blogs ORDER BY published_at DESC;');
