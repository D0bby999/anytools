/**
 * learn.ts
 * Gateway route for AnyLearn:
 *   - Signed in: redirects straight to `/home` (study dashboard).
 *   - Signed out: redirects to `/login?next=/home` so the learner signs in
 *     and lands directly in their study workspace.
 */
import { redirect } from "react-router";
import { getUserId } from "~/lib/auth.server";

export async function loader({ request }: { request: Request }) {
  const userId = await getUserId(request);
  if (userId) return redirect("/home");
  return redirect("/login?next=/home");
}
