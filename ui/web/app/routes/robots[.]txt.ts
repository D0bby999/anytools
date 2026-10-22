/**
 * robots[.]txt.ts
 * The landing page and the public tool pages (/en, /vi, /es, /pt and what is
 * under them, Open Graph cards included) are for crawlers, and so are public
 * profiles (/u/<handle>); one its learner keeps out of search says `noindex`. Everything else is
 * behind sign-in and says `noindex` as well; disallowing it here just saves
 * the crawl. The files those pages are drawn with are let in too: Google
 * renders a page with its CSS and scripts, shows the favicon beside a result
 * only if it may fetch it, and indexes the plates as images.
 */
import { APP_URL } from "~/lib/env.server";
import { publicLngs } from "~/lib/i18n";

const PUBLIC_FILES = [
  "/assets/",
  "/plates/",
  "/brand/",
  "/icons/",
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/og.png",
  "/llms.txt",
];

export function loader() {
  const allow = publicLngs.flatMap((l) => [`Allow: /${l}$`, `Allow: /${l}/`]);
  const files = PUBLIC_FILES.map((f) => `Allow: ${f}`);
  // `/?lng=` answers 301 to /{lng} (routes/home-redirect.ts); a crawler must
  // be let in to see that.
  const body = ["User-agent: *", "Allow: /$", "Allow: /?lng=", ...allow, "Allow: /u/", ...files, "Disallow: /", "", `Sitemap: ${APP_URL}/sitemap.xml`, ""].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
