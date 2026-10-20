/**
 * strokes.ts
 * `/strokes/<zh|ja>/<character>`: one character's stroke data for the
 * writing card (lib/strokes.server.ts). Loader only and no sign-in: it is
 * open data, the same for everyone, and cached as the files it comes from.
 */
import type { Route } from "./+types/strokes";
import { strokeData } from "~/lib/strokes.server";

export async function loader({ params }: Route.LoaderArgs) {
  const lang = params.lang;
  if (lang !== "zh" && lang !== "ja") throw new Response("Not found", { status: 404 });
  const data = await strokeData(lang, params.char ?? "");
  if (!data) throw new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The data's version is pinned in the manifest; a day keeps a fix reachable.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
