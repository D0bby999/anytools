/**
 * documents.$docId.photo.ts
 * Resource route (loader only): one page's photo of a photo document, for the
 * reading view to show beside its text (up-methods phase 16). `?page=N`.
 *
 * The browser has no route to the Go API, so the photo comes through here,
 * with the API's own safety headers. Not under app-layout, so it calls
 * requireUser itself; the API checks the document is the user's.
 */
import type { Route } from "./+types/documents.$docId.photo";
import { requireUser } from "~/lib/auth.server";
import { fetchDocumentPhoto } from "~/lib/kb.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const page = new URL(request.url).searchParams.get("page") ?? "";
  if (!/^[1-9][0-9]{0,2}$/.test(page)) throw new Response("Not found", { status: 404 });
  return fetchDocumentPhoto(user.id, params.docId, page, request);
}
