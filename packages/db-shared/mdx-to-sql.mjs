import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import matter from 'gray-matter';

const DIR = '/Users/dobby/Cassau/anytools/apps/anytools-web/content/en/blog';
const files = (await readdir(DIR)).filter(f => f.endsWith('.mdx'));

function sqlEscape(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return v.toString();
  if (v instanceof Date) return `'${v.toISOString()}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

console.log('BEGIN;');
console.log('TRUNCATE blog_products, blogs RESTART IDENTITY CASCADE;');

for (const f of files) {
  const raw = await readFile(join(DIR, f), 'utf-8');
  const { content, data } = matter(raw);
  const slug = data.slug ?? f.replace(/\.mdx$/, '');
  const sha = createHash('sha256').update(raw).digest('hex');
  const wordCount = content.trim().split(/\s+/).length;
  const readingTime = data.readingTime ?? Math.ceil(wordCount / 250);
  const fm = JSON.parse(JSON.stringify(data, (k, v) => v instanceof Date ? v.toISOString() : v));
  const keywords = JSON.stringify(data.keywords ?? []);
  const publishedAt = data.publishedAt ? new Date(data.publishedAt).toISOString() : null;
  const updatedAt = data.updatedAt ? new Date(data.updatedAt).toISOString() : null;

  console.log(`INSERT INTO blogs (slug, locale, title, description, category, keywords, frontmatter, body_mdx, word_count, reading_time, content_sha, published_at, updated_at, synced_at)`);
  console.log(`VALUES (${sqlEscape(slug)}, 'en', ${sqlEscape(data.title)}, ${sqlEscape(data.description)}, ${sqlEscape(data.category)}, ${sqlEscape(keywords)}::jsonb, ${sqlEscape(JSON.stringify(fm))}::jsonb, ${sqlEscape(content)}, ${wordCount}, ${readingTime}, ${sqlEscape(sha)}, ${publishedAt ? sqlEscape(publishedAt)+'::timestamptz' : 'NULL'}, ${updatedAt ? sqlEscape(updatedAt)+'::timestamptz' : 'NULL'}, NOW());`);
}

console.log('COMMIT;');
console.log('SELECT slug, locale, word_count FROM blogs ORDER BY published_at DESC;');
