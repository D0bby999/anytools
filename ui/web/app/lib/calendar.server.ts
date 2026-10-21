/**
 * calendar.server.ts
 * The study calendar feed (learning-tool-connections phase 2): the learner's
 * feed settings, and the raw read a calendar app's GET of /cal/<token>.ics
 * becomes. That read carries no user: the token picks the feed, and the API
 * takes it only with the gateway bearer (a gateway-only route).
 */
import { apiFetch } from "~/lib/api.server";
import { API_BASE, API_TOKEN, APP_URL } from "~/lib/env.server";
import type { CalendarFeed, CalendarInclude } from "~/lib/calendar-types";

export function getCalendarFeed(userId: string) {
  return apiFetch<CalendarFeed>("/v1/calendar/feed", userId);
}

export function updateCalendarFeed(userId: string, named: boolean, include: CalendarInclude) {
  return apiFetch<CalendarFeed>("/v1/calendar/feed", userId, { method: "PUT", body: { named, include } });
}

export function rotateCalendarFeed(userId: string) {
  return apiFetch<CalendarFeed>("/v1/calendar/feed/rotate", userId, { method: "POST", body: {} });
}

/** The feed's public URL. */
export function calendarFeedURL(token: string): string {
  return `${APP_URL}/cal/${token}.ics`;
}

/** The feed itself, or null for a token that matches none. */
export async function readCalendarFeed(token: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/v1/calendar/feed/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}) },
    body: JSON.stringify({ token }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Response("Calendar unavailable", { status: 503 });
  return res.text();
}
