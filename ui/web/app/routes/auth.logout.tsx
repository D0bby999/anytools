/**
 * auth.logout.tsx
 * Signing out is a POST, never a GET: a GET logout can be triggered by any
 * <img src="/auth/logout"> on any page the user visits.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/auth.logout";
import { destroySession, getSession } from "~/lib/session.server";
import { getUserId } from "~/lib/auth.server";
import { invalidateWatermark, revokeSessions } from "~/lib/session-watermark.server";

export async function action({ request }: Route.ActionArgs) {
  const userId = await getUserId(request);
  if (userId) {
    // Server-side revocation (security audit F-4): every session of this
    // account minted before now stops working, including a copied cookie.
    // A failure here still clears this browser's cookie below.
    await revokeSessions(userId).catch(() => undefined);
    invalidateWatermark(userId);
  }

  return redirect("/login", {
    headers: { "Set-Cookie": await destroySession(await getSession(request)) },
  });
}

/** A GET here is someone following a stale link; send them home, change nothing. */
export async function loader() {
  return redirect("/");
}
