import { useEffect, useState } from 'react';

/**
 * The current time, but only once the widget is running in the browser.
 *
 * Tool pages are prerendered at build time. A widget that reads `new Date()` during render
 * bakes the build machine's clock into the HTML, and React then finds different text on the
 * client and throws hydration error #418 on every visit (age, sleep and time-zone tools,
 * measured 2026-09-05 on the production build). Returning null for the server render and the
 * first client render, then the real clock from an effect, keeps both renders identical.
 */
export function useClientNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
  }, []);
  return now;
}
