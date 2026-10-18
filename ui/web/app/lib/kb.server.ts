/**
 * kb.server.ts
 * The Knowledge Center's thin API module. Server-side only.
 *
 * Every function takes the user id explicitly and hands it to apiFetch, which
 * is the one place the gateway bearer and the user header are attached. There
 * is deliberately no cached client and no ambient "current user": the failure
 * this shape prevents is a loader that forgets to scope a request, which is not
 * expressible when the id is a required argument.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import type { Feed } from "~/lib/feeds-types";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type {
  DocumentContent,
  DocumentView,
  KB,
  KBDocument,
  KBSummary,
  Hit,
} from "~/lib/kb-types";

export function listKBs(userId: string) {
  return apiFetch<{ knowledge_bases: KBSummary[] }>("/v1/kb", userId);
}

export function createKB(userId: string, name: string) {
  return apiFetch<KB>("/v1/kb", userId, { method: "POST", body: { name } });
}

export function getKB(userId: string, kbId: string) {
  return apiFetch<KB>(`/v1/kb/${encodeURIComponent(kbId)}`, userId);
}

export function deleteKB(userId: string, kbId: string) {
  return apiFetch<void>(`/v1/kb/${encodeURIComponent(kbId)}`, userId, { method: "DELETE" });
}

export function listDocuments(userId: string, kbId: string) {
  return apiFetch<{ documents: KBDocument[] }>(
    `/v1/kb/${encodeURIComponent(kbId)}/documents`,
    userId,
  );
}

export function deleteDocument(userId: string, kbId: string, docId: string) {
  return apiFetch<void>(
    `/v1/kb/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    userId,
    { method: "DELETE" },
  );
}

export function reindexKB(userId: string, kbId: string) {
  return apiFetch<{ job_id: string }>(`/v1/kb/${encodeURIComponent(kbId)}/reindex`, userId, {
    method: "POST",
    body: {},
  });
}

export function queryKB(userId: string, kbId: string, query: string) {
  return apiFetch<{ hits: Hit[] }>(`/v1/kb/${encodeURIComponent(kbId)}/query`, userId, {
    method: "POST",
    body: { query },
  });
}

export function documentContent(userId: string, docId: string, page?: number) {
  const suffix = page && page > 0 ? `?page=${page}` : "";
  return apiFetch<DocumentContent>(
    `/v1/documents/${encodeURIComponent(docId)}/content${suffix}`,
    userId,
  );
}

/**
 * uploadDocument forwards a multipart body straight through.
 *
 * It does NOT use apiFetch: that helper sets Content-Type: application/json and
 * serialises its body, both of which would destroy a multipart part boundary.
 * Streaming the browser's own FormData through avoids buffering a 50 MB file in
 * this process only to re-encode it.
 */
export async function uploadDocument(
  userId: string,
  kbId: string,
  file: File,
): Promise<{ status: number; error?: string; code?: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  return postUpload(userId, kbId, body);
}

/**
 * Several photos as ONE document, one page per photo in this order
 * (up-methods phase 16): every photo is a "file" part, and one_document says
 * they belong together.
 */
export async function uploadPhotos(
  userId: string,
  kbId: string,
  files: File[],
): Promise<{ status: number; error?: string; code?: string }> {
  const body = new FormData();
  body.set("one_document", "true");
  for (const file of files) body.append("file", file, file.name);
  return postUpload(userId, kbId, body);
}

async function postUpload(userId: string, kbId: string, body: FormData): Promise<{ status: number; error?: string; code?: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/kb/${encodeURIComponent(kbId)}/documents`, {
      method: "POST",
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        "X-AnyTools-User-Id": userId,
      },
      body,
    });
  } catch {
    return { status: 503, error: "The API could not be reached." };
  }

  if (res.ok) return { status: res.status };

  // The API's message is written for a person and carries no internals — see
  // kbapi.fail, which logs the cause and returns a sentence.
  const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { status: res.status, error: payload.error, code: payload.code };
}

/** The largest upload request the API accepts: a 500 MB recording plus multipart framing. */
export const MAX_UPLOAD_REQUEST = 500 * 1024 * 1024 + 1024 * 1024;

/**
 * streamUpload pipes the browser's multipart body to the API as it arrives
 * (up-methods phase 15). `request.formData()` would hold a 500 MB recording
 * in this process before sending a byte of it; here nothing is buffered. The
 * body is the browser's own, so its boundary and its parts reach the API
 * unchanged; the API reads the part named "file" and skips any other
 * (kbapi.readFilePart), and caps the file by its name and its bytes.
 */
export async function streamUpload(
  userId: string,
  kbId: string,
  request: Request,
): Promise<{ status: number; error?: string; code?: string }> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data") || !request.body) {
    return { status: 400, error: "Send the file as multipart/form-data." };
  }
  const length = Number(request.headers.get("Content-Length") ?? "");
  if (Number.isFinite(length) && length > MAX_UPLOAD_REQUEST) {
    return { status: 413, error: "Audio and video files must be 500 MB or smaller; documents 50 MB." };
  }
  const headers: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    "X-AnyTools-User-Id": userId,
    "Content-Type": type,
  };
  if (Number.isFinite(length) && length > 0) headers["Content-Length"] = String(length);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/kb/${encodeURIComponent(kbId)}/documents`, {
      method: "POST",
      headers,
      body: request.body,
      // Node's fetch sends a stream only half-duplex.
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" });
  } catch {
    return { status: 503, error: "The API could not be reached." };
  }
  if (res.ok) return { status: res.status };
  const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { status: res.status, error: payload.error, code: payload.code };
}

