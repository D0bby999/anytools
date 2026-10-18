/**
 * documents.$docId.file.ts
 * Resource route (loader only): the original uploaded bytes, for pdf.js.
 *
 * The browser has no route to the Go API, so the file comes through here. The
 * workspace is resolved from the document id in the URL — the same idempotent
 * call the viewer's loader makes — and the API checks ownership on both. Not
 * under app-layout, so it calls requireUser itself.
 */
import type { Route } from "./+types/documents.$docId.file";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { fetchWorkspaceFile, openWorkspace } from "~/lib/reading.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    const workspace = await openWorkspace(user.id, params.docId);
    return await fetchWorkspaceFile(user.id, workspace.id, request);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}
