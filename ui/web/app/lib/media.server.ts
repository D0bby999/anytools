/**
 * media.server.ts
 * YouTube playlists and Google Photos (learning-tool-connections phase 7).
 */
import { apiFetch } from "~/lib/api.server";
import type { PhotoSession, Playlist } from "~/lib/media-types";

export function previewPlaylist(userId: string, url: string) {
  return apiFetch<Playlist>("/v1/playlists/preview", userId, { method: "POST", body: { url } });
}

export function addPlaylist(userId: string, kbId: string, url: string, videoIds: string[]) {
  return apiFetch<{ kb_id: string; added: number; failed: number; title: string }>(
    `/v1/kb/${encodeURIComponent(kbId)}/playlist`,
    userId,
    { method: "POST", body: { url, video_ids: videoIds } },
  );
}

export function startPhotos(userId: string) {
  return apiFetch<PhotoSession>("/v1/photos/sessions", userId, { method: "POST", body: {} });
}

export function pollPhotos(userId: string, sessionId: string) {
  return apiFetch<PhotoSession>(`/v1/photos/sessions/${encodeURIComponent(sessionId)}`, userId);
}

export function takePhotos(userId: string, kbId: string, sessionId: string) {
  return apiFetch<{ document_id: string; photos: number; kb_id: string }>(
    `/v1/kb/${encodeURIComponent(kbId)}/photos/google`,
    userId,
    { method: "POST", body: { session_id: sessionId } },
  );
}
