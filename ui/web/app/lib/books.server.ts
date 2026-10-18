/**
 * books.server.ts
 * Living books' thin API module (learning depth, phase 11). Server-side only;
 * every call is scoped by an explicit user id.
 */
import { apiFetch, USER_ID_HEADER } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Block, Book, ChapterView, ProposedChapter } from "~/lib/book-types";

const base = "/v1/books";
const book = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** A proposal: one model call on the learner's chat route. */
export function createBook(userId: string, body: { kb_id: string; goal?: string; chapters: number }) {
  return apiFetch<Book>(base, userId, { method: "POST", body });
}

export function listBooks(userId: string, kbId?: string) {
  return apiFetch<{ books: Book[] }>(kbId ? `${base}?kb_id=${encodeURIComponent(kbId)}` : base, userId);
}

/** The knowledge base's books, never failing its page. */
export async function loadBooks(userId: string, kbId: string): Promise<Book[]> {
  try {
    return (await listBooks(userId, kbId)).books;
  } catch {
    return [];
  }
}

export function getBook(userId: string, id: string) {
  return apiFetch<Book>(book(id), userId);
}

export function saveProposal(
  userId: string,
  id: string,
  body: { title: string; audience: string; chapters: ProposedChapter[] },
) {
  return apiFetch<Book>(`${book(id)}/proposal`, userId, { method: "PUT", body });
}

/** Confirming creates the chapters and writes none of them. */
export function confirmBook(userId: string, id: string) {
  return apiFetch<Book>(`${book(id)}/confirm`, userId, { method: "POST" });
}

export function compileBook(userId: string, id: string) {
  return apiFetch<Book>(`${book(id)}/compile`, userId, { method: "POST" });
}

export function cancelBook(userId: string, id: string) {
  return apiFetch<void>(`${book(id)}/cancel`, userId, { method: "POST" });
}

export function deleteBook(userId: string, id: string) {
  return apiFetch<void>(book(id), userId, { method: "DELETE" });
}

export function getChapter(userId: string, id: string, chapterId: string) {
  return apiFetch<ChapterView>(`${book(id)}/chapters/${encodeURIComponent(chapterId)}`, userId);
}

export function compileChapter(userId: string, id: string, chapterId: string) {
  return apiFetch<Book>(`${book(id)}/chapters/${encodeURIComponent(chapterId)}/compile`, userId, { method: "POST" });
}

export function addNote(userId: string, id: string, chapterId: string, markdown: string) {
  return apiFetch<Block>(`${book(id)}/chapters/${encodeURIComponent(chapterId)}/notes`, userId, {
    method: "POST",
    body: { markdown },
  });
}

/** One block rewritten now: one call, the previous version kept until it is ready. */
export function regenerateBlock(userId: string, id: string, blockId: string) {
  return apiFetch<Block>(`${book(id)}/blocks/${encodeURIComponent(blockId)}/regenerate`, userId, { method: "POST" });
}

export function setInReview(userId: string, id: string, blockId: string, on: boolean) {
  return apiFetch<void>(`${book(id)}/blocks/${encodeURIComponent(blockId)}/review`, userId, {
    method: "PUT",
    body: { on },
  });
}

/** The book as one Markdown file, streamed through with the API's download headers. */
export async function exportBook(userId: string, id: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${book(id)}/export`, {
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
