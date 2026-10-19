/**
 * body.exercises.ts
 * Resource route (loader only): the exercise picker's search, so the
 * 1,324-exercise library stays on the server. Its loader calls requireUserId.
 */
import type { Route } from "./+types/body.exercises";
import { requireUserId } from "~/lib/auth.server";
import { searchExercises } from "~/lib/body.server";

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 80);
  const { exercises, total } = await searchExercises(userId, { q, limit: 25 });
  return Response.json({ exercises, total });
}
