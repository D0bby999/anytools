import { LegalPageRenderer } from '@/components/legal-page-renderer';
import { routing } from '@/i18n/routing';
import { getLegalPage } from '@/lib/legal-content';
import { selfHostSafeAlternates } from '@/lib/site-url';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const page = getLegalPage('privacy', locale);
  return {
    title: `${page.title} — AnyTools`,
    description: page.sections[0]?.body[0]?.slice(0, 160),
    // Content is translated per locale → self-canonical + hreflang so the 4
    // language versions cluster instead of being flagged as duplicates in GSC.
    // A self-host install has no way to know its own public URL at build time
    // (see site-url.ts), so this must go through the same helper the tool
    // pages use rather than emit the object unconditionally.
    alternates: selfHostSafeAlternates({
      canonical: `/${locale}/privacy`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/privacy`])),
    }),
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  // Opts this route into static rendering; without it next-intl marks the page
  // request-scoped and Next serves it uncacheable.
  setRequestLocale(locale);
  return <LegalPageRenderer page={getLegalPage('privacy', locale)} />;
}
