import { AdSenseScript } from '@/components/adsense-script';
import { CmdKPalette } from '@/components/cmd-k-palette';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { Footer } from '@/components/footer';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { UmamiAnalytics } from '@/components/umami-analytics';
import { routing } from '@/i18n/routing';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { METADATA_BASE } from '@/lib/site-url';
import { isValidLocale } from '@anytools/i18n';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  // Self-host: no known public origin (see site-url.ts) — leave metadataBase unset so
  // any relative resource Next would otherwise resolve against it renders as a relative
  // path instead of an absolute URL pointing at a placeholder host.
  metadataBase: IS_SELF_HOSTED ? undefined : METADATA_BASE,
  manifest: '/manifest.json',
  // Google Search Console verification: set GSC_VERIFICATION in Coolify env to the token
  // from Search Console's "HTML tag" method → Next renders <meta name="google-site-verification">.
  verification: process.env.GSC_VERIFICATION ? { google: process.env.GSC_VERIFICATION } : undefined,
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/logo-mark.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/icons/favicon.ico',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F8FAFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0F172A' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isValidLocale(locale)) notFound();

  // Opts the whole locale subtree into static rendering. Without this, next-intl treats every
  // translated page as request-scoped and Next serves it `no-store` — every tool page was being
  // re-rendered per request despite having generateStaticParams.
  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased pb-16 lg:pb-0">
        {/* React 19 hoists this async script into <head> of the server HTML. */}
        <AdSenseScript />
        <ThemeProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <SiteHeader />
            {children}
            <Footer />
            <CmdKPalette />
            <CookieConsentBanner />
            <UmamiAnalytics />
            <MobileBottomNav />
            {/* Runs in both the hosted build and the self-host build — see
                service-worker-register.tsx: PWA/offline is the one surface phase-05
                deliberately ships to prod hosted too, unlike every other IS_SELF_HOSTED
                gate in this file. */}
            <ServiceWorkerRegister />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
