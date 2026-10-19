/**
 * public.dropped.ts
 * The old site's sections that did not come over (owner decision 3): the
 * blog, its own sign-in and sign-up, the dashboard, favourites, admin, the
 * offline page and the newsletter. Every URL under them answers 301 to the
 * locale's tools home, so a link or a search result that still points there
 * lands somewhere useful and the search engine moves its weight with it.
 *
 * Loader only, registered once per section (routes.ts, `DROPPED_SECTIONS`),
 * each as `:locale/<section>/*`, which also matches the bare section. An
 * unknown locale is still a 404: only a page the old site had is redirected.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/public.dropped";
import { publicLocale } from "~/lib/tools/route.server";

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  return redirect(`/${locale}/tools`, { status: 301 });
}
