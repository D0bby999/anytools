/**
 * app.api.books.ts
 * Resource route (action only): "Make a book" from the knowledge base page
 * (learning depth, phase 11). A proposal is one model call; on success the
 * browser goes to the new book, where the outline is edited and confirmed.
 * Its action calls requireUserId.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/app.api.books";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createBook } from "~/lib/books.server";

export type BooksActionData = { ok: true } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<BooksActionData | Response> {
  const userId = await requireUserId(request);
  const form = await request.formData();
  if (String(form.get("intent") ?? "") !== "create") return { ok: false, error: "unknown intent" };
  try {
    const book = await createBook(userId, {
      kb_id: String(form.get("kbId") ?? ""),
      goal: String(form.get("goal") ?? "").trim() || undefined,
      chapters: Number(form.get("chapters") ?? 6) || 6,
    });
    return redirect(`/books/${book.id}`);
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}
