import { LegalPageRenderer } from '@/components/legal-page-renderer';
import { routing } from '@/i18n/routing';
import { getLegalPage } from '@/lib/legal-content';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const page = getLegalPage('contact', locale);
  return {
    title: `${page.title} — AnyTools`,
    description: page.sections[0]?.body[0]?.slice(0, 160),
    // Content is translated per locale → self-canonical + hreflang so the 4
    // language versions cluster instead of being flagged as duplicates in GSC.
    alternates: {
      canonical: `/${locale}/contact`,
      languages: Object.fromEntries(routing.locales.map((l) => [l, `/${l}/contact`])),
    },
  };
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalPageRenderer page={getLegalPage('contact', locale)} />;
}
