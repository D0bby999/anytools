/**
 * u.$handle.og[.]png.ts
 * /u/<handle>/og.png: the card a link to a public profile unfurls into. Only
 * a published page has one, and it shows only the counts its page shows (the
 * summary block's); without that block, the name and headline alone.
 *
 * Its language is the address's `?lang=` (the page names its own), never the
 * visitor's cookie or browser, so one address is always one picture and a
 * shared cache may keep it.
 */
import type { Route } from "./+types/u.$handle.og[.]png";
import { APP_URL } from "~/lib/env.server";
import { initI18n, isSupportedLng, loadLanguage } from "~/lib/i18n";
import { clientIP, createIPLimiter } from "~/lib/ip-limit.server";
import { readShowcase } from "~/lib/showcase/api.server";
import { HANDLE_PATTERN, showcasePath } from "~/lib/showcase/design";
import { renderShowcaseCard } from "~/lib/tools/og-image.server";

/** Reads per address, as the page's; drawing is CPU on this process, so tighter. */
const reads = createIPLimiter(60, 30);
const draws = createIPLimiter(20, 10);
const HANDLE = new RegExp(`^${HANDLE_PATTERN}$`);

/** Cards drawn, by what is on them, so a page shared in a busy chat is drawn once. */
const drawn = new Map<string, Uint8Array>();
const KEEP = 200;

export async function loader({ request, params }: Route.LoaderArgs) {
  const handle = (params.handle ?? "").toLowerCase();
  if (!HANDLE.test(handle)) throw new Response("Not found", { status: 404 });
  if (!reads(clientIP(request))) throw new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
  const page = await readShowcase(handle);
  if (!page) throw new Response("Not found", { status: 404 });

  const asked = new URL(request.url).searchParams.get("lang") ?? "";
  const language = isSupportedLng(asked) ? asked : "en";
  const p = page.profile;
  const s = page.stats.summary;
  const key = JSON.stringify([language, p.handle, p.name, p.headline, p.design.theme.accent, s]);
  let png = drawn.get(key);
  if (!png) {
    if (!draws(clientIP(request))) throw new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });
    await loadLanguage(language);
    const t = initI18n(language).getFixedT(language, "showcase");
    const n = new Intl.NumberFormat(language);
    png = await renderShowcaseCard({
      name: p.name,
      headline: p.headline,
      accent: p.design.theme.accent,
      tab: t("tab"),
      stats: s
        ? [
            { value: n.format(s.days), label: t("summary.days", { count: s.days }) },
            { value: n.format(s.streak), label: t("summary.streak", { count: s.streak }) },
            { value: n.format(s.level), label: t("summary.level") },
          ]
        : [],
      address: `${new URL(APP_URL).host}${showcasePath(p.handle)}`,
    });
    if (drawn.size >= KEEP) drawn.delete(drawn.keys().next().value!);
    drawn.set(key, png);
  }
  return new Response(new Uint8Array(png), {
    // Five minutes: a page unpublished stops unfurling soon after.
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" },
  });
}
