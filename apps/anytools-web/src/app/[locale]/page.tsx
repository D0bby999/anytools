import { HeroDemo } from '@/components/hero-demo';
import { NewsletterSignup } from '@/components/newsletter-signup';
import { RecentlyUsedTools } from '@/components/recently-used-tools';
import { ToolCatalog } from '@/components/tool-catalog';
import { Link, routing } from '@/i18n/routing';
import { METADATA_BASE } from '@/lib/site-url';
import { toolMetas, toolMetasClient } from '@anytools/tools/meta';
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle } from '@anytools/ui';
import { ArrowRight, Globe, Lock, ScrollText, ShieldCheck, Sparkles, Wifi } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

const VALUE_PROPS = [
  { Icon: Globe, key: 'valueProp1' },
  { Icon: Lock, key: 'valueProp2' },
  { Icon: ScrollText, key: 'valueProp3' },
] as const;

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
        <div className="container mx-auto max-w-6xl px-4 py-12 md:py-20 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-10 items-center">
            <div className="lg:col-span-3 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full bg-accent/10 text-accent px-3 py-1 text-xs font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t('landing.eyebrow')}</span>
              </div>
              <h1 className="text-brand-gradient text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] pb-1">
                {t('landing.heroTitle')}
              </h1>
              <p className="text-lg text-muted-foreground max-w-xl leading-relaxed">
                {t('landing.heroSubtitle')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button size="lg" asChild className="brand-glow">
                  <a href="#catalog" className="inline-flex items-center gap-2">
                    {t('landing.ctaPrimary')}
                    <ArrowRight className="h-4 w-4" />
                  </a>
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
              {/* Trust badges */}
              <div className="flex flex-wrap gap-4 pt-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <ScrollText className="h-3.5 w-3.5" />
                  {t('landing.badgeMit')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Wifi className="h-3.5 w-3.5" />
                  {t('landing.badgeOffline')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  {t('landing.badge4Langs')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t('landing.badgePrivate')}
                </span>
              </div>
            </div>

            {/* Demo */}
            <div className="lg:col-span-2">
              <HeroDemo />
            </div>
          </div>
        </div>
      </section>

      {/* RECENTLY USED (history if present, otherwise curated POPULAR_FALLBACK) */}
      <RecentlyUsedTools metas={toolMetasClient} locale={locale} />

      {/* VALUE PROPS */}
      <section className="py-16 border-b">
        <div className="container mx-auto max-w-6xl px-4">
          <h2 className="text-2xl md:text-3xl font-bold mb-10">{t('landing.valuePropsHeading')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {VALUE_PROPS.map(({ Icon, key }) => (
              <Card key={key} className="border-0 shadow-none bg-transparent">
                <CardHeader className="px-0">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent mb-3">
                    <Icon className="h-5 w-5" />
                  </div>
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
