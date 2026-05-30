'use client';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import Script from 'next/script';

const DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const SCRIPT_SRC =
  process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_SRC ?? 'https://plausible.io/js/script.js';

export function PlausibleAnalytics() {
  const { analyticsAllowed } = useCookieConsent();
  if (!analyticsAllowed || !DOMAIN) return null;
  return <Script strategy="afterInteractive" data-domain={DOMAIN} src={SCRIPT_SRC} />;
}
