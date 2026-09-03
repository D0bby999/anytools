'use client';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import Script from 'next/script';

// Umami is cookieless, but anytools keeps its existing consent gate so analytics only fires
// after the visitor accepts. Self-hosted on our own server — no third-party data sharing.
// Renders nothing until the production Umami env vars are set.
//   NEXT_PUBLIC_UMAMI_SRC        e.g. https://stats.besttoys.world/script.js
//   NEXT_PUBLIC_UMAMI_WEBSITE_ID the website UUID from the Umami dashboard
const SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
const WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export function UmamiAnalytics() {
  const { analyticsAllowed } = useCookieConsent();
  if (IS_SELF_HOSTED) return null;
  if (!analyticsAllowed || !SRC || !WEBSITE_ID) return null;
  return <Script strategy="afterInteractive" src={SRC} data-website-id={WEBSITE_ID} />;
}
