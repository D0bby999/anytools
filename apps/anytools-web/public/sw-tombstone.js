/**
 * Rollback artefact for the AnyTools service worker.
 *
 * Deleting or emptying public/sw.js does NOT remove a service worker already installed on
 * a visitor's machine — a service worker keeps controlling its scope until it is replaced
 * by a new worker or explicitly unregisters itself. If sw.js ever needs to come off prod
 * (a caching bug serving stale/wrong content, a quota issue, anything), the rollback is:
 *
 *   1. Copy this file's contents over public/sw.js (do not delete sw.js — the URL must
 *      keep resolving so browsers can fetch the replacement worker).
 *   2. Deploy.
 *   3. Keep it in place for AT LEAST 30 days — a visitor only receives this tombstone the
 *      next time their browser checks for an SW update (up to 24h after their last visit,
 *      by spec, but in practice only on their next actual visit), so shipping the real
 *      sw.js again too soon would strand visitors who have not picked up the tombstone yet.
 *
 * This worker unregisters itself, clears every cache this app created, and forces every
 * open tab back onto the network for its next load.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (let i = 0; i < keys.length; i++) {
        await caches.delete(keys[i]);
      }
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (let j = 0; j < clients.length; j++) {
        clients[j].navigate(clients[j].url);
      }
    })(),
  );
});
