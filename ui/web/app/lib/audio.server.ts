/**
 * audio.server.ts
 * Audio overviews' thin API module (learning depth, phase 10). Server-side
 * only; every call is scoped by an explicit user id.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { AudioOverview } from "~/lib/audio-types";

const base = "/v1/audio-overviews";

export function createOverview(
  userId: string,
  body: { kb_id?: string; report_id?: string; minutes: number; language: "" | "en" | "vi"; topic?: string },
) {
  return apiFetch<AudioOverview>(base, userId, { method: "POST", body });
}

export function listOverviews(userId: string, filter: { kb_id?: string; report_id?: string }) {
  const query = new URLSearchParams();
  if (filter.kb_id) query.set("kb_id", filter.kb_id);
  if (filter.report_id) query.set("report_id", filter.report_id);
  return apiFetch<{ overviews: AudioOverview[] }>(`${base}?${query}`, userId);
}

/**
 * The list for a page's section, never failing the page: an audio list the
 * API could not produce is news about one section, not about the document
 * list or the report above it.
 */
export async function loadOverviews(userId: string, filter: { kb_id?: string; report_id?: string }): Promise<AudioOverview[]> {
  try {
    return (await listOverviews(userId, filter)).overviews;
  } catch {
    return [];
  }
}

export function getOverview(userId: string, id: string) {
  return apiFetch<AudioOverview>(`${base}/${encodeURIComponent(id)}`, userId);
}

/** "Speak it": the finished script, on the engine the learner chose. */
export function speakOverview(userId: string, id: string, choice: { engine: "builtin" | "byok"; connection_id?: string }) {
  return apiFetch<AudioOverview>(`${base}/${encodeURIComponent(id)}/speak`, userId, { method: "POST", body: choice });
}

export function cancelOverview(userId: string, id: string) {
  return apiFetch<void>(`${base}/${encodeURIComponent(id)}/cancel`, userId, { method: "POST" });
}

export function deleteOverview(userId: string, id: string) {
  return apiFetch<void>(`${base}/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

/** The WAV, streamed through with Range passed both ways so the player can seek. */
export async function fetchOverviewAudio(userId: string, id: string, request: Request): Promise<Response> {
  const forward: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    [USER_ID_HEADER]: userId,
  };
  const range = request.headers.get("Range");
  if (range) forward.Range = range;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${base}/${encodeURIComponent(id)}/audio`, { headers: forward, signal: request.signal });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "Cache-Control"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
