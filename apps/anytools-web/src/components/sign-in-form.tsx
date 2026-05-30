'use client';
import { Link, useRouter } from '@/i18n/routing';
import { signIn } from '@/lib/auth-client';
import { Button, Input } from '@anytools/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function SignInForm() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn.email({ email, password });
    if (res.error) {
      setError(res.error.message ?? t('signInFailed'));
      setBusy(false);
      return;
    }
    router.push('/dashboard' as never);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="block mb-1 text-muted-foreground">{t('email')}</span>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </label>
      <label className="block text-sm">
        <span className="block mb-1 text-muted-foreground">{t('password')}</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          minLength={8}
        />
      </label>
      {error && <output className="block text-sm text-destructive">{error}</output>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? t('signingIn') : t('signIn')}
      </Button>
      <p className="text-sm text-muted-foreground text-center">
        {t('noAccount')}{' '}
        <Link href="/sign-up" className="text-primary hover:underline">
          {t('signUp')}
        </Link>
      </p>
    </form>
  );
}
