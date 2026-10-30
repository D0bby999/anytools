/**
 * home-redirect.ts
 * `/`: serves the English landing page directly, including its verification
 * meta tags, regardless of language cookies or browser preferences. A signed-in
 * visitor still goes to /home. Localized homes stay at /en, /vi, /es and /pt;
 * this English alias is canonical to /en and remains the hreflang x-default.
 *
 * `/?lng=xx` was the landing page's address for a few hours on 2026-10-19 and
 * reached the sitemap; it answers 301 to /xx, so nothing indexed is lost.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/home-redirect";
import { getUserId } from "~/lib/auth.server";
import { isPublicLng } from "~/lib/i18n";
import { loader as landingLoader } from "./landing";

export { default, handle, headers, meta } from "./landing";

export async function loader(args: Route.LoaderArgs) {
  const { request } = args;
  if (await getUserId(request)) return redirect("/home");
  const asked = new URL(request.url).searchParams.get("lng") ?? "";
  if (isPublicLng(asked)) return redirect(`/${asked}`, 301);
  return landingLoader({ ...args, params: { locale: "en" } });
}
