/**
 * toolkit.$id.recordings.$rid.ts
 * Resource route: one take on a worksheet (up-methods phase 7). GET streams
 * it from 'self' with range support; DELETE removes it, its file first. Not
 * under app-layout, so each handler calls requireUser; the API resolves both
 * ids with the caller's.
 */
import type { Route } from "./+types/toolkit.$id.recordings.$rid";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { deleteRecording, fetchRecording } from "~/lib/worksheets.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return fetchRecording(user.id, params.id, params.rid, request);
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  if (request.method !== "DELETE") return Response.json({ error: "Method not allowed." }, { status: 405 });
  try {
    await deleteRecording(user.id, params.id, params.rid);
  } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  return new Response(null, { status: 204 });
}
