import { ClusterLandingBody } from '@/components/cluster-landing-body';
import { ClusterLandingHero } from '@/components/cluster-landing-hero';
import { ClusterToolGrid } from '@/components/cluster-tool-grid';
import { routing } from '@/i18n/routing';
import { POPULATED_CLUSTERS, isClusterId, isPopulatedCluster } from '@/lib/cluster-config';
import { breadcrumbSchema, jsonLdSafe } from '@/lib/schema';
import { clampMetaDescription } from '@/lib/seo-metadata';
import { METADATA_BASE, SITE_URL } from '@/lib/site-url';
import { getToolMetasByCluster } from '@anytools/tools/meta';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageParams = { locale: string; cluster: string };

export function generateStaticParams(): PageParams[] {
  return routing.locales.flatMap((locale) =>
    POPULATED_CLUSTERS.map((cluster) => ({ locale, cluster })),
  );
}

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale, cluster } = await params;
  if (!isClusterId(cluster) || !isPopulatedCluster(cluster)) return {};
  const t = await getTranslations({ locale });
  const label = t(`catalog.cluster.${cluster}`);
  // The tagline is a display headline — 21 to 50 characters, too thin to describe the
  // page in a result. The landing intro already names the actual tools, so use that and
  // clamp it to what a SERP will show.
  const description = clampMetaDescription(t(`clusterLanding.${cluster}.intro`));
  const canonicalPath = `/${locale}/${cluster}`;
  return {
    metadataBase: METADATA_BASE,
    title: `${label} — Free Online Tools | AnyTools`,
    description,
    alternates: {
      canonical: canonicalPath,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/${cluster}`])),
    },
    openGraph: {
      title: `${label} — AnyTools`,
      description,
      url: `${SITE_URL}${canonicalPath}`,
      type: 'website',
    },
  };
}

export default async function ClusterLandingPage({ params }: { params: Promise<PageParams> }) {
  const { locale, cluster } = await params;
  // Opts this route into static rendering; without it next-intl marks the page
  // request-scoped and Next serves it uncacheable.
  setRequestLocale(locale);
  // A cluster with no published tools has nothing to offer a visitor or a crawler.
  // 404 rather than render an empty landing page.
  if (!isClusterId(cluster) || !isPopulatedCluster(cluster)) notFound();

  const t = await getTranslations({ locale });
  const tools = getToolMetasByCluster(cluster)
    .filter((m) => m.published !== false)
    .filter((m) => !m.availableLocales || m.availableLocales.includes(locale as never));

  const label = t(`catalog.cluster.${cluster}`);
  const tagline = t(`clusterLanding.${cluster}.tagline`);
  const intro = t(`clusterLanding.${cluster}.intro`);
  const toolCount = t('clusterLanding.toolCount', { count: tools.length });
  // t.raw so the array comes back as an array; a cluster added without copy yet
  // yields a non-array, which ClusterLandingBody renders as nothing.
  const rawBody = t.raw(`clusterLanding.${cluster}.body`);
  const body: string[] = Array.isArray(rawBody) ? (rawBody as string[]) : [];

  // Same URL construction as the canonical tag above, so the trail matches it exactly.
  const breadcrumb = breadcrumbSchema([
    { name: 'AnyTools', url: `${SITE_URL}/${locale}` },
    { name: label, url: `${SITE_URL}/${locale}/${cluster}` },
  ]);

  return (
    <main>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: jsonLdSafe escapes `</` to prevent script-tag breakout
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(breadcrumb) }}
      />
      <ClusterLandingHero
        cluster={cluster}
        label={label}
        tagline={tagline}
        intro={intro}
        toolCount={toolCount}
      />
      <ClusterToolGrid
        tools={tools}
        locale={locale}
        emptyTitle={t('clusterLanding.comingSoon')}
        emptyBody={t('clusterLanding.browseAll')}
      />
      {/* Below the grid on purpose: someone who came for a specific tool should
          reach it first, and the prose is for the visitor still deciding. */}
      <ClusterLandingBody heading={t('clusterLanding.bodyHeading')} paragraphs={body} />
    </main>
  );
}
