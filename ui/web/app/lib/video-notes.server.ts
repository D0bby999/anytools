/**
 * video-notes.server.ts
 * A video's study notes: the thin API module. Server-side only; every call is
 * scoped by an explicit user id.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { VideoNotes } from "~/lib/video-notes-types";

const notes = (docId: string) => `/v1/documents/${encodeURIComponent(docId)}/study-notes`;

export function listVideoNotes(userId: string, docId: string) {
  return apiFetch<{ notes: VideoNotes[] }>(notes(docId), userId).then((r) => r.notes);
}

/** One model call on the learner's reading route. */
export function generateVideoNotes(userId: string, docId: string, language: string) {
  return apiFetch<VideoNotes>(notes(docId), userId, { method: "POST", body: { language } });
}

/** The notes as a Markdown file, streamed through with the API's download headers. */
export async function exportVideoNotes(userId: string, docId: string, language: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${notes(docId)}/export?language=${encodeURIComponent(language)}`, {
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        [USER_ID_HEADER]: userId,
      },
    });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Disposition", "Content-Length"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
