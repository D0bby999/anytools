import { ClusterLandingHero } from '@/components/cluster-landing-hero';
import { ClusterToolGrid } from '@/components/cluster-tool-grid';
import { routing } from '@/i18n/routing';
import { ALL_CLUSTERS, isClusterId } from '@/lib/cluster-config';
import { METADATA_BASE, SITE_URL } from '@/lib/site-url';
import { getToolMetasByCluster } from '@anytools/tools/meta';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

type PageParams = { locale: string; cluster: string };

export function generateStaticParams(): PageParams[] {
  return routing.locales.flatMap((locale) => ALL_CLUSTERS.map((cluster) => ({ locale, cluster })));
}

export async function generateMetadata({
  params,
}: { params: Promise<PageParams> }): Promise<Metadata> {
  const { locale, cluster } = await params;
  if (!isClusterId(cluster)) return {};
  const t = await getTranslations({ locale });
  const label = t(`catalog.cluster.${cluster}`);
  const tagline = t(`clusterLanding.${cluster}.tagline`);
  const canonicalPath = `/${locale}/${cluster}`;
  return {
    metadataBase: METADATA_BASE,
    title: `${label} — Free Online Tools | AnyTools`,
    description: tagline,
    alternates: {
      canonical: canonicalPath,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/${cluster}`])),
    },
    openGraph: {
      title: `${label} — AnyTools`,
      description: tagline,
      url: `${SITE_URL}${canonicalPath}`,
      type: 'website',
    },
  };
}

export default async function ClusterLandingPage({ params }: { params: Promise<PageParams> }) {
  const { locale, cluster } = await params;
  if (!isClusterId(cluster)) notFound();

  const t = await getTranslations({ locale });
  const tools = getToolMetasByCluster(cluster)
    .filter((m) => m.published !== false)
    .filter((m) => !m.availableLocales || m.availableLocales.includes(locale as never));

  const label = t(`catalog.cluster.${cluster}`);
  const tagline = t(`clusterLanding.${cluster}.tagline`);
  const intro = t(`clusterLanding.${cluster}.intro`);
  const toolCount = t('clusterLanding.toolCount', { count: tools.length });

  return (
    <main>
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
    </main>
  );
}
