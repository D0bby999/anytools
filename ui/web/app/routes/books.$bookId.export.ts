/**
 * books.$bookId.export.ts
 * Resource route (loader only): a living book as one Markdown file, its
 * citations resolved, streamed through with the API's download headers.
 */
import type { Route } from "./+types/books.$bookId.export";
import { requireUser } from "~/lib/auth.server";
import { exportBook } from "~/lib/books.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return exportBook(user.id, params.bookId);
}
