'use client';
import { useRouter } from '@/i18n/routing';
import { signOut } from '@/lib/auth-client';
import { Button } from '@anytools/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function SignOutButton() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setBusy(true);
    await signOut();
    router.push('/sign-in' as never);
  };

  return (
    <Button variant="outline" onClick={handle} disabled={busy}>
      {busy ? t('signingOut') : t('signOut')}
    </Button>
  );
}
