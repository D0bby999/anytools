/**
 * mastery.vocabulary.anki.ts
 * Resource route for Anki decks (the private design notes, phase 3).
 * The deck is read and written in the browser; this only moves words. GET is
 * every word being learned, for the export; POST is one batch of an import's
 * words. Not under app-layout, so it calls requireUser itself.
 */
import type { Route } from "./+types/mastery.vocabulary.anki";
import { ApiError } from "~/lib/api.server";
import { requireUser } from "~/lib/auth.server";
import { allLearningWords, importWords } from "~/lib/vocab.server";
import type { ExportWord } from "~/lib/anki/write";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const words: ExportWord[] = (await allLearningWords(user.id)).map((n) => ({
    term: n.term,
    lang: n.lang,
    meaning: n.meaning,
    sentence: n.contexts[0]?.sentence ?? "",
    source: n.source?.title ?? n.contexts[0]?.document_title ?? "",
  }));
  return Response.json({ words });
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  let body: { lang?: unknown; notes?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "malformed request body" }, { status: 400 });
  }
  const notes = Array.isArray(body.notes)
    ? body.notes.map((n: { term?: unknown; meaning?: unknown; sentence?: unknown }) => ({
        term: String(n?.term ?? ""),
        meaning: String(n?.meaning ?? ""),
        sentence: String(n?.sentence ?? ""),
      }))
    : [];
  try {
    return Response.json(await importWords(user.id, String(body.lang ?? ""), notes));
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
