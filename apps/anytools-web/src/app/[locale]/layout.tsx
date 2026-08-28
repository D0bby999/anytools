import { AdSenseScript } from '@/components/adsense-script';
import { CmdKPalette } from '@/components/cmd-k-palette';
import { CookieConsentBanner } from '@/components/cookie-consent-banner';
import { Footer } from '@/components/footer';
import { InstallPrompt } from '@/components/install-prompt';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { UmamiAnalytics } from '@/components/umami-analytics';
import { SiteHeader } from '@/components/site-header';
import { ThemeProvider } from '@/components/theme-provider';
import { routing } from '@/i18n/routing';
import { METADATA_BASE } from '@/lib/site-url';
import { isValidLocale } from '@anytools/i18n';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
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
  metadataBase: METADATA_BASE,
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
            <InstallPrompt />
            <CookieConsentBanner />
            <UmamiAnalytics />
            <MobileBottomNav />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
