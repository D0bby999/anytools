import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

const CONTENT_ROOT = process.env.CONTENT_ROOT ?? join(process.cwd(), 'content');

export type FAQItem = { q: string; a: string };

export type ToolContent = {
  tutorial?: { source: string; data: Record<string, unknown> };
  faq?: { items: FAQItem[]; source: string };
};

async function readMdx(
  path: string,
): Promise<{ source: string; data: Record<string, unknown> } | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const { content, data } = matter(raw);
    return { source: content, data };
  } catch {
    return null;
  }
}

/**
 * Load tutorial + FAQ for a tool from content/{locale}/tools/{cluster}/{slug}-{tutorial,faq}.mdx.
 * Returns empty fields if files don't exist (graceful — tool can ship without content first, add later).
 */
export async function loadToolContent(
  locale: string,
  cluster: string,
  slug: string,
): Promise<ToolContent> {
  const base = join(CONTENT_ROOT, locale, 'tools', cluster);
  const [tutorial, faqMdx] = await Promise.all([
    readMdx(join(base, `${slug}-tutorial.mdx`)),
    readMdx(join(base, `${slug}-faq.mdx`)),
  ]);

  const items = faqMdx ? parseFaq(faqMdx.source) : [];

  return {
    tutorial: tutorial ?? undefined,
    faq: faqMdx ? { items, source: faqMdx.source } : undefined,
  };
}

/**
 * Parse simple Q/A markdown into structured items for schema markup.
 * Format expected:
 *   ## Question?
 *   Answer paragraph.
 *
 *   ## Next question?
 *   Answer.
 */
function parseFaq(source: string): FAQItem[] {
  const items: FAQItem[] = [];
  const sections = source.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const lines = section.trimEnd().split('\n');
    const q = lines[0]?.trim();
    const a = lines.slice(1).join('\n').trim();
    if (q && a) items.push({ q, a });
  }
  return items;
}
