/**
 * push.server.ts
 * Settings → Reminders' thin API module: the daily review reminder.
 * Server-side only: every function takes the session's user id and hands it
 * to apiFetch.
 */
import { apiFetch } from "~/lib/api.server";

/** GET /v1/push: the server's VAPID key, the learner's hour and zone, and their subscribed browsers. */
export type PushSettings = {
  public_key: string;
  hour: number;
  timezone: string;
  endpoints: string[];
};

/** PushSubscription.toJSON(), as the browser makes it. */
export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function getPush(userId: string) {
  return apiFetch<PushSettings>("/v1/push", userId);
}

export function setReminderHour(userId: string, hour: number) {
  return apiFetch<{ hour: number }>("/v1/push/settings", userId, { method: "PUT", body: { hour } });
}

export function subscribePush(userId: string, subscription: BrowserSubscription) {
  return apiFetch<void>("/v1/push/subscriptions", userId, { method: "POST", body: subscription });
}

export function unsubscribePush(userId: string, endpoint: string) {
  return apiFetch<void>("/v1/push/subscriptions", userId, { method: "DELETE", body: { endpoint } });
}

export function testPush(userId: string) {
  return apiFetch<{ sent: number }>("/v1/push/test", userId, { method: "POST" });
}

/** A browser's subscription from the form field the panel posts, or null when it is not one. */
export function parseSubscription(raw: unknown): BrowserSubscription | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const v = JSON.parse(raw) as Partial<BrowserSubscription>;
    if (typeof v.endpoint !== "string" || typeof v.keys?.p256dh !== "string" || typeof v.keys?.auth !== "string") return null;
    return { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } };
  } catch {
    return null;
  }
}
