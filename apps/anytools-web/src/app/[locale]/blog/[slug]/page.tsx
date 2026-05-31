import { AdSlot } from '@/components/ad-slot';
import { BlogAuthorBio } from '@/components/blog-author-bio';
import { BlogFtcDisclosure } from '@/components/blog-ftc-disclosure';
import { BlogHero } from '@/components/blog-hero';
import { MdxContent } from '@/components/mdx-content';
import { routing } from '@/i18n/routing';
import { BLOG_SLUGS, loadBlog } from '@/lib/load-blog-content';
import { faqSchema, howToSchema, jsonLdSafe } from '@/lib/schema';
import { METADATA_BASE, SITE_URL } from '@/lib/site-url';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

type PageParams = { locale: string; slug: string };

export function generateStaticParams(): PageParams[] {
  // Phase 1: EN only. When VI/ES/PT translations land, expand here.
  return BLOG_SLUGS.map((slug) => ({ locale: 'en', slug }));
}

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const blog = await loadBlog(locale, slug);
  if (!blog) return {};
  const seoTitle = `${blog.data.title} | AnyTools Blog`;
  const canonicalPath = `/${locale}/blog/${slug}`;
  return {
    metadataBase: METADATA_BASE,
    title: seoTitle,
    description: blog.data.description,
    keywords: blog.data.keywords,
    alternates: {
      canonical: canonicalPath,
      // Phase 1 EN only — other locales redirect or 404 until translations ship
      languages: { en: `/en/blog/${slug}` },
    },
    openGraph: {
      type: 'article',
      title: seoTitle,
      description: blog.data.description,
      url: canonicalPath,
      siteName: 'AnyTools',
      locale,
      images: blog.data.heroImage ? [{ url: blog.data.heroImage.url }] : undefined,
      publishedTime: blog.data.publishedAt,
      modifiedTime: blog.data.updatedAt ?? blog.data.publishedAt,
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle,
      description: blog.data.description,
      images: blog.data.heroImage ? [blog.data.heroImage.url] : undefined,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  };
}

export default async function BlogPostPage({ params }: { params: Promise<PageParams> }) {
  const { locale, slug } = await params;
  const blog = await loadBlog(locale, slug);
  if (!blog) notFound();

  const url = `${SITE_URL}/${locale}/blog/${slug}`;
  const author = blog.data.author;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: blog.data.title,
    description: blog.data.description,
    inLanguage: locale,
    datePublished: blog.data.publishedAt,
    dateModified: blog.data.updatedAt ?? blog.data.publishedAt,
    image: blog.data.heroImage?.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    articleSection: blog.data.category,
    ...(author && {
      author: {
        '@type': 'Person',
        name: author.name,
        url: author.url ? `${SITE_URL}${author.url}` : `${SITE_URL}/about`,
        ...(author.credentials && { description: author.credentials }),
      },
    }),
    publisher: {
      '@type': 'Organization',
      name: 'AnyTools',
      url: SITE_URL,
    },
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(articleSchema) }}
      />
      {blog.data.howTo && blog.data.howTo.steps.length > 0 && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(howToSchema(blog.data.howTo)) }}
        />
      )}
      {blog.data.faq && blog.data.faq.length > 0 && (
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(faqSchema(blog.data.faq)) }}
        />
      )}
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <header className="mb-6 not-prose">
          {blog.data.category && (
            <p className="text-xs uppercase tracking-wide text-accent font-medium mb-2">
              {blog.data.category}
            </p>
          )}
          <h1 className="text-4xl font-bold mb-2">{blog.data.title}</h1>
          {blog.data.description && (
            <p className="text-lg text-muted-foreground">{blog.data.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {blog.data.publishedAt && <>Published {blog.data.publishedAt} · </>}
            {blog.data.readingTime && <>{blog.data.readingTime} min read</>}
          </p>
        </header>
        {blog.data.disclosureType && <BlogFtcDisclosure type={blog.data.disclosureType} />}
        {blog.data.heroImage && <BlogHero image={blog.data.heroImage} />}
        <MdxContent source={blog.source} />
        {author && <BlogAuthorBio author={author} />}
      </article>
      <div className="my-8">
        <AdSlot slotId="blog-end" format="auto" />
      </div>
    </main>
  );
}
