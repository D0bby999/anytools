/**
 * profile.server.ts
 * The learner profile's thin API module. Server-side only; every call is
 * scoped by an explicit user id, as in vocab.server.ts. Nothing here calls a
 * model.
 */
import { apiFetch } from "~/lib/api.server";
import type { Profile, ProfileEntry, Section } from "~/lib/profile-types";

export function getProfile(userId: string) {
  return apiFetch<Profile>("/v1/profile", userId);
}

export function addEntry(userId: string, body: { section: Section; text: string; kb_id?: string }) {
  return apiFetch<ProfileEntry>("/v1/profile/entries", userId, { method: "POST", body });
}

/** kb_id "" clears the entry's knowledge base; absent leaves it. */
export function editEntry(userId: string, id: string, body: { section?: Section; text?: string; kb_id?: string }) {
  return apiFetch<ProfileEntry>(`/v1/profile/entries/${encodeURIComponent(id)}`, userId, { method: "PATCH", body });
}

export function deleteEntry(userId: string, id: string) {
  return apiFetch<void>(`/v1/profile/entries/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

export function decideProposal(userId: string, id: string, decision: "accept" | "reject") {
  return apiFetch<ProfileEntry>(`/v1/profile/entries/${encodeURIComponent(id)}/${decision}`, userId, {
    method: "POST",
  });
}

export function clearProfile(userId: string) {
  return apiFetch<{ removed: number }>("/v1/profile", userId, { method: "DELETE" });
}

export function setConsolidation(userId: string, consolidation: boolean) {
  return apiFetch<{ consolidation: boolean }>("/v1/profile/settings", userId, {
    method: "PUT",
    body: { consolidation },
  });
}
