import { DynamicToolRenderer } from '@/components/dynamic-tool-renderer';
import { ToolPageLayout } from '@/components/tool-page-layout';
import { routing } from '@/i18n/routing';
import { hasLocalizedToolBody } from '@/lib/has-localized-tool-body';
import { loadToolContent } from '@/lib/load-tool-content';
import {
  breadcrumbSchema,
  faqSchema,
  howToSchema,
  jsonLdSafe,
  softwareAppSchema,
} from '@/lib/schema';
import { buildToolTitle } from '@/lib/seo-metadata';
import { METADATA_BASE, SITE_URL } from '@/lib/site-url';
import { getToolMeta, toolMetas } from '@anytools/tools/meta';
import type { ClusterId } from '@anytools/tools/types';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageParams = { locale: string; cluster: string; tool: string };

export function generateStaticParams(): PageParams[] {
  return routing.locales.flatMap((locale) =>
    toolMetas
      .filter((m) => !m.availableLocales || m.availableLocales.includes(locale as never))
      .map((m) => ({ locale, cluster: m.cluster, tool: m.slug })),
  );
}

// SEO title template: "{tool} — Free Online {category} | AnyTools"
// Keeps tool name first (highest weight), category-keyword for cluster SEO,
// brand suffix for memorability + click-back recognition. <60 chars target.
const CLUSTER_LABEL_EN: Record<ClusterId, string> = {
  encoding: 'Encoder',
  formatters: 'Formatter',
  generators: 'Generator',
  converters: 'Converter',
  'text-regex': 'Text Tool',
  'time-date': 'Date Tool',
  web3: 'Web3 Tool',
  marketing: 'Marketing Tool',
  'ecommerce-vn': 'VN E-commerce',
  finance: 'Calculator',
  health: 'Health Tool',
  lifestyle: 'Tool',
  design: 'Design Tool',
};

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale, cluster, tool } = await params;
  const m = getToolMeta(cluster, tool);
  if (!m) return {};
  const title = m.title[locale] ?? m.title.en ?? m.slug;
  const description = m.description[locale] ?? m.description.en ?? '';
  const categoryLabel = CLUSTER_LABEL_EN[m.cluster];
  const seoTitle = buildToolTitle(title, categoryLabel);
  const canonicalPath = `/${locale}/${cluster}/${tool}`;
  // A locale with no translated tutorial/FAQ renders the widget and little else
  // (~130 unique words against 400-800 in English). Serving that is fine; asking
  // Google to index it is what got the site turned down for thin content.
  const hasBody = hasLocalizedToolBody(locale, cluster, tool);

  return {
    metadataBase: METADATA_BASE,
    title: seoTitle,
    description,
    keywords: m.keywords,
    alternates: {
      canonical: canonicalPath,
      // For en-only tools, hreflang lists only the supported locales so we don't
      // advertise links to pages that will 404 — and, since 2026-09-02, only the
      // locales whose body content actually exists, so hreflang stops pointing at
      // pages we are simultaneously telling Google not to index.
      languages: Object.fromEntries(
        (m.availableLocales ?? routing.locales)
          .filter((l) => hasLocalizedToolBody(l, cluster, tool))
          .map((l) => [l, `/${l}/${cluster}/${tool}`]),
      ),
    },
    openGraph: {
      type: 'website',
      title: seoTitle,
      description,
      url: canonicalPath,
      siteName: 'AnyTools',
      locale,
      alternateLocale: (m.availableLocales ?? routing.locales).filter((l) => l !== locale),
    },
    twitter: {
      card: 'summary_large_image',
      title: seoTitle,
      description,
    },
    // follow stays true even when index is false: the page's links to sibling
    // tools and to the English original are still worth crawling.
    robots: {
      index: hasBody,
      follow: true,
      googleBot: { index: hasBody, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
    },
  };
}

export default async function ToolPage({ params }: { params: Promise<PageParams> }) {
  const { locale, cluster, tool } = await params;
  // Opts this route into static rendering; without it next-intl marks the page
  // request-scoped and Next serves it uncacheable.
  setRequestLocale(locale);
  const m = getToolMeta(cluster, tool);
  if (!m) notFound();
  if (m.availableLocales && !m.availableLocales.includes(locale as never)) notFound();

  const content = await loadToolContent(locale, cluster, tool);

  const title = m.title[locale] ?? m.title.en ?? m.slug;
  const description = m.description[locale] ?? m.description.en ?? '';
  const url = `${SITE_URL}/${locale}/${cluster}/${tool}`;

  // Breadcrumb URLs are built from the same SITE_URL + locale path as the canonical tag,
  // so the trail can never disagree with the canonical Google resolves.
  const t = await getTranslations({ locale });
  const schemas: { key: string; data: object }[] = [
    { key: 'software', data: softwareAppSchema({ name: title, description, url }) },
    {
      key: 'breadcrumb',
      data: breadcrumbSchema([
        { name: 'AnyTools', url: `${SITE_URL}/${locale}` },
        { name: t(`catalog.cluster.${cluster}`), url: `${SITE_URL}/${locale}/${cluster}` },
        { name: title, url },
      ]),
    },
  ];
  if (content.faq && content.faq.items.length > 0) {
    schemas.push({ key: 'faq', data: faqSchema(content.faq.items) });
  }
  if (content.tutorial) {
    schemas.push({
      key: 'howto',
      data: howToSchema({ name: title, steps: [{ name: 'Use the tool', text: description }] }),
    });
  }

  return (
    <>
      {schemas.map(({ key, data }) => (
        <script
          key={key}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes `</` to prevent script-tag breakout
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(data) }}
        />
      ))}
      <ToolPageLayout meta={m} locale={locale} content={content}>
        <DynamicToolRenderer slug={tool} />
      </ToolPageLayout>
    </>
  );
}
