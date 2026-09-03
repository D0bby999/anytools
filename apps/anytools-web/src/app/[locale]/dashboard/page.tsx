import { DashboardToolsPanel } from '@/components/dashboard-tools-panel';
import { SignOutButton } from '@/components/sign-out-button';
import { redirect } from '@/i18n/routing';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { toolMetasClient } from '@anytools/tools/meta';
import { Card, CardContent, CardHeader, CardTitle } from '@anytools/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  // Defense in depth — the real 404 status for self-host comes from the sibling
  // layout.tsx (see its comment: this page has a `loading.tsx`, which streams the
  // response and would otherwise lock the status at 200 even when notFound() renders
  // the not-found UI). Gating here too costs nothing and avoids an unnecessary
  // getTranslations() call.
  if (IS_SELF_HOSTED) notFound();
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  // Auth-gated personal page — keep out of the index (no SEO value, avoids
  // thin/duplicate-content flags across locales).
  return { title: `${t('dashboard')} — AnyTools`, robots: { index: false, follow: true } };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  // Defense in depth (see layout.tsx for the real 404-status fix and why it's needed
  // here too): gated before the `@/lib/auth` import below so better-auth never
  // initializes (no BETTER_AUTH_SECRET required, no auth.db written) in a self-host
  // build, even though the layout above already stops rendering from reaching here.
  if (IS_SELF_HOSTED) notFound();
  const { locale } = await params;
  const { auth } = await import('@/lib/auth');
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect({ href: '/sign-in', locale });
    return null;
  }

  const t = await getTranslations({ locale, namespace: 'auth' });
  const user = session.user;

  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('dashboard')}</h1>
          <p className="text-muted-foreground mt-1">
            {t('welcome', { name: user.name || user.email })}
          </p>
        </div>
        <SignOutButton />
      </header>

      {/* Favorites + Recent tools */}
      <section className="mb-6">
        <DashboardToolsPanel metas={toolMetasClient} locale={locale} />
      </section>

      {/* Account + Plan */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('account')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">{t('email')}: </span>
              <span className="font-mono">{user.email}</span>
            </div>
            {user.name && (
              <div>
                <span className="text-muted-foreground">{t('name')}: </span>
                <span>{user.name}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t('memberSince')}: </span>
              <span>{new Date(user.createdAt).toLocaleDateString(locale)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('plan')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                Free
              </span>
            </p>
            <p className="text-muted-foreground">{t('planFreeDescription')}</p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
