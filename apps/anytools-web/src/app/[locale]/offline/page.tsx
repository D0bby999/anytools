'use client';

import { Button } from '@anytools/ui';
import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Service worker fallback for a failed navigation to a page that was never visited/cached
 * (see `networkFirstNavigate` in public/sw.js). No route params are read here — the
 * `[locale]/layout.tsx` above this page already resolved the locale and wraps the tree in
 * `NextIntlClientProvider`, so `useTranslations` picks the right language the same way
 * every other client component in this app does (see components/footer.tsx). That also
 * means this page needs no `generateStaticParams` of its own: the layout's already covers
 * the `[locale]` segment for every page nested under it.
 */
export default function OfflinePage() {
  const t = useTranslations('offline');

  return (
    <main className="container mx-auto max-w-xl px-4 py-20 md:py-32 text-center">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-6">
        <WifiOff className="h-6 w-6" />
      </div>
      <h1 className="text-3xl md:text-4xl font-bold mb-3">{t('title')}</h1>
      <p className="text-muted-foreground mb-8 max-w-md mx-auto">{t('body')}</p>
      <Button size="lg" onClick={() => location.reload()}>
        {t('retry')}
      </Button>
    </main>
  );
}
