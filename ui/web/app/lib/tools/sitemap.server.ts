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
import { clusterIsIndexable, isIndexableTool, loadToolContent, toolLocales } from "./content.server";
import { toolMetas } from "~/tools/meta-registry";
import { GUIDE_SLUGS, guideLocales, STATIC_PAGES } from "./pages.server";
import { showcaseLangPath, showcasePath } from "~/lib/showcase/design";

/**
 * The day the redesigned site went live: every page's markup, copy and
 * structure changed then, so no page is older than it. Move it only when the
 * pages change again as a whole; a single article's `updated:` date, when
 * later, speaks for that page alone. Never the build date: a sitemap whose
 * dates move on every deploy teaches Google to ignore them.
 */
const SITE_UPDATED = "2026-10-20";

function lastmod(updated?: string): string {
  return updated && /^\d{4}-\d{2}-\d{2}$/.test(updated) && updated > SITE_UPDATED ? updated : SITE_UPDATED;
}

function entry(path: (l: PublicLng) => string, self: PublicLng, alternates: readonly PublicLng[], xDefault?: string, updated?: string): string {
  const links = alternates.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${APP_URL}${path(l)}"/>`);
  if (alternates.includes("en")) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}${xDefault ?? path("en")}"/>`);
  return `  <url>\n    <loc>${APP_URL}${path(self)}</loc>\n    <lastmod>${lastmod(updated)}</lastmod>\n${links.join("\n")}\n  </url>`;
}

/**
 * Public profiles their learners let search engines list
 * (the private design notes): one entry each, at the bare address
 * that answers in the visitor's language, naming each language's address.
 */
export function showcaseUrls(pages: { handle: string; updated_at: string }[]): string[] {
  return pages.map((p) => {
    const day = p.updated_at.slice(0, 10);
    const links = publicLngs.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${APP_URL}${showcaseLangPath(p.handle, l)}"/>`);
    links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}${showcasePath(p.handle)}"/>`);
    return `  <url>\n    <loc>${APP_URL}${showcasePath(p.handle)}</loc>\n    <lastmod>${/^\d{4}-\d{2}-\d{2}$/.test(day) ? day : SITE_UPDATED}</lastmod>\n${links.join("\n")}\n  </url>`;
  });
}

export function publicUrls(): string[] {
  const out: string[] = [];
  for (const locale of publicLngs) {
    // The landing page, whose x-default is `/` (it redirects by language),
    // and the tools home under it.
    out.push(entry((l) => `/${l}`, locale, publicLngs, "/"));
    out.push(entry((l) => `/${l}/tools`, locale, publicLngs));
    for (const cluster of POPULATED_CLUSTERS) {
      if (!clusterIsIndexable(locale, cluster)) continue;
      const alternates = publicLngs.filter((l) => clusterIsIndexable(l, cluster));
      out.push(entry((l) => `/${l}/${cluster}`, locale, alternates));
    }
    for (const m of toolMetas) {
      if (!isIndexableTool(m, locale)) continue;
      const alternates = toolLocales(m).filter((l) => isIndexableTool(m, l));
      const updated = loadToolContent(locale, m.cluster, m.slug).tutorial?.data.updated;
      out.push(entry((l) => `/${l}/${m.cluster}/${m.slug}`, locale, alternates, undefined, updated));
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
