/**
 * sitemap[.]xml.ts
 * The landing page, and the public tool pages in four languages. Written out
 * rather than generated from routes, because every app route is private and a
 * generator would have to be told so for each.
 *
 * The tool pages' entries come from lib/tools/sitemap.server.ts. No priority
 * or changefreq on them: Google ignores both. Then the public profiles whose
 * learners let search engines list them (the private design notes).
 */
import { listIndexedShowcases } from "~/lib/showcase/api.server";
import { publicUrls, showcaseUrls } from "~/lib/tools/sitemap.server";

export async function loader() {
  const profiles = showcaseUrls(await listIndexedShowcases());
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...publicUrls(), ...profiles].join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
