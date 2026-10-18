/**
 * notebooks.$notebookId.export.ts
 * Resource route (loader only): the notebook as one Markdown file, streamed
 * through with the API's own download headers.
 */
import type { Route } from "./+types/notebooks.$notebookId.export";
import { requireUser } from "~/lib/auth.server";
import { exportNotebook } from "~/lib/notebook.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return exportNotebook(user.id, params.notebookId);
}
