/**
 * auth.server.ts
 * The one helper every protected loader and action calls.
 *
 * Routing every guard through `requireUser` means "is this request
 * authenticated?" has exactly one answer in the codebase. A route that forgets
 * to call it renders nothing useful, because there is no other way to obtain a
 * user id to pass to `apiFetch`.
 */
import { redirect } from "react-router";
import { apiFetch, ApiError, type ApiUser } from "~/lib/api.server";
import { getSession, destroySession, type SessionData } from "~/lib/session.server";
import { isSessionRevoked } from "~/lib/session-watermark.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";
import { assertSameOrigin } from "~/lib/same-origin.server";

/** Reads the session without redirecting. Returns null when signed out. */
export async function getUserId(request: Request): Promise<string | null> {
  // Every action reaches its user through here, so this is where a cross-site
  // write is refused — before the action runs (same-origin.server.ts).
  assertSameOrigin(request);
  const session = await getSession(request);
  const userId = session.get("userId") as SessionData["userId"] | undefined;
  if (!userId) return null;

  const sat = session.get("sat") as SessionData["sat"] | undefined;
  if (await isSessionRevoked(userId, sat)) return null;

  return userId;
}

/**
 * Requires a signed-in user, redirecting to /login otherwise.
 *
 * The destination is carried in `?next=` so the user lands where they were
 * going — passed through the open-redirect guard first, because the value ends
 * up in a redirect after a successful login.
 */
export async function requireUserId(request: Request): Promise<string> {
  const userId = await getUserId(request);
  if (userId) return userId;

  const url = new URL(request.url);
  const next = sanitizeNextPath(url.pathname + url.search);
  const target = next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";

  // Clear the cookie on the way out: an expired or revoked session that stays
  // set means every subsequent request pays for a failed validation.
  throw redirect(target, {
    headers: { "Set-Cookie": await destroySession(await getSession(request)) },
  });
}

/**
 * Requires a signed-in user AND loads their profile from the API.
 *
 * A 401 here means the API rejected a user this process still believes in —
 * account deleted, for instance — so the session is destroyed rather than
 * retried.
 */
export async function requireUser(request: Request): Promise<{ userId: string; user: ApiUser }> {
  const userId = await requireUserId(request);
  try {
    const user = await apiFetch<ApiUser>("/v1/me", userId);
    return { userId, user };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      throw redirect("/login", {
        headers: { "Set-Cookie": await destroySession(await getSession(request)) },
      });
    }
    throw err;
  }
}
