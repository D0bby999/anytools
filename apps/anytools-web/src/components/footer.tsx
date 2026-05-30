import { Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { NewsletterSignup } from './newsletter-signup';

export function Footer() {
  const t = useTranslations('footer');
  const nav = useTranslations('nav');
  const news = useTranslations('newsletter');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t mt-16 py-12">
      <div className="container mx-auto max-w-6xl px-4 grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-3">
          <h3 className="font-semibold text-foreground">{news('title')}</h3>
          <p className="text-sm text-muted-foreground max-w-md">{news('subtitle')}</p>
          <div className="max-w-md">
            <NewsletterSignup variant="card" />
          </div>
        </div>
        <div className="md:text-right space-y-3 text-sm text-muted-foreground">
          <nav className="flex flex-wrap gap-4 md:justify-end">
            <Link href="/about" className="hover:text-foreground">
              {t('about')}
            </Link>
            <Link href="/contact" className="hover:text-foreground">
              {t('contact')}
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              {t('privacy')}
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              {t('terms')}
            </Link>
            <a
              href="https://github.com/anytools"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              {nav('github')}
            </a>
          </nav>
          <p>
            © {year} AnyTools. {t('rights')}.
          </p>
          <p className="text-xs max-w-md md:ml-auto">{t('affiliateDisclosure')}</p>
        </div>
      </div>
    </footer>
  );
}
