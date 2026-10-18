/**
 * robots[.]txt.ts
 * The landing page and the public tool pages (/en, /vi, /es, /pt and what is
 * under them, Open Graph cards included) are for crawlers. Everything else is
 * behind sign-in and says `noindex` as well; disallowing it here just saves
 * the crawl.
 */
import { APP_URL } from "~/lib/env.server";
import { publicLngs } from "~/lib/i18n";

export function loader() {
  const allow = publicLngs.flatMap((l) => [`Allow: /${l}$`, `Allow: /${l}/`]);
  const body = ["User-agent: *", "Allow: /$", ...allow, "Disallow: /", "", `Sitemap: ${APP_URL}/sitemap.xml`, ""].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
