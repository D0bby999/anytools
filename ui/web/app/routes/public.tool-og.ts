/**
 * public.tool-og.ts
 * `/{locale}/{cluster}/{tool}/og.png`: the tool page's Open Graph card.
 * Loader only. The path is checked against the registry like the page's, so
 * at most one card per tool and locale can ever be drawn, and each is kept.
 */
import type { Route } from "./+types/public.tool-og";
import { findTool, offeredIn, toolDescription, toolTitle } from "~/lib/tools/catalog";
import { renderToolCard } from "~/lib/tools/og-image.server";
import { notFound, publicLocale, toolsT } from "~/lib/tools/route.server";

// Cards are a pure function of the registry and the locale files, which only
// change with a deploy, so a process keeps what it has drawn (at most 131 x 4).
const drawn = new Map<string, Uint8Array>();

export async function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const meta = findTool(params.cluster, params.tool);
  if (!meta || !offeredIn(meta, locale)) notFound();

  const key = `${locale}/${meta.cluster}/${meta.slug}`;
  let png = drawn.get(key);
  if (!png) {
    png = await renderToolCard({
      title: toolTitle(meta, locale),
      description: toolDescription(meta, locale),
      cluster: toolsT(locale)(`catalog.cluster.${meta.cluster}`),
    });
    drawn.set(key, png);
  }
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
  });
}
