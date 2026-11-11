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
import { RANKING_CATEGORY_IDS } from "./rankings";
import { loadRankingCategory } from "./rankings.server";
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

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function entry(
  path: (l: PublicLng) => string,
  self: PublicLng,
  alternates: readonly PublicLng[],
  xDefault?: string,
  updated?: string,
  extra = "",
): string {
  const links = alternates.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${APP_URL}${path(l)}"/>`);
  if (alternates.includes("en")) links.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${APP_URL}${xDefault ?? path("en")}"/>`);
  return `  <url>\n    <loc>${APP_URL}${path(self)}</loc>\n    <lastmod>${lastmod(updated)}</lastmod>\n${links.join("\n")}${extra ? `\n${extra}` : ""}\n  </url>`;
}

const ANYPROFILE_VIDEO_SITEMAP: Record<PublicLng, { title: string; desc: string; content: string; thumb: string; dur: number }> = {
  en: {
    title: "AnyProfile — Free Open-Source Antidetect Browser & Android VM Walkthrough",
    desc: "98-second walkthrough of isolated profiles, Arrange Windows, macOS Keychain proxy vault, native Android 15 VM on Apple Silicon, and AI MCP automation.",
    content: `${APP_URL}/apps/anyprofile-demo-en.mp4`,
    thumb: `${APP_URL}/apps/anyprofile-demo-poster.jpg`,
    dur: 98,
  },
  vi: {
    title: "AnyProfile — Trình duyệt Antidetect miễn phí & Máy ảo Android 15",
    desc: "Video 74 giây giới thiệu profile độc lập, Arrange Windows, proxy mã hóa Keychain, máy ảo Android 15 native và kết nối AI MCP trên macOS.",
    content: `${APP_URL}/apps/anyprofile-demo-vi.mp4`,
    thumb: `${APP_URL}/apps/anyprofile-demo-poster-vi.jpg`,
    dur: 74,
  },
  es: {
    title: "AnyProfile — Demostración de Navegador Antidetect Gratis y VM Android 15",
    desc: "Recorrido en vídeo con perfiles aislados, Arrange Windows, proxies Keychain, máquina virtual Android 15 y automatización MCP local.",
    content: `${APP_URL}/apps/anyprofile-demo-en.mp4`,
    thumb: `${APP_URL}/apps/anyprofile-demo-poster.jpg`,
    dur: 98,
  },
  pt: {
    title: "AnyProfile — Demonstração do Navegador Antidetect Grátis e VM Android 15",
    desc: "Demonstração em vídeo com perfis isolados, Arrange Windows, proxies no Keychain, VM Android 15 nativa e automação MCP local.",
    content: `${APP_URL}/apps/anyprofile-demo-en.mp4`,
    thumb: `${APP_URL}/apps/anyprofile-demo-poster.jpg`,
    dur: 98,
  },
};

function anyprofileVideoTag(locale: PublicLng): string {
  const v = ANYPROFILE_VIDEO_SITEMAP[locale];
  return [
    "    <video:video>",
    `      <video:thumbnail_loc>${xmlEscape(v.thumb)}</video:thumbnail_loc>`,
    `      <video:title>${xmlEscape(v.title)}</video:title>`,
    `      <video:description>${xmlEscape(v.desc)}</video:description>`,
    `      <video:content_loc>${xmlEscape(v.content)}</video:content_loc>`,
    `      <video:player_loc>${APP_URL}/${locale}/anyprofile#ap-demo</video:player_loc>`,
    `      <video:duration>${v.dur}</video:duration>`,
    "      <video:publication_date>2026-11-11T12:40:00+07:00</video:publication_date>",
    "      <video:family_friendly>yes</video:family_friendly>",
    "      <video:requires_subscription>no</video:requires_subscription>",
    "    </video:video>",
  ].join("\n");
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
      const guideUpdated = slug === "anyprofile" ? "2026-11-11" : undefined;
      if (alternates.includes(locale)) out.push(entry((l) => `/${l}/guides/${slug}`, locale, alternates, undefined, guideUpdated));
    }
    out.push(entry((l) => `/${l}/rankings`, locale, publicLngs));
    for (const cat of RANKING_CATEGORY_IDS) {
      const updated = loadRankingCategory(locale, cat)?.updated;
      out.push(entry((l) => `/${l}/rankings/${cat}`, locale, publicLngs, undefined, updated));
    }
    for (const page of ["anylearn", "anyprofile", ...STATIC_PAGES]) {
      const extra = page === "anyprofile" ? anyprofileVideoTag(locale) : "";
      const pageUpdated = page === "anyprofile" ? "2026-11-11" : undefined;
      out.push(entry((l) => `/${l}/${page}`, locale, publicLngs, undefined, pageUpdated, extra));
    }
  }
  return out;
}
