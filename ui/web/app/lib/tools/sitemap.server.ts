/**
 * tools/sitemap.server.ts
 * The public tool pages' sitemap entries (routes/sitemap[.]xml.ts). A tool or
 * cluster page is listed only where it is indexable (content.server.ts), and
 * each entry names its translations with the same predicate, so the sitemap,
 * the page's robots meta and its hreflang links agree.
 */
import { APP_URL } from "~/lib/env.server";
import { publicLngs, type PublicLng } from "~/lib/i18n";
import { POPULATED_CLUSTERS } from "./catalog";
import { clusterIsIndexable, isIndexableTool, toolLocales } from "./content.server";
import { toolMetas } from "~/tools/meta-registry";
import { GUIDE_SLUGS, guideLocales, STATIC_PAGES } from "./pages.server";

function entry(path: (l: PublicLng) => string, self: PublicLng, alternates: readonly PublicLng[]): string {
  const links = alternates.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${APP_URL}${path(l)}"/>`);
  if (alternates.includes("en")) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}${path("en")}"/>`);
  return `  <url>\n    <loc>${APP_URL}${path(self)}</loc>\n${links.join("\n")}\n  </url>`;
}

/**
 * The landing page: `/` (the x-default) and `/?lng=` in each language, every
 * entry naming all of them, as the page's own hreflang links do.
 */
export function landingUrls(): string[] {
  const links = [
    ...publicLngs.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${APP_URL}/?lng=${l}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}/"/>`,
  ].join("\n");
  return ["/", ...publicLngs.map((l) => `/?lng=${l}`)].map(
    (path) => `  <url>\n    <loc>${APP_URL}${path}</loc>\n${links}\n  </url>`,
  );
}

export function publicUrls(): string[] {
  const out: string[] = [];
  for (const locale of publicLngs) {
    out.push(entry((l) => `/${l}`, locale, publicLngs));
    for (const cluster of POPULATED_CLUSTERS) {
      if (!clusterIsIndexable(locale, cluster)) continue;
      const alternates = publicLngs.filter((l) => clusterIsIndexable(l, cluster));
      out.push(entry((l) => `/${l}/${cluster}`, locale, alternates));
    }
    for (const m of toolMetas) {
      if (!isIndexableTool(m, locale)) continue;
      const alternates = toolLocales(m).filter((l) => isIndexableTool(m, l));
      out.push(entry((l) => `/${l}/${m.cluster}/${m.slug}`, locale, alternates));
    }
    // AnyTools phase 4: the guides, AnyProfile and the about, privacy, terms
    // and contact pages, each written in all four languages.
    out.push(entry((l) => `/${l}/guides`, locale, publicLngs));
    for (const slug of GUIDE_SLUGS) {
      const alternates = guideLocales(slug);
      if (alternates.includes(locale)) out.push(entry((l) => `/${l}/guides/${slug}`, locale, alternates));
    }
    for (const page of ["anylearn", "anyprofile", ...STATIC_PAGES]) out.push(entry((l) => `/${l}/${page}`, locale, publicLngs));
  }
  return out;
}
