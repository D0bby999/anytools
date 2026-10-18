/**
 * documents.$docId.media.ts
 * Resource route (loader only): an uploaded audio or video file, for the
 * viewer's native <audio> or <video> (up-methods phase 15).
 *
 * The browser has no route to the Go API, so the recording comes through
 * here, from 'self' (the CSP's media-src). The player's Range header is
 * forwarded so seeking answers 206 without downloading the whole file, and
 * the API's own headers come back: the sniffed type, nosniff, inline. The
 * API checks that the document is the caller's; another learner's id and a
 * document that is not a recording both answer 404. Not under app-layout, so
 * it calls requireUser itself.
 */
import type { Route } from "./+types/documents.$docId.media";
import { requireUser } from "~/lib/auth.server";
import { fetchRecording } from "~/lib/kb.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return fetchRecording(user.id, params.docId, request);
}
