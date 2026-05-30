import { DashboardToolsPanel } from '@/components/dashboard-tools-panel';
import { toolMetasClient } from '@anytools/tools/meta';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-static';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'favoritesPage' });
  return {
    title: `${t('title')} — AnyTools`,
    description: t('subtitle'),
    robots: { index: false, follow: true }, // personal page, no SEO value
  };
}

export default async function FavoritesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'favoritesPage' });

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>
      <DashboardToolsPanel metas={toolMetasClient} locale={locale} />
      <p className="text-xs text-muted-foreground text-center mt-8 max-w-md mx-auto">
        {t('storedLocally')}
      </p>
    </main>
  );
}
