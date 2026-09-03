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

    function register() {
      // `updateViaCache: 'none'` — the default ('imports') lets the browser's HTTP cache
      // serve sw-policy.js/sw-lib.js/sw-trim.js (fetched via `importScripts`) with whatever
      // freshness those files' own response headers say, independently of sw.js's own byte
      // comparison on update. On an origin sitting behind a CDN that caches `.js` responses,
      // a fixed private-path regex could ship in sw-policy.js while a stale cached copy of it
      // keeps running on returning visitors (review finding #10).
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .catch((error: unknown) => {
          console.error('[sw] registration failed', error);
        });
    }

    // A `controllerchange` fires when a new SW takes control of this page (this app's own
    // `activate` never calls `clients.claim()`, so in practice that means this tab's very
    // first load after the SW registers — see sw.js's `activate` handler comment). No
    // reload-on-controllerchange here on purpose: forcing one would fight that same
    // deliberate "no claim" trade-off. Listening anyway keeps this a documented no-op instead
    // of an unhandled event (review finding #19).
    function handleControllerChange() {
      // Intentionally empty — see comment above.
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Register after the page has finished loading, not immediately on mount, so the
    // service worker's install-time precache fetches (see sw-lib.js's `runInstall`) do not
    // compete with the page's own first-load resources for bandwidth (review finding #19).
    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register);
    }

    return () => {
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}
