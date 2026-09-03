import { AdSlot } from '@/components/ad-slot';
import { MdxContent } from '@/components/mdx-content';
import { routing } from '@/i18n/routing';
import { GUIDE_SLUGS, loadGuide } from '@/lib/load-guide-content';
import { jsonLdSafe } from '@/lib/schema';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { fitTitle } from '@/lib/seo-metadata';
import { METADATA_BASE, SITE_URL, selfHostSafeAlternates } from '@/lib/site-url';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageParams = { locale: string; slug: string };

export function generateStaticParams(): PageParams[] {
  return routing.locales.flatMap((locale) => GUIDE_SLUGS.map((slug) => ({ locale, slug })));
}

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const guide = await loadGuide(locale, slug);
  if (!guide) return {};
  // Guide titles are long by nature ("Free Finance Calculators — Mortgage, Loan, Tip,
  // Compound Interest"), so the " | AnyTools Guides" suffix pushed five of seven past
  // the point Google truncates. Keep the headline, drop the suffix when it will not fit.
  const seoTitle = fitTitle(guide.data.title as string, ' | AnyTools Guides');
  const canonicalPath = `/${locale}/guides/${slug}`;
  return {
    metadataBase: METADATA_BASE,
    title: seoTitle,
    description: guide.data.description,
    keywords: guide.data.keywords,
    alternates: selfHostSafeAlternates({
      canonical: canonicalPath,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/guides/${slug}`])),
    }),
    openGraph: {
      type: 'article',
      title: seoTitle,
      description: guide.data.description,
      url: IS_SELF_HOSTED ? undefined : canonicalPath,
      siteName: 'AnyTools',
      locale,
      alternateLocale: routing.locales.filter((l) => l !== locale),
      publishedTime: guide.data.updated,
      modifiedTime: guide.data.updated,
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle,
      description: guide.data.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<PageParams> }) {
  const { locale, slug } = await params;
  // Opts this route into static rendering; without it next-intl marks the page
  // request-scoped and Next serves it uncacheable.
  setRequestLocale(locale);
  const guide = await loadGuide(locale, slug);
  if (!guide) notFound();

  const url = `${SITE_URL}/${locale}/guides/${slug}`;
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.data.title,
    description: guide.data.description,
    inLanguage: locale,
    datePublished: guide.data.updated,
    dateModified: guide.data.updated,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(articleSchema) }}
      />
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <header className="mb-8 not-prose">
          <h1 className="text-4xl font-bold mb-2">{guide.data.title}</h1>
          {guide.data.description && (
            <p className="text-lg text-muted-foreground">{guide.data.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {guide.data.updated && <>Updated {guide.data.updated} · </>}
            {guide.data.readingTime && <>{guide.data.readingTime} min read</>}
          </p>
        </header>
        <MdxContent source={guide.source} />
      </article>
      <div className="my-8">
        <AdSlot slotId="guide-end" format="auto" />
      </div>
    </main>
  );
}
