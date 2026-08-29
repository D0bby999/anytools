'use client';
import { Button, Input } from '@anytools/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function NewsletterSignup({ variant = 'inline' }: { variant?: 'inline' | 'card' }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const locale = useLocale();
  const t = useTranslations('newsletter');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || t('error'));
      }
      setStatus('success');
      setEmail('');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : t('error'));
    }
  };

  if (status === 'success') {
    return (
      <p
        className={
          variant === 'card'
            ? 'text-sm text-success'
            : 'text-sm text-muted-foreground'
        }
      >
        {t('success')}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={variant === 'card' ? 'space-y-2' : 'flex gap-2'}>
      <Input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('placeholder')}
        disabled={status === 'submitting'}
        className={variant === 'card' ? 'w-full' : 'flex-1 min-w-0'}
      />
      <Button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? t('submitting') : t('subscribe')}
      </Button>
      {status === 'error' && (
        <output className="block text-xs text-destructive mt-1 w-full">{errorMsg}</output>
      )}
    </form>
  );
}
