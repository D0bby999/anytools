import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

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

export type BlogContent = {
  source: string;
  data: BlogFrontmatter;
};

export async function loadBlog(locale: string, slug: string): Promise<BlogContent | null> {
  const path = join(CONTENT_ROOT, locale, 'blog', `${slug}.mdx`);
  try {
    const raw = await readFile(path, 'utf-8');
    const { content, data } = matter(raw);
    return { source: content, data: normalizeFrontmatter(data) };
  } catch {
    return null;
  }
}

// gray-matter parses ISO date frontmatter as Date objects; normalize both
// publishedAt and updatedAt to ISO strings for safe JSX rendering.
function normalizeFrontmatter(data: Record<string, unknown>): BlogFrontmatter {
  const toIsoDate = (v: unknown): string | undefined => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && v.length > 0) return v;
    return undefined;
  };
  return {
    ...data,
    publishedAt: toIsoDate(data.publishedAt),
    updatedAt: toIsoDate(data.updatedAt),
  } as BlogFrontmatter;
}

export async function listBlogs(
  locale: string,
): Promise<{ slug: string; data: BlogFrontmatter }[]> {
  const dir = join(CONTENT_ROOT, locale, 'blog');
  try {
    const files = await readdir(dir);
    const blogs = await Promise.all(
      files
        .filter((f) => f.endsWith('.mdx') && !f.startsWith('_'))
        .map(async (f) => {
          const slug = f.replace(/\.mdx$/, '');
          const blog = await loadBlog(locale, slug);
          return blog ? { slug, data: blog.data } : null;
        }),
    );
    // Sort by publishedAt desc (most recent first)
    return blogs
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .sort((a, b) => (b.data.publishedAt ?? '').localeCompare(a.data.publishedAt ?? ''));
  } catch {
    return [];
  }
}

// Populated as blogs ship. Mirror pattern of GUIDE_SLUGS for sitemap generation.
export const BLOG_SLUGS: string[] = [
  'tip-splitting-apps-vs-free-tools',
  'wcag-contrast-for-saas-dashboards',
  'smart-scales-bmi-tracking-2026',
  'best-mortgage-calculators-2026',
];

export const BLOG_CATEGORIES: BlogCategory[] = ['lifestyle', 'design', 'health', 'finance'];
