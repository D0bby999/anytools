/**
 * toolkit.$id.export.ts
 * Resource route (loader only): a worksheet as a Markdown file, laid out by
 * its kind, with the API's download headers.
 */
import type { Route } from "./+types/toolkit.$id.export";
import { requireUser } from "~/lib/auth.server";
import { exportWorksheet } from "~/lib/worksheets.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return exportWorksheet(user.id, params.id);
}
