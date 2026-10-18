/**
 * documents.$docId.study-notes.ts
 * Resource route (loader only): a video's study notes in one language as a
 * Markdown file, with a link to the video at every time.
 */
import type { Route } from "./+types/documents.$docId.study-notes";
import { requireUser } from "~/lib/auth.server";
import { exportVideoNotes } from "~/lib/video-notes.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const language = new URL(request.url).searchParams.get("language") ?? "";
  return exportVideoNotes(user.id, params.docId, language);
}
