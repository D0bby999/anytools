'use client';
import { Link, useRouter } from '@/i18n/routing';
import { signUp } from '@/lib/auth-client';
import { Button, Input } from '@anytools/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

export function SignUpForm() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signUp.email({ email, password, name });
    if (res.error) {
      setError(res.error.message ?? t('signUpFailed'));
      setBusy(false);
      return;
    }
    router.push('/dashboard' as never);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="block mb-1 text-muted-foreground">{t('name')}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </label>
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
        <span className="block mb-1 text-muted-foreground">
          {t('password')} ({t('minChars', { n: 8 })})
        </span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
          minLength={8}
        />
      </label>
      {error && <output className="block text-sm text-destructive">{error}</output>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? t('signingUp') : t('signUp')}
      </Button>
      <p className="text-sm text-muted-foreground text-center">
        {t('hasAccount')}{' '}
        <Link href="/sign-in" className="text-primary hover:underline">
          {t('signIn')}
        </Link>
      </p>
    </form>
  );
}
