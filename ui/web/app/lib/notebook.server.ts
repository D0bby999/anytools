/**
 * notebook.server.ts
 * The notebook's thin API module. Server-side only; every call is scoped by an
 * explicit user id, as in kb.server.ts.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Category, Note, Notebook } from "~/lib/reading-types";

const nb = (id: string) => `/v1/notebooks/${encodeURIComponent(id)}`;
const note = (id: string) => `/v1/notes/${encodeURIComponent(id)}`;

export function listNotebooks(userId: string) {
  return apiFetch<{ notebooks: Notebook[] }>("/v1/notebooks", userId);
}

export function createNotebook(userId: string, name: string) {
  return apiFetch<Notebook>("/v1/notebooks", userId, { method: "POST", body: { name } });
}

export function getNotebook(userId: string, id: string) {
  return apiFetch<Notebook>(nb(id), userId);
}

export function renameNotebook(userId: string, id: string, name: string) {
  return apiFetch<Notebook>(nb(id), userId, { method: "PATCH", body: { name } });
}

export function deleteNotebook(userId: string, id: string) {
  return apiFetch<void>(nb(id), userId, { method: "DELETE" });
}

export function listNotes(userId: string, notebookId: string, categoryId?: string) {
  const suffix = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : "";
  return apiFetch<{ notes: Note[] }>(`${nb(notebookId)}/notes${suffix}`, userId);
}

export function createNote(userId: string, notebookId: string, body: { title: string; body_md: string }) {
  return apiFetch<Note>(`${nb(notebookId)}/notes`, userId, { method: "POST", body });
}

export function updateNote(
  userId: string,
  id: string,
  body: { title?: string; body_md?: string; category_ids?: string[] },
) {
  return apiFetch<Note>(note(id), userId, { method: "PATCH", body });
}

export function deleteNote(userId: string, id: string) {
  return apiFetch<void>(note(id), userId, { method: "DELETE" });
}

export function moveNote(userId: string, id: string, notebookId: string) {
  return apiFetch<Note>(`${note(id)}/move`, userId, { method: "POST", body: { notebook_id: notebookId } });
}

export function copyNote(userId: string, id: string, notebookId: string) {
  return apiFetch<Note>(`${note(id)}/copy`, userId, { method: "POST", body: { notebook_id: notebookId } });
}

export function listCategories(userId: string, notebookId: string) {
  return apiFetch<{ categories: Category[] }>(`${nb(notebookId)}/categories`, userId);
}

export function createCategory(userId: string, notebookId: string, name: string) {
  return apiFetch<Category>(`${nb(notebookId)}/categories`, userId, { method: "POST", body: { name } });
}

export function deleteCategory(userId: string, id: string) {
  return apiFetch<void>(`/v1/note-categories/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

/** Streams the Markdown export through, keeping the API's download headers. */
export async function exportNotebook(userId: string, id: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${nb(id)}/export.md`, {
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        [USER_ID_HEADER]: userId,
      },
    });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers();
  for (const name of ["Content-Type", "Content-Disposition", "Content-Length", "Cache-Control", "X-Content-Type-Options"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
