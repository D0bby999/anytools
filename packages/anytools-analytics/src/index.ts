/**
 * Lightweight analytics wrappers for Umami (what the site loads), plus Plausible/GA4 if present.
 * All are optional — they no-op when the corresponding script is not on the page.
 * Components live in apps/anytools-web/src/components since they're client React.
 */

export type EventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: EventProps }) => void;
    gtag?: (...args: unknown[]) => void;
    // Umami is what the site actually loads (NEXT_PUBLIC_UMAMI_*); until 2026-09-03 this
    // wrapper only knew Plausible/GA4, so every trackEvent call was a silent no-op in prod.
    umami?: { track: (event: string, data?: EventProps) => void };
  }
}

export function trackEvent(name: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  try {
    window.umami?.track(name, props);
    window.plausible?.(name, props ? { props } : undefined);
    window.gtag?.('event', name, props);
  } catch {
    // analytics never breaks the app
  }
}

export function trackPageview(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.plausible?.('pageview', { props: { path } });
    window.gtag?.('event', 'page_view', { page_path: path });
  } catch {
    // ignore
  }
}
