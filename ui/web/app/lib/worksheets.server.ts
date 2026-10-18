/**
 * worksheets.server.ts
 * up's worksheets: the thin API module. Server-side only; every call is scoped
 * by an explicit user id.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { CycleCloses } from "~/lib/cycle-close";
import type {
  DueReview,
  Worksheet,
  WorksheetDetail,
  WorksheetKind,
  WorksheetSummary,
  WritingDiagnosis,
} from "~/lib/worksheet-types";

const one = (id: string) => `/v1/worksheets/${encodeURIComponent(id)}`;

export function listKinds(userId: string) {
  return apiFetch<{ kinds: WorksheetKind[] }>("/v1/worksheet-kinds", userId).then((r) => r.kinds);
}

export function listWorksheets(userId: string, filter: { kind?: string; stateId?: string; documentId?: string } = {}) {
  const params = new URLSearchParams();
  if (filter.kind) params.set("kind", filter.kind);
  if (filter.stateId) params.set("state_id", filter.stateId);
  if (filter.documentId) params.set("document_id", filter.documentId);
  const qs = params.toString();
  return apiFetch<{ worksheets: WorksheetSummary[] }>(`/v1/worksheets${qs ? `?${qs}` : ""}`, userId).then(
    (r) => r.worksheets,
  );
}

export function createWorksheet(
  userId: string,
  body: { kind: string; title: string; state_id?: string; document_id?: string; cycle_id?: string },
) {
  return apiFetch<Worksheet>("/v1/worksheets", userId, { method: "POST", body });
}

export function getWorksheet(userId: string, id: string) {
  return apiFetch<WorksheetDetail>(one(id), userId);
}

/** One section per call, carrying the revision the page loaded. */
export function patchWorksheet(
  userId: string,
  id: string,
  body: {
    revision: string;
    title?: string;
    status?: "open" | "done";
    answers?: Record<string, unknown>;
    reviews?: Record<string, { due?: string; done?: boolean }>;
  },
) {
  return apiFetch<Worksheet>(one(id), userId, { method: "PATCH", body });
}

/** A server-side row append: no revision, capped by the table's rows. */
export function appendRow(userId: string, id: string, body: { section: string; field: string; row: unknown }) {
  return apiFetch<Worksheet>(`${one(id)}/rows`, userId, { method: "POST", body });
}

export function deleteWorksheet(userId: string, id: string) {
  return apiFetch<void>(one(id), userId, { method: "DELETE" });
}

/** One revision pass of a writing evidence card, diagnosed on the learner's chat model. */
export function diagnose(userId: string, id: string, pass: number) {
  return apiFetch<WritingDiagnosis>(`${one(id)}/diagnose`, userId, { method: "POST", body: { pass } });
}

/** A writing evidence card's diagnoses of its current draft. */
export function listDiagnoses(userId: string, id: string) {
  return apiFetch<{ diagnoses: WritingDiagnosis[] }>(`${one(id)}/diagnoses`, userId).then((r) => r.diagnoses);
}

/** A cycle's own close and the previous cycle's close (up methods, phase 10). */
export function cycleCloses(userId: string, cycleId: string) {
  return apiFetch<CycleCloses>(`/v1/cycles/${encodeURIComponent(cycleId)}/close`, userId);
}

/** Reviews due on the learner's local day or earlier, open worksheets only. */
export function dueWorksheets(userId: string) {
  return apiFetch<{ due: DueReview[]; count: number }>("/v1/worksheets/due", userId);
}

/** The worksheet as a Markdown file, streamed through with the API's download headers. */
export async function exportWorksheet(userId: string, id: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${one(id)}/export`, {
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

// ── Recordings (up-methods phase 7) ─────────────────────────────────────────

/** The API's bound on one upload's body: a 10 MB take and its form fields. */
export const MAX_RECORDING_REQUEST = 10 * 1024 * 1024 + 64 * 1024;

function forwardHeaders(userId: string): Record<string, string> {
  return { ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), [USER_ID_HEADER]: userId };
}

/**
 * Forwards one take as a multipart form, as uploadDocument does: not through
 * apiFetch, which would serialise the body as JSON. The API sniffs the bytes
 * and checks the declared type, the duration, the cap and the quota; its
 * answer is passed back as it is.
 */
export async function uploadRecording(userId: string, id: string, audio: File, durationSeconds: string): Promise<Response> {
  const body = new FormData();
  body.set("duration_seconds", durationSeconds);
  body.set("audio", audio, audio.name || "recording");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${one(id)}/recordings`, { method: "POST", headers: forwardHeaders(userId), body });
  } catch {
    return Response.json({ error: "The API could not be reached." }, { status: 503 });
  }
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

/** One take, streamed through with Range passed both ways so a player can seek. */
export async function fetchRecording(userId: string, id: string, rid: string, request: Request): Promise<Response> {
  const forward = forwardHeaders(userId);
  const range = request.headers.get("Range");
  if (range) forward.Range = range;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${one(id)}/recordings/${encodeURIComponent(rid)}`, {
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
    "Last-Modified",
    "Cache-Control",
    "Content-Disposition",
    "X-Content-Type-Options",
  ]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}

export function deleteRecording(userId: string, id: string, rid: string) {
  return apiFetch<void>(`${one(id)}/recordings/${encodeURIComponent(rid)}`, userId, { method: "DELETE" });
}
