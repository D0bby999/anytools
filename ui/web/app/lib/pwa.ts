/**
 * pwa.ts
 * AnyLearn as an installable web app: the manifest links, the service worker,
 * and what the browser can do about installing and reminders.
 *
 * Only the study app's shells link the manifest (app-layout, auth-layout).
 * The tools pages are AnyTools' site, and installing one of them as
 * "AnyLearn" would be the wrong app.
 */
import { useEffect } from "react";

/** The manifest and the icon iOS uses for a Home Screen web app. */
export const PWA_LINKS = [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
];

/** Chromium's install prompt, held until the learner asks for it. */
export type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let installPrompt: InstallPrompt | null = null;

/** The install prompt Chromium offered on this page load, if any (never on iOS). */
export function pendingInstallPrompt(): InstallPrompt | null {
  return installPrompt;
}

/** Forgets the prompt once used: Chromium allows one prompt() per event. */
export function clearInstallPrompt() {
  installPrompt = null;
}

/**
 * Registers /sw.js once per page load (it caches nothing; public/sw.js), and
 * keeps Chromium's install prompt for Settings → Reminders instead of letting
 * the browser show its own mini-infobar.
 */
export function useServiceWorker() {
  useEffect(() => {
    const keep = (e: Event) => {
      e.preventDefault();
      installPrompt = e as InstallPrompt;
    };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // A browser that refuses (private mode, an old engine) still has the
      // whole app; only reminders are unavailable, and Settings says so.
    });
  }, []);
}

/** iPhone and iPad, including iPadOS reporting itself as a Mac. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Running as an installed app rather than in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Whether this browser can receive a push at all. On iOS that needs the app
 * on the Home Screen first: Safari in a tab has no PushManager.
 */
export function pushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** The VAPID public key, base64url, as PushManager.subscribe wants it. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "===".slice((base64url.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
