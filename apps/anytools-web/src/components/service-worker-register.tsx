'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js at root scope. Runs in BOTH the hosted build and the self-host build —
 * unlike phase 1-4's "prod stays byte-identical" constraint, PWA/offline is a change this
 * plan deliberately ships to prod hosted too (plan.md Goal 5). Guarded to
 * `NODE_ENV === 'production'` only: `next dev` and `next build` share the same `.next/`
 * output directory, and a service worker installed while iterating locally would otherwise
 * keep intercepting requests with a stale build after every `next dev` restart.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.error('[sw] registration failed', error);
    });
  }, []);

  return null;
}
