import { SignInForm } from '@/components/sign-in-form';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  // Auth form — no SEO value, keep out of the index (avoids cross-locale dupes).
  return { title: `${t('signIn')} — AnyTools`, robots: { index: false, follow: true } };
}

export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  // Self-host builds never initialize better-auth (see auth-guards.ts, api/auth route).
  if (IS_SELF_HOSTED) notFound();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold mb-6 text-center">{t('signIn')}</h1>
      <SignInForm />
    </main>
  );
}
