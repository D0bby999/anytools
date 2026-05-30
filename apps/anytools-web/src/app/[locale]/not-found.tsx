import { Link } from '@/i18n/routing';
import { toolMetas } from '@anytools/tools/meta';
import { Button } from '@anytools/ui';
import { ArrowRight, Home } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

const POPULAR_SLUGS = ['json-formatter', 'base64-encode', 'qr-code-generator', 'regex-tester'];

export default function NotFound() {
  const t = useTranslations('notFound');
  const locale = useLocale();
  const popular = POPULAR_SLUGS.map((slug) => toolMetas.find((m) => m.slug === slug)).filter(
    (m): m is NonNullable<typeof m> => Boolean(m),
  );

  return (
    <main className="container mx-auto max-w-2xl px-4 py-20 md:py-32 text-center">
      <p className="text-7xl md:text-8xl font-bold text-accent mb-4 tracking-tight">404</p>
      <h1 className="text-3xl md:text-4xl font-bold mb-3">{t('title')}</h1>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">{t('description')}</p>
      <Button size="lg" asChild>
        <Link href="/" className="inline-flex items-center gap-2">
          <Home className="h-4 w-4" />
          {t('ctaHome')}
        </Link>
      </Button>

      <div className="mt-16">
        <p className="text-sm text-muted-foreground mb-4">{t('popularHeading')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {popular.map((m) => (
            <Link
              key={m.slug}
              href={`/${m.cluster}/${m.slug}` as never}
              className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium hover:border-accent hover:text-accent transition-colors duration-150"
            >
              {m.title[locale] ?? m.title.en}
              <ArrowRight className="h-3.5 w-3.5 opacity-60" />
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
