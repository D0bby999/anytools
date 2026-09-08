'use client';
import { useCookieConsent } from '@/hooks/use-cookie-consent';
import { ADSENSE_CLIENT_ID, AD_SLOT_IDS } from '@/lib/adsense';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';
import { useEffect, useRef } from 'react';

type AdFormat = 'auto' | 'rectangle' | 'horizontal' | 'vertical';

type AdSlotProps = {
  /** Placement name — a key of AD_SLOT_IDS, not the numeric ID Google issues. */
  slotId: string;
  format?: AdFormat;
  className?: string;
};

declare global {
  interface Window {
    adsbygoogle?: object[];
  }
}

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
  // Placement name → the numeric unit ID from the dashboard. Undefined until the
  // account is approved and adsense.ts is filled in; see the comment on AD_SLOT_IDS
  // for why an <ins> with a non-numeric slot must never reach the page.
  const numericSlot = AD_SLOT_IDS[slotId];
  const active = !IS_SELF_HOSTED && Boolean(numericSlot);

  useEffect(() => {
    if (!active || !adsAllowed || pushedRef.current) return;
    try {
      // The loader itself is <AdSenseScript> in the root layout, already in the
      // server-rendered <head>; this only queues the unit for it to fill.
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      pushedRef.current = true;
    } catch {
      // Loader not parsed yet — it drains the queue on load, so the push order holds.
    }
  }, [active, adsAllowed]);

  // No unit configured (pre-approval) or self-host build: render nothing at all, not
  // even reserved space, so pages look finished rather than gap-ridden.
  if (!active) return null;

  // Reserve space even when consent denied so toggling consent does not jump layout.
  const reservedStyle = { minHeight: MIN_HEIGHT[format] };

  if (!adsAllowed) {
    return <div className={className} style={reservedStyle} aria-hidden="true" />;
  }

  return (
    <ins
      className={`adsbygoogle block ${className ?? ''}`}
      style={{ display: 'block', ...reservedStyle }}
      data-ad-client={ADSENSE_CLIENT_ID}
      data-ad-slot={numericSlot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
