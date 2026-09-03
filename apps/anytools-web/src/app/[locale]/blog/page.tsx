import { BlogCard } from '@/components/blog-card';
import { routing } from '@/i18n/routing';
import { BLOG_CATEGORIES, listBlogs } from '@/lib/load-blog-content';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { METADATA_BASE } from '@/lib/site-url';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

// Rendered per-request so newly published posts appear without a rebuild.
export const dynamic = 'force-dynamic';

type PageParams = { locale: string };
type SearchParams = { category?: string };

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale } = await params;
  const titleByLocale: Record<string, string> = {
    en: 'Blog — AnyTools',
    vi: 'Blog — AnyTools',
    es: 'Blog — AnyTools',
    pt: 'Blog — AnyTools',
  };
  const descByLocale: Record<string, string> = {
    en: 'Practical guides, tool roundups, and how-tos across finance, health, lifestyle and design.',
    vi: 'Hướng dẫn thực tế, tổng hợp công cụ và mẹo cho tài chính, sức khỏe, đời sống và thiết kế.',
    es: 'Guías prácticas, recopilaciones de herramientas y tutoriales para finanzas, salud, estilo y diseño.',
    pt: 'Guias práticos, listas de ferramentas e tutoriais para finanças, saúde, estilo e design.',
  };
  return {
    metadataBase: METADATA_BASE,
    title: titleByLocale[locale] ?? titleByLocale.en,
    description: descByLocale[locale] ?? descByLocale.en,
    alternates: {
      canonical: `/${locale}/blog`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/blog`])),
    },
  };
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  // The blog is DB-backed (listPublishedBlogRows/listBlogs) and self-host builds ship
  // with no DATABASE_URL: without this gate the page would render empty rather than
  // signal it doesn't exist. generateMetadata above touches no data, so it is left
  // ungated — the component 404 alone is sufficient.
  if (IS_SELF_HOSTED) notFound();
  const { locale } = await params;
  const { category } = await searchParams;

  const all = await listBlogs(locale);
  const filtered = category ? all.filter((b) => b.data.category === category) : all;

  const headings: Record<string, string> = {
    en: 'Blog',
    vi: 'Blog',
    es: 'Blog',
    pt: 'Blog',
  };
  const allLabel: Record<string, string> = { en: 'All', vi: 'Tất cả', es: 'Todos', pt: 'Todos' };
  const emptyLabel: Record<string, string> = {
    en: 'No posts yet. Check back soon.',
    vi: 'Chưa có bài viết. Quay lại sau nhé.',
    es: 'Aún no hay publicaciones.',
    pt: 'Ainda não há posts.',
  };

  return (
    <main className="container mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-4xl font-bold mb-2">{headings[locale] ?? headings.en}</h1>

      <div className="flex flex-wrap gap-2 mb-8">
        <Link
          href={`/${locale}/blog`}
          className={`px-3 py-1 rounded-full text-sm border transition-colors ${
            !category
              ? 'bg-accent text-accent-foreground border-accent'
              : 'border-border hover:border-accent'
          }`}
        >
          {allLabel[locale] ?? allLabel.en}
        </Link>
        {BLOG_CATEGORIES.map((cat) => (
          <Link
            key={cat}
            href={`/${locale}/blog?category=${cat}`}
            className={`px-3 py-1 rounded-full text-sm border transition-colors capitalize ${
              category === cat
                ? 'bg-accent text-accent-foreground border-accent'
                : 'border-border hover:border-accent'
            }`}
          >
            {cat}
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">{emptyLabel[locale] ?? emptyLabel.en}</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <BlogCard key={b.slug} slug={b.slug} data={b.data} />
          ))}
        </div>
      )}
    </main>
  );
}
