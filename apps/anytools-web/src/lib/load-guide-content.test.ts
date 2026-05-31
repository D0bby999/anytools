import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE_ROOT = join(tmpdir(), `anytools-guide-test-${Date.now()}`);
process.env.CONTENT_ROOT = FIXTURE_ROOT;

const { GUIDE_SLUGS, listGuides, loadGuide } = await import('./load-guide-content');

const GUIDES = {
  'json-complete-guide.mdx': `---
title: "JSON Complete Guide"
description: "Complete JSON walkthrough"
keywords: [json, javascript]
updated: 2026-01-15
readingTime: 12
---

## Body

JSON content here.`,
  'regex-mastery.mdx': `---
title: "Regex Mastery"
description: "Regular expression deep dive"
updated: 2026-02-01
---

## Body

Regex content.`,
};

beforeAll(async () => {
  await mkdir(join(FIXTURE_ROOT, 'en', 'guides'), { recursive: true });
  for (const [filename, content] of Object.entries(GUIDES)) {
    await writeFile(join(FIXTURE_ROOT, 'en', 'guides', filename), content, 'utf-8');
  }
});

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('GUIDE_SLUGS', () => {
  it('contains expected pillar + dev guides', () => {
    expect(GUIDE_SLUGS).toContain('json-complete-guide');
    expect(GUIDE_SLUGS).toContain('regex-mastery');
    expect(GUIDE_SLUGS).toContain('encoding-encyclopedia');
  });

  it('has no duplicates', () => {
    expect(new Set(GUIDE_SLUGS).size).toBe(GUIDE_SLUGS.length);
  });

  it('all slugs are kebab-case', () => {
    for (const slug of GUIDE_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('loadGuide', () => {
  it('returns source + parsed frontmatter for an existing guide', async () => {
    const out = await loadGuide('en', 'json-complete-guide');
    expect(out).not.toBeNull();
    expect(out?.data.title).toBe('JSON Complete Guide');
    expect(out?.data.keywords).toEqual(['json', 'javascript']);
    expect(out?.data.readingTime).toBe(12);
    expect(out?.source).toContain('JSON content here.');
  });

  it('returns null for missing slug', async () => {
    const out = await loadGuide('en', 'does-not-exist');
    expect(out).toBeNull();
  });

  it('normalizes Date frontmatter to ISO yyyy-mm-dd string', async () => {
    const out = await loadGuide('en', 'json-complete-guide');
    expect(typeof out?.data.updated).toBe('string');
    expect(out?.data.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('listGuides', () => {
  it('returns all guides in a locale', async () => {
    const list = await listGuides('en');
    const slugs = list.map((g) => g.slug);
    expect(slugs).toContain('json-complete-guide');
    expect(slugs).toContain('regex-mastery');
  });

  it('returns empty array for locale without guides dir', async () => {
    const list = await listGuides('vi');
    expect(list).toEqual([]);
  });
});
