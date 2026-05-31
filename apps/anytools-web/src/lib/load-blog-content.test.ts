import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Override CONTENT_ROOT BEFORE module import so loadBlog uses our fixture dir.
const FIXTURE_ROOT = join(tmpdir(), `anytools-blog-test-${Date.now()}`);
process.env.CONTENT_ROOT = FIXTURE_ROOT;

// Dynamic import after env set
const { BLOG_CATEGORIES, BLOG_SLUGS, listBlogs, loadBlog } = await import('./load-blog-content');

const POSTS = {
  'lifestyle-tip.mdx': `---
title: "Tip splitting"
slug: lifestyle-tip
description: "Lifestyle desc"
category: lifestyle
publishedAt: 2026-05-31
updatedAt: 2026-05-31
keywords: [tip, split]
readingTime: 5
---

## Body

Hello.`,
  'design-wcag.mdx': `---
title: "WCAG contrast"
slug: design-wcag
description: "Design desc"
category: design
publishedAt: 2026-05-30
updatedAt: 2026-05-30
---

## Body

There.`,
  '_draft.mdx': `---
title: "Draft (should be hidden)"
slug: _draft
description: "x"
category: lifestyle
---

draft body`,
};

beforeAll(async () => {
  await mkdir(join(FIXTURE_ROOT, 'en', 'blog'), { recursive: true });
  for (const [filename, content] of Object.entries(POSTS)) {
    await writeFile(join(FIXTURE_ROOT, 'en', 'blog', filename), content, 'utf-8');
  }
});

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('BLOG_CATEGORIES', () => {
  it('matches the cluster set used in routes + sitemap', () => {
    expect(BLOG_CATEGORIES).toEqual(['lifestyle', 'design', 'health', 'finance']);
  });
});

describe('BLOG_SLUGS', () => {
  it('contains shipped slugs (manually maintained — used by generateStaticParams)', () => {
    // Smoke-check: array of strings, no duplicates, kebab-case-ish
    expect(Array.isArray(BLOG_SLUGS)).toBe(true);
    expect(new Set(BLOG_SLUGS).size).toBe(BLOG_SLUGS.length);
    for (const slug of BLOG_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('loadBlog', () => {
  it('returns source + parsed frontmatter for an existing post', async () => {
    const out = await loadBlog('en', 'lifestyle-tip');
    expect(out).not.toBeNull();
    expect(out?.data.title).toBe('Tip splitting');
    expect(out?.data.category).toBe('lifestyle');
    expect(out?.data.publishedAt).toBe('2026-05-31');
    expect(out?.data.keywords).toEqual(['tip', 'split']);
    expect(out?.source).toContain('Hello.');
  });

  it('returns null for missing slug (no crash)', async () => {
    const out = await loadBlog('en', 'does-not-exist');
    expect(out).toBeNull();
  });

  it('returns null when locale folder is absent', async () => {
    const out = await loadBlog('vi', 'lifestyle-tip');
    expect(out).toBeNull();
  });

  it('normalizes Date frontmatter to ISO yyyy-mm-dd string', async () => {
    const out = await loadBlog('en', 'design-wcag');
    expect(typeof out?.data.publishedAt).toBe('string');
    expect(out?.data.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('listBlogs', () => {
  it('lists only public posts (filters _-prefixed drafts)', async () => {
    const list = await listBlogs('en');
    const slugs = list.map((b) => b.slug);
    expect(slugs).toContain('lifestyle-tip');
    expect(slugs).toContain('design-wcag');
    expect(slugs).not.toContain('_draft');
  });

  it('sorts by publishedAt descending (most recent first)', async () => {
    const list = await listBlogs('en');
    expect(list[0]?.slug).toBe('lifestyle-tip'); // 2026-05-31
    expect(list[1]?.slug).toBe('design-wcag'); // 2026-05-30
  });

  it('returns empty array for locale without blog dir', async () => {
    const list = await listBlogs('vi');
    expect(list).toEqual([]);
  });
});
