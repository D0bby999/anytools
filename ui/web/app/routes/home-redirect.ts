/**
 * home-redirect.ts
 * `/`: no page of its own. A signed-in visitor goes to /home; anyone else to
 * the landing page in their language, /en, /vi, /es or /pt: the one they last
 * opened (the `anylearn-lang` cookie landing.tsx sets), else their browser's,
 * else English. A crawler, which sends neither, lands on /en. It is the
 * landing page's hreflang x-default.
 *
 * `/?lng=xx` was the landing page's address for a few hours on 2026-10-19 and
 * reached the sitemap; it answers 301 to /xx, so nothing indexed is lost.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/home-redirect";
import { getUserId } from "~/lib/auth.server";
import { isPublicLng } from "~/lib/i18n";
import { languageCookie } from "~/lib/language.server";
import { pickPublicLocale } from "./tools";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) return redirect("/home");
  const asked = new URL(request.url).searchParams.get("lng") ?? "";
  if (isPublicLng(asked)) return redirect(`/${asked}`, 301);
  const kept = (await languageCookie.parse(request.headers.get("Cookie"))) as unknown;
  const locale = typeof kept === "string" && isPublicLng(kept) ? kept : pickPublicLocale(request.headers.get("Accept-Language"));
  return redirect(`/${locale}`, { headers: { Vary: "Accept-Language, Cookie", "Cache-Control": "private, no-store" } });
}
