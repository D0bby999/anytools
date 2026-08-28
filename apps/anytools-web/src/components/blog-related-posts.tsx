import { BlogCard } from '@/components/blog-card';
import { listBlogs } from '@/lib/load-blog-content';
import { pickRelatedPosts } from '@anytools/postclaw-blog-endpoint';

/**
 * Auto "Keep reading" block at the foot of every blog post. Adds up to 6 internal links per
 * page so Google has dense crawl paths, and readers have somewhere to go. Server component
 * reading the same published rows the index uses — no MDX edit, no re-translation. Renders
 * nothing when there are too few siblings.
 *
 * WHICH siblings is the whole game and lives in pickRelatedPosts. Picking the newest few made
 * every page vote for the same handful: measured 2026-08-28, 3 of anytools' 20 posts had no
 * inbound internal link at all, and on besttoys the same shape left 25 of 58 stranded with
 * Google indexing 8 of 55.
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
  // listBlogs is ordered publishedAt desc; pickRelatedPosts keeps that ordering inside each
  // window and only decides where the window starts.
  const all = await listBlogs(locale);
  if (all.length < 3) return null;

  const picks = pickRelatedPosts({
    all: all.map((b) => ({ slug: b.slug, category: b.data.category ?? '', post: b })),
    currentSlug,
    category: category ?? '',
  }).map((p) => p.post);

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
