import { BlogCard } from '@/components/blog-card';
import { listBlogs } from '@/lib/load-blog-content';

/**
 * Auto "Keep reading" block at the foot of every blog post. Adds up to 6 internal
 * links per page (same-category first, then most-recent others) so Google has dense
 * crawl paths to discover + prioritise indexing un-orphaned posts, and readers have
 * somewhere to go. Server component reading the same published rows the index uses —
 * no MDX edit, no re-translation. Renders nothing when there are too few siblings.
 */
const HEADING: Record<string, string> = {
  en: 'Keep reading',
  vi: 'Đọc tiếp',
  es: 'Sigue leyendo',
  pt: 'Continue lendo',
};

export async function BlogRelatedPosts({
  locale,
  currentSlug,
  category,
}: {
  locale: string;
  currentSlug: string;
  category?: string;
}) {
  const others = (await listBlogs(locale)).filter((b) => b.slug !== currentSlug);
  if (others.length < 2) return null;

  // Same category first (strongest topical relevance), then fill with the most
  // recent of the rest. listBlogs is already ordered publishedAt desc.
  const key = category ?? '';
  const sameCat = others.filter((b) => (b.data.category ?? '') === key);
  const rest = others.filter((b) => (b.data.category ?? '') !== key);
  const picks = [...sameCat, ...rest].slice(0, 6);

  return (
    <section aria-label="Related posts" className="border-t border-border pt-8 mt-4">
      <h2 className="text-2xl font-bold mb-6">{HEADING[locale] ?? HEADING.en}</h2>
      <div className="grid gap-6 sm:grid-cols-2">
        {picks.map((b) => (
          <BlogCard key={b.slug} slug={b.slug} data={b.data} />
        ))}
      </div>
    </section>
  );
}
