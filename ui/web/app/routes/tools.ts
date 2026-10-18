/**
 * tools.ts
 * `/tools`: the app's Tools tab. Sends the visitor to the tools home in the
 * first language their browser asks for that the public pages speak, else
 * English. A redirect rather than a link computed in the rail, so the rail
 * stays one static array and the choice is made where the header is.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/tools";
import { isPublicLng, type PublicLng } from "~/lib/i18n";

/** `vi-VN,vi;q=0.9,en;q=0.8` -> "vi". Ranked by q, primary subtag only. */
export function pickPublicLocale(acceptLanguage: string | null): PublicLng {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...attrs] = part.trim().split(";");
      const q = attrs.map((a) => /^\s*q=([0-9.]+)\s*$/.exec(a)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split("-")[0] ?? "", q: q === undefined ? 1 : Number(q), i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find(isPublicLng) ?? "en";
}

/**
 * Public pages the app links to by name rather than by locale (the rail's
 * AnyProfile feature). An allowlist, so `?page=` can never become an open
 * redirect or reach a path the public layout does not serve.
 */
const PAGES = ["anyprofile"] as const;

export function loader({ request }: Route.LoaderArgs) {
  const page = new URL(request.url).searchParams.get("page");
  const suffix = PAGES.find((p) => p === page) ? `/${page}` : "";
  return redirect(`/${pickPublicLocale(request.headers.get("Accept-Language"))}${suffix}`, {
    headers: { Vary: "Accept-Language", "Cache-Control": "private, no-cache" },
  });
}
