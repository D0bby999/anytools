'use client';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import { Link } from '@/i18n/routing';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { Button } from '@anytools/ui';
import { useTranslations } from 'next-intl';

export function CookieConsentBanner() {
  const { choice, grant, deny } = useCookieConsent();
  const t = useTranslations('consent');

  // Self-host builds gate no analytics behind consent (Umami is off entirely — see
  // umami-analytics.tsx) so the banner's only purpose no longer applies. Hooks are
  // called above, unconditionally, so this early return does not violate rules of
  // hooks — that also means this component is NOT unit-tested by calling the function
  // directly (self-hosted.test.ts): useCookieConsent()/useTranslations() both throw
  // outside a provider under `environment: 'node'`. It is verified via rendered HTML
  // in the phase's browser Verify step instead.
  if (IS_SELF_HOSTED) return null;
  if (choice !== 'pending') return null;

  return (
    <div
      role="dialog"
      aria-label={t('title')}
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <div className="container mx-auto max-w-5xl px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 text-sm">
        <p className="flex-1 text-muted-foreground">
          {t('message')}{' '}
          <Link href="/privacy" className="underline hover:text-foreground">
            {t('learnMore')}
          </Link>
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={deny}>
            {t('deny')}
          </Button>
          <Button size="sm" onClick={grant}>
            {t('accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
