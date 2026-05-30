import { SignUpForm } from '@/components/sign-up-form';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return { title: `${t('signUp')} — AnyTools` };
}

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <h1 className="text-3xl font-bold mb-6 text-center">{t('signUp')}</h1>
      <SignUpForm />
    </main>
  );
}
