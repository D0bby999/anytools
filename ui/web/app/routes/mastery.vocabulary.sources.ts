/**
 * mastery.vocabulary.sources.ts
 * A saved word's sentences and recordings from open sources (the private design notes, phase 6): GET ?kind=sentences|recordings
 * looks them up (the API calls Tatoeba, Wikimedia Commons and the Free
 * Dictionary API), GET ?kind=audio&id= plays one, POST takes a sentence for
 * the word.
 */
import type { Route } from "./+types/mastery.vocabulary.sources";
import { ApiError } from "~/lib/api.server";
import { requireUser } from "~/lib/auth.server";
import { addSourceSentence, fetchSourceAudio, lookupRecordings, lookupSentences } from "~/lib/vocab.server";

const failure = (error: unknown) =>
  Response.json(
    { error: error instanceof ApiError ? error.message : "", unavailable: error instanceof ApiError && error.status === 502 },
    { status: error instanceof ApiError ? error.status : 500 },
  );

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const q = new URL(request.url).searchParams;
  const lang = (q.get("lang") ?? "").slice(0, 20);
  const term = (q.get("term") ?? "").slice(0, 80);
  try {
    switch (q.get("kind")) {
      case "sentences":
        return Response.json(await lookupSentences(user.id, lang, term, (q.get("to") ?? "").slice(0, 20)));
      case "recordings":
        return Response.json(await lookupRecordings(user.id, lang, term));
      case "audio":
        return fetchSourceAudio(user.id, (q.get("id") ?? "").slice(0, 300), request.signal);
    }
  } catch (error) {
    return failure(error);
  }
  return Response.json({ error: "Unknown lookup." }, { status: 400 });
}

// budget: none (the API's sentence write; no model, no outside call).
export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    const note = await addSourceSentence(user.id, String(form.get("id") ?? ""), {
      sentence: String(form.get("sentence") ?? ""),
      credit: String(form.get("credit") ?? ""),
      url: String(form.get("url") ?? ""),
    });
    return Response.json({ used: String(form.get("sentence") ?? ""), note: note.id });
  } catch (error) {
    return failure(error);
  }
}
