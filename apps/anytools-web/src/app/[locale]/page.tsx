import { HeroMiniTool } from '@/components/hero-mini-tool';
import { NewsletterSignup } from '@/components/newsletter-signup';
import { RecentlyUsedTools } from '@/components/recently-used-tools';
import { ToolCatalog } from '@/components/tool-catalog';
import { Link, routing } from '@/i18n/routing';
import { METADATA_BASE } from '@/lib/site-url';
import { toolMetas, toolMetasClient } from '@anytools/tools/meta';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle } from '@anytools/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

const VALUE_PROPS = ['valueProp1', 'valueProp2', 'valueProp3'] as const;

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const title = t('metaTitle');
  const description = t('metaDescription');
  const canonical = `/${locale}`;
  return {
    metadataBase: METADATA_BASE,
    title,
    description,
    alternates: {
      canonical,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}`])),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: 'AnyTools',
      locale,
      alternateLocale: routing.locales.filter((l) => l !== locale),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale });

  return (
    <main>
      {/* HERO */}
      <section className="border-b relative overflow-hidden">
        {/* Brand aurora — emerald glow backdrop (decorative, brand surface) */}
        <div
          aria-hidden="true"
          className="brand-aurora pointer-events-none absolute -top-28 right-[-80px] h-[440px] w-[560px]"
        />
        <div className="container mx-auto max-w-6xl px-4 py-10 md:py-16 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-3 space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 text-accent px-3 py-1 text-xs font-medium tracking-wide uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                {t('landing.eyebrow')}
              </div>
              {/* Plain foreground, not the brand gradient, and two steps smaller.
                  A full-width gradient headline is the single most template-looking
                  element on a utility site — the product demo beside it is what
                  should carry the page. */}
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-[1.12] text-foreground">
                {t('landing.heroTitle')}
              </h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed">
                {t('landing.heroSubtitle')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild className="brand-glow">
                  <a href="#catalog">{t('landing.ctaPrimary')}</a>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <a
                    href="https://github.com/D0bby999/anytools"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('landing.ctaSecondary')}
                  </a>
                </Button>
              </div>
              {/* Trust badges — text-only pills, each marked with a brand dot */}
              <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
                {(['badgeMit', 'badgeOffline', 'badge4Langs', 'badgePrivate'] as const).map(
                  (key) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-accent/70" aria-hidden="true" />
                      {t(`landing.${key}`)}
                    </span>
                  ),
                )}
              </div>
            </div>

            {/* Live, browser-only mini tool (replaces the old scripted demo) */}
            <div className="lg:col-span-2">
              <HeroMiniTool />
            </div>
          </div>
        </div>
      </section>

      {/* RECENTLY USED (history if present, otherwise curated POPULAR_FALLBACK) */}
      <RecentlyUsedTools metas={toolMetasClient} locale={locale} />

      {/* VALUE PROPS — numbered surface cards (large number tags replace icon tiles) */}
      <section className="py-12 md:py-14 border-b">
        <div className="container mx-auto max-w-6xl px-4">
          <h2 className="text-xl md:text-2xl font-bold mb-6">{t('landing.valuePropsHeading')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {VALUE_PROPS.map((key, i) => (
              <Card
                key={key}
                className="relative h-full overflow-hidden p-6 transition-colors duration-150 hover:border-accent/50"
              >
                {/* Top brand hairline — subtle depth without decorative icons */}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-brand-from to-brand-to opacity-70"
                />
                <CardHeader className="p-0 space-y-3">
                  <span className="text-brand-gradient font-bold text-4xl tabular-nums inline-block">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <CardTitle className="text-lg">{t(`landing.${key}Title`)}</CardTitle>
                  <CardDescription className="text-base leading-relaxed">
                    {t(`landing.${key}Body`)}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* TOOL CATALOG with search + filter + sort */}
      <section id="catalog" className="py-16">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="flex items-end justify-between mb-6">
            <h2 className="text-2xl md:text-3xl font-bold">{t('nav.tools')}</h2>
            <Badge variant="secondary" className="text-xs">
              {toolMetas.length} tools
            </Badge>
          </div>
          <ToolCatalog metas={toolMetasClient} locale={locale} />
        </div>
      </section>

      {/* NEWSLETTER */}
      <section
        id="waitlist"
        aria-labelledby="newsletter-heading"
        className="py-16 border-t bg-muted/30"
      >
        <div className="container mx-auto max-w-2xl px-4 text-center">
          <h2 id="newsletter-heading" className="text-2xl md:text-3xl font-semibold mb-2">
            {t('newsletter.title')}
          </h2>
          <p className="text-muted-foreground mb-6">{t('newsletter.subtitle')}</p>
          <div className="max-w-md mx-auto">
            <NewsletterSignup />
          </div>
        </div>
      </section>
    </main>
  );
}
