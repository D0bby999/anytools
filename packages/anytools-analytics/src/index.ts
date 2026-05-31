/**
 * Lightweight analytics wrappers for Plausible + GA4.
 * Both are optional — they no-op when env vars are missing.
 * Components live in apps/anytools-web/src/components since they're client React.
 */

export type EventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: EventProps }) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, props?: EventProps): void {
  if (typeof window === 'undefined') return;
  try {
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
