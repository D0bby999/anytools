/**
 * gcal.server.ts
 * The study calendar written into Google Calendar (learning-tool-connections
 * phase 3).
 */
import { apiFetch } from "~/lib/api.server";
import type { GCalLink } from "~/lib/calendar-types";

export function gcalStatus(userId: string) {
  return apiFetch<{ link: GCalLink | null }>("/v1/gcal", userId);
}

export function gcalEnable(userId: string) {
  return apiFetch<{ link: GCalLink | null }>("/v1/gcal/enable", userId, { method: "POST", body: {} });
}

export function gcalSync(userId: string) {
  return apiFetch<{ link: GCalLink | null }>("/v1/gcal/sync", userId, { method: "POST", body: {} });
}

export function gcalDisable(userId: string, remove: boolean) {
  return apiFetch<{ link: null }>("/v1/gcal/disable", userId, { method: "POST", body: { remove } });
}
