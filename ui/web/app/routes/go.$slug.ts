/**
 * routes/go.$slug.ts
 * Outbound affiliate redirect resource route (`/go/:slug`).
 *
 * Keeps raw affiliate URLs in one server registry (`content/rankings/*.json`),
 * answers 302 with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`,
 * and logs a minimal non-PII click event so monthly updates know which links
 * visitors actually use.
 */
import type { Route } from "./+types/go.$slug";
import { isPublicLng } from "~/lib/i18n";
import { notFound } from "~/lib/tools/route.server";
import { resolveAffiliateTarget } from "~/lib/tools/rankings.server";

export function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  const target = resolveAffiliateTarget(slug);
  if (!target) notFound();

  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    notFound();
  }
  if (parsed.protocol !== "https:") notFound();

  const reqUrl = new URL(request.url);
  const rawLoc = reqUrl.searchParams.get("loc") ?? "";
  const loc = isPublicLng(rawLoc) ? rawLoc : "en";
  const rawPos = Number(reqUrl.searchParams.get("pos") ?? "");
  const pos = Number.isInteger(rawPos) && rawPos > 0 && rawPos <= 100 ? rawPos : null;

  if (process.env.NODE_ENV !== "test") {
    console.info(
      JSON.stringify({
        event: "affiliate_click",
        slug: target.slug,
        category: target.category,
        loc,
        pos,
        ts: new Date().toISOString(),
      }),
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: parsed.toString(),
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer-when-downgrade",
    },
  });
}

