/*
 * AnyLearn's service worker. It does two things and caches nothing: it shows
 * the review reminder a push brings, and opens the page the reminder names
 * when it is tapped. Caching pages here would serve a learner yesterday's
 * Due list, so every request still goes to the network as it would without
 * a worker.
 *
 * The push payload is Declarative Web Push JSON (internal/push/message.go):
 * Safari 18.4+ shows it without running this file; other browsers run this.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let n = {};
  try {
    n = event.data ? event.data.json().notification || {} : {};
  } catch {
    // Not JSON: nothing this server sends. Show nothing rather than garbage.
    return;
  }
  if (!n.title) return;
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body || "",
      tag: n.tag,
      lang: n.lang,
      dir: n.dir,
      icon: "/icons/anylearn-192.png",
      badge: "/icons/anylearn-192.png",
      data: { navigate: n.navigate || "/home" },
    }),
  );
  if (n.app_badge && self.navigator.setAppBadge) {
    self.navigator.setAppBadge(Number(n.app_badge)).catch(() => {});
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only this origin's pages: the payload comes from our server, but a tap
  // must never become an open redirect if it ever did not.
  const target = new URL(event.notification.data?.navigate || "/home", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      // navigate() refuses a window this worker does not control yet (one
      // opened before it was installed); a new window still gets there.
      return open
        .focus()
        .then(() => open.navigate(url))
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
