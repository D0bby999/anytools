/**
 * reading.server.ts
 * The reading workspace's thin API module. Server-side only; every call is
 * scoped by an explicit user id, as in kb.server.ts.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Highlight, Note, ReadingAction, Workspace } from "~/lib/reading-types";

const base = (workspaceId: string) => `/v1/reading/${encodeURIComponent(workspaceId)}`;

/** Opens (or returns the existing) workspace for one document. Idempotent. */
export function openWorkspace(userId: string, documentId: string) {
  return apiFetch<Workspace>("/v1/reading/workspaces", userId, {
    method: "POST",
    body: { document_id: documentId },
  });
}

export function saveProgress(userId: string, workspaceId: string, page: number, percent: number) {
  return apiFetch<Workspace>(base(workspaceId), userId, {
    method: "PATCH",
    body: { progress: { page, percent } },
  });
}

export function listHighlights(userId: string, workspaceId: string) {
  return apiFetch<{ highlights: Highlight[] }>(`${base(workspaceId)}/highlights`, userId);
}

export function createHighlight(userId: string, workspaceId: string, body: { page: number; text: string; color?: string }) {
  return apiFetch<Highlight>(`${base(workspaceId)}/highlights`, userId, { method: "POST", body });
}

export function deleteHighlight(userId: string, highlightId: string) {
  return apiFetch<void>(`/v1/reading/highlights/${encodeURIComponent(highlightId)}`, userId, {
    method: "DELETE",
  });
}

export function startReadingAction(
  userId: string,
  workspaceId: string,
  body: { action: ReadingAction; selection: string; page: number; at?: number },
) {
  return apiFetch<{ turn_id: string; session_id: string; status: string; action: string }>(
    `${base(workspaceId)}/actions`,
    userId,
    { method: "POST", body },
  );
}

export function captureNote(
  userId: string,
  workspaceId: string,
  body: { title?: string; body_md: string; page: number; from?: "tutor"; highlight_id?: string },
) {
  return apiFetch<Note>(`${base(workspaceId)}/notes`, userId, { method: "POST", body });
}

/**
 * Streams the original uploaded file through this process.
 *
 * Not apiFetch: that parses JSON. The bytes, the conditional-request headers
 * and the API's own safety headers (nosniff, `Content-Security-Policy:
 * sandbox`, inline disposition) all pass through unchanged — this process adds
 * nothing and removes nothing but the gateway bearer.
 */
export async function fetchWorkspaceFile(userId: string, workspaceId: string, request: Request): Promise<Response> {
  const forward: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    [USER_ID_HEADER]: userId,
  };
  for (const name of ["If-None-Match", "If-Modified-Since", "Range"]) {
    const value = request.headers.get(name);
    if (value) forward[name] = value;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${base(workspaceId)}/file`, { headers: forward, signal: request.signal });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }

  const headers = new Headers();
  for (const name of [
    "Content-Type",
    "Content-Length",
    "Content-Range",
    "Accept-Ranges",
    "ETag",
    "Last-Modified",
    "Cache-Control",
    "Content-Disposition",
    "Content-Security-Policy",
    "X-Content-Type-Options",
  ]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

/** "Draw it" on a selection: the diagram is appended to the workspace's conversation. */
export function drawSelection(userId: string, workspaceId: string, selection: string) {
  return apiFetch<{ message: { id: string } }>(`/v1/reading/${encodeURIComponent(workspaceId)}/diagram`, userId, {
    method: "POST",
    body: { selection },
  });
}

/** The largest read-aloud request: a 30-second take (4 MB) and its passage. */
export const MAX_SPEAKING_REQUEST = 4 * 1024 * 1024 + 64 * 1024;

/**
 * The read-aloud check (plans/261020-1155-open-source-adds, phase 2): one
 * take and the passage it reads, forwarded as a multipart form, as
 * uploadRecording does. The API checks the passage against the stored page;
 * its answer, or its translated error, comes back as it is.
 */
export async function checkReadingAloud(
  userId: string,
  workspaceId: string,
  page: number,
  text: string,
  audio: File,
): Promise<Response> {
  const body = new FormData();
  body.set("workspace_id", workspaceId);
  body.set("page", String(page));
  body.set("text", text);
  body.set("audio", audio, audio.name || "take");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/speaking/check`, {
      method: "POST",
      headers: { ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), [USER_ID_HEADER]: userId },
      body,
    });
  } catch {
    return Response.json({ error: "The API could not be reached." }, { status: 503 });
  }
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}