/** A recording, streamed from the API with the player's Range header (phase 15). */
export async function fetchRecording(userId: string, docId: string, request: Request): Promise<Response> {
  const forward: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    "X-AnyTools-User-Id": userId,
  };
  for (const name of ["Range", "If-Range", "If-None-Match", "If-Modified-Since"]) {
    const value = request.headers.get(name);
    if (value) forward[name] = value;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/documents/${encodeURIComponent(docId)}/media`, {
      headers: forward,
      signal: request.signal,
    });
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

/** Stop a running transcription after the window in flight (phase 15). */
export function cancelTranscription(userId: string, docId: string) {
  return apiFetch<void>(`/v1/documents/${encodeURIComponent(docId)}/transcribe/cancel`, userId, { method: "POST" });
}

// ── links (learning-depth phase 4) ──────────────────────────────────────────

export function addLink(userId: string, kbId: string, url: string, autoSync: boolean) {
  // A podcast feed or a YouTube playlist or channel answers a feed instead
  // of a document (up-methods phase 17).
  return apiFetch<{ document?: KBDocument; feed?: Feed; job_id?: string }>(
    `/v1/kb/${encodeURIComponent(kbId)}/links`,
    userId,
    { method: "POST", body: { url, auto_sync: autoSync } },
  );
}

export function getDocument(userId: string, docId: string) {
  return apiFetch<DocumentView>(`/v1/documents/${encodeURIComponent(docId)}`, userId);
}

export function setAutoSync(userId: string, docId: string, autoSync: boolean) {
  return apiFetch<{ document: KBDocument }>(`/v1/documents/${encodeURIComponent(docId)}`, userId, {
    method: "PATCH",
    body: { auto_sync: autoSync },
  });
}

export function resyncDocument(userId: string, docId: string) {
  return apiFetch<{ document: KBDocument; changed: boolean }>(
    `/v1/documents/${encodeURIComponent(docId)}/resync`,
    userId,
    { method: "POST", body: {} },
  );
}

/** A pasted transcript, or another caption track by language code. */
export function setTranscript(userId: string, docId: string, body: { text: string } | { track: string }) {
  return apiFetch<{ document: KBDocument }>(`/v1/documents/${encodeURIComponent(docId)}/transcript`, userId, {
    method: "POST",
    body,
  });
}

/** The engine the learner chose; none is Gemini reading the URL, as before phase 21. */
export type TranscribeChoice = { engine: string; connection_id?: string; confirm_unknown_length?: boolean };

export function startTranscription(userId: string, docId: string, choice?: TranscribeChoice) {
  return apiFetch<{ job_id: string; engine?: string; queue_ahead?: number }>(
    `/v1/documents/${encodeURIComponent(docId)}/transcribe`,
    userId,
    { method: "POST", body: choice ?? {} },
  );
}

/** A .vtt or .srt file, forwarded as multipart for the same reason as uploadDocument. */
export async function uploadTranscript(
  userId: string,
  docId: string,
  file: File,
): Promise<{ status: number; error?: string; code?: string }> {
  const body = new FormData();
  body.set("file", file, file.name);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/documents/${encodeURIComponent(docId)}/transcript`, {
      method: "POST",
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        "X-AnyTools-User-Id": userId,
      },
      body,
    });
  } catch {
    return { status: 503, error: "The API could not be reached." };
  }
  if (res.ok) return { status: res.status };
  const payload = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  return { status: res.status, error: payload.error, code: payload.code };
}

/**
 * Page `page`'s photo of a photo document (up-methods phase 16), streamed
 * through with the API's own headers, as fetchWorkspaceFile streams a PDF.
 */
export async function fetchDocumentPhoto(userId: string, docId: string, page: string, request: Request): Promise<Response> {
  const forward: Record<string, string> = {
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
    [USER_ID_HEADER]: userId,
  };
  const match = request.headers.get("If-None-Match");
  if (match) forward["If-None-Match"] = match;

  let res: Response;
  try {
    res = await fetch(
      `${API_BASE}/v1/documents/${encodeURIComponent(docId)}/photo?page=${encodeURIComponent(page)}`,
      { headers: forward, signal: request.signal },
    );
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers();
  for (const name of [
    "Content-Type",
    "Content-Length",
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
  return new Response(res.ok || res.status === 304 ? res.body : null, { status: res.status, headers });
}
