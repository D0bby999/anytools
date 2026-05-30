'use client';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import Script from 'next/script';
import { useEffect, useRef } from 'react';

type AdFormat = 'auto' | 'rectangle' | 'horizontal' | 'vertical';

type AdSlotProps = {
  slotId: string;
  format?: AdFormat;
  className?: string;
};

declare global {
  interface Window {
    adsbygoogle?: object[];
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

// Reserve vertical space to prevent CLS when ad loads.
// Heights match Google AdSense recommended responsive minimums.
const MIN_HEIGHT: Record<AdFormat, string> = {
  horizontal: '90px',
  rectangle: '250px',
  vertical: '600px',
  auto: '250px',
};

export function AdSlot({ slotId, format = 'auto', className }: AdSlotProps) {
  const { adsAllowed } = useCookieConsent();
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!adsAllowed || !CLIENT_ID || pushedRef.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushedRef.current = true;
    } catch {
      // AdSense not yet loaded — Script onLoad will retry implicitly via push order
    }
  }, [adsAllowed]);

  // If AdSense not configured at all, render nothing (clean dev/pre-approval UX).
  if (!CLIENT_ID) return null;

  // Reserve space even when consent denied so toggling consent does not jump layout.
  const reservedStyle = { minHeight: MIN_HEIGHT[format] };

  if (!adsAllowed) {
    return <div className={className} style={reservedStyle} aria-hidden="true" />;
  }

  return (
    <>
      <Script
        id={`adsense-${slotId}`}
        async
        strategy="afterInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT_ID}`}
        crossOrigin="anonymous"
      />
      <ins
        className={`adsbygoogle block ${className ?? ''}`}
        style={{ display: 'block', ...reservedStyle }}
        data-ad-client={CLIENT_ID}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </>
  );
}
