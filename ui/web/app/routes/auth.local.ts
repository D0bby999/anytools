/**
 * auth.local.ts
 * Resource route (action only): the development-only local sign-in.
 *
 * 404 unless localSignInEnabled() (ANYTOOLS_DEV_LOGIN=1 on a localhost app
 * URL), and the API refuses the `local` provider unless ANYTOOLS_ENV is
 * `development`. It exists so the owner can review AnyTools on their own
 * machine before any Google or GitHub OAuth app is registered.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/auth.local";
import { apiFetch, type ApiUser } from "~/lib/api.server";
import { getUserId } from "~/lib/auth.server";
import { LOCAL_SIGNIN_EMAIL, localSignInEnabled } from "~/lib/env.server";
import { createUserSession } from "~/lib/session.server";

export async function action({ request }: Route.ActionArgs) {
  if (!localSignInEnabled()) {
    throw new Response("Not found", { status: 404 });
  }
  // Also the origin check every write goes through (same-origin.server.ts).
  if (await getUserId(request)) return redirect("/home");

  let user: ApiUser;
  try {
    user = await apiFetch<ApiUser>("/v1/auth/identity", null, {
      method: "POST",
      body: {
        provider: "local",
        subject: "local:" + LOCAL_SIGNIN_EMAIL,
        email: LOCAL_SIGNIN_EMAIL,
        email_verified: true,
        display_name: "Local owner",
      },
    });
  } catch {
    return redirect("/login?error=not_configured");
  }
  return redirect("/home", { headers: { "Set-Cookie": await createUserSession(request, user.id) } });
}
