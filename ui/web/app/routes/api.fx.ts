/**
 * api.fx.ts
 * GET /api/fx?base=USD: the currency-converter tool's rates (AnyTools phase
 * 3a), at the old site's URL, with its answers:
 *
 *   a three-letter base -> 200 { amount, base, date, rates }, cacheable a day
 *   anything else -> 400 { error }
 *   no rates to be had -> 503 { error }
 *
 * Added here: each address has a budget (429, public-budget.server.ts), since
 * a cache miss calls Frankfurter. Public, no sign-in; a GET that changes
 * nothing, so no origin check.
 */
import type { Route } from "./+types/api.fx";
import { fxRates, isCurrencyCode } from "~/lib/tools/fx.server";
import { overToolBudget } from "~/lib/tools/public-budget.server";

const ONE_DAY_S = 86_400;

export async function loader({ request }: Route.LoaderArgs) {
  const over = overToolBudget("fx", request);
  if (over) return over;

  const base = (new URL(request.url).searchParams.get("base") ?? "USD").toUpperCase();
  if (!isCurrencyCode(base)) {
    return Response.json({ error: "Invalid base currency" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const data = await fxRates(base);
  if (!data) {
    return Response.json({ error: "FX provider unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(data, {
    headers: { "Cache-Control": `public, s-maxage=${ONE_DAY_S}, stale-while-revalidate=43200` },
  });
}
