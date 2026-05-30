import { LegalPageRenderer } from '@/components/legal-page-renderer';
import { getLegalPage } from '@/lib/legal-content';
import type { Metadata } from 'next';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const page = getLegalPage('privacy', locale);
  return {
    title: `${page.title} — AnyTools`,
    description: page.sections[0]?.body[0]?.slice(0, 160),
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <LegalPageRenderer page={getLegalPage('privacy', locale)} />;
}
