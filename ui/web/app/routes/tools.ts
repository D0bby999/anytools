/**
 * tools.ts
 * `/tools`: the app's Tools tab. Sends the learner to the tools home in their
 * account's language; anyone else in the language they last opened on the
 * public side, else their browser's, else English (language.server.ts). A
 * redirect rather than a link computed in the rail, so the rail stays one
 * static array and the choice is made where the header is.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/tools";
import { apiFetch, type ApiUser } from "~/lib/api.server";
import { getUserId } from "~/lib/auth.server";
import { isPublicLng, type PublicLng } from "~/lib/i18n";
import { publicLanguage } from "~/lib/language.server";

/**
 * Public pages the app links to by name rather than by locale (the rail's
 * AnyProfile feature). An allowlist, so `?page=` can never become an open
 * redirect or reach a path the public layout does not serve.
 */
const PAGES = ["anyprofile"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const page = new URL(request.url).searchParams.get("page");
  const suffix = PAGES.find((p) => p === page) ? `/${page}` : "/tools";
  return redirect(`/${await tabLanguage(request)}${suffix}`, {
    headers: { Vary: "Accept-Language, Cookie", "Cache-Control": "private, no-cache" },
  });
}

/** The account's language for a learner, so the app and its tools agree. */
async function tabLanguage(request: Request): Promise<PublicLng> {
  const userId = await getUserId(request);
  if (userId) {
    const user = await apiFetch<ApiUser>("/v1/me", userId).catch(() => null);
    if (user && isPublicLng(user.language ?? "")) return user.language as PublicLng;
  }
  return publicLanguage(request);
}
