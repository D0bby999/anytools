import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ResendError = { message?: string };

async function addToResend(email: string, locale: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.log(`[newsletter] no Resend config — logged signup: ${email} (locale: ${locale})`);
    return;
  }
  const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      unsubscribed: false,
      // Resend supports first_name / last_name; we have neither at signup, skip.
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ResendError;
    throw new Error(body.message || `Resend API error (${res.status})`);
  }
}

export async function POST(req: Request) {
  // Self-host builds have no Resend account: without this gate, a missing RESEND_*
  // config would fall through to console.log-ing the visitor's email into a stranger's
  // container log (see addToResend above) instead of ever reaching an inbox.
  if (IS_SELF_HOSTED) return new Response(null, { status: 404 });
  let body: { email?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const locale = typeof body.locale === 'string' ? body.locale : 'en';
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  try {
    await addToResend(email, locale);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Subscription failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
