import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

export type GuideFrontmatter = {
  title: string;
  description?: string;
  keywords?: string[];
  updated?: string;
  readingTime?: number;
};

export type GuideContent = {
  source: string;
  data: GuideFrontmatter;
};

export async function loadGuide(locale: string, slug: string): Promise<GuideContent | null> {
  const path = join(CONTENT_ROOT, locale, 'guides', `${slug}.mdx`);
  try {
    const raw = await readFile(path, 'utf-8');
    const { content, data } = matter(raw);
    return { source: content, data: normalizeFrontmatter(data) };
  } catch {
    return null;
  }
}

// gray-matter parses ISO date frontmatter as a Date object; normalize to ISO
// string so it can be safely rendered in JSX and serialized to client.
function normalizeFrontmatter(data: Record<string, unknown>): GuideFrontmatter {
  const updated = data.updated;
  return {
    ...data,
    updated:
      updated instanceof Date
        ? updated.toISOString().slice(0, 10)
        : typeof updated === 'string'
          ? updated
          : undefined,
  } as GuideFrontmatter;
}

export async function listGuides(
  locale: string,
): Promise<{ slug: string; data: GuideFrontmatter }[]> {
  const dir = join(CONTENT_ROOT, locale, 'guides');
  try {
    const files = await readdir(dir);
    const guides = await Promise.all(
      files
        .filter((f) => f.endsWith('.mdx'))
        .map(async (f) => {
          const slug = f.replace(/\.mdx$/, '');
          const guide = await loadGuide(locale, slug);
          return guide ? { slug, data: guide.data } : null;
        }),
    );
    return guides.filter((g): g is NonNullable<typeof g> => Boolean(g));
  } catch {
    return [];
  }
}

export const GUIDE_SLUGS = [
  'json-complete-guide',
  'regex-mastery',
  'encoding-encyclopedia',
  // Phase 4 pillar guides (one per general-public cluster)
  'finance-calculators',
  'health-fitness-tools',
  'lifestyle-utilities',
  'design-color-tools',
];
