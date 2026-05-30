'use client';
import { Button } from '@anytools/ui';
import { AlertTriangle, Home, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('error');

  useEffect(() => {
    // Best-effort log. When Sentry/Highlight is wired, send here.
    console.error('[locale-error]', error);
  }, [error]);

  return (
    <main className="container mx-auto max-w-xl px-4 py-20 md:py-32 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-6">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h1 className="text-3xl md:text-4xl font-bold mb-3">{t('title')}</h1>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">{t('description')}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={reset} className="inline-flex items-center gap-2">
          <RotateCw className="h-4 w-4" />
          {t('retry')}
        </Button>
        <Button size="lg" variant="outline" asChild>
          <a href="/" className="inline-flex items-center gap-2">
            <Home className="h-4 w-4" />
            {t('ctaHome')}
          </a>
        </Button>
      </div>
      {error.digest && (
        <p className="mt-8 text-xs text-muted-foreground font-mono">
          {t('errorRef')}: <code className="bg-muted px-1.5 py-0.5 rounded">{error.digest}</code>
        </p>
      )}
    </main>
  );
}
