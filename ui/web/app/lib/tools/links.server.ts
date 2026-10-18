/**
 * tools/links.server.ts
 * Points an article's links at the URL that serves the page, as the old
 * site's localize-internal-href.ts did. Articles link to each other as
 * `/finance/x`, the legacy `/tools/<cluster>/<slug>`, or with a hard-coded
 * locale; a link keeps the reader's locale only where that locale has an
 * indexable page, and otherwise goes to English.
 *
 * Runs in the loader, on the Markdown source, because which locales have a
 * body is known on the server only.
 */
import { isPublicLng } from "~/lib/i18n";
import { toolMetas } from "~/tools/meta-registry";
import type { ToolMeta } from "~/tools/types";
import { findTool, isPopulatedCluster } from "./catalog";
import { isIndexableTool } from "./content.server";

const SITE_HOST = "anytools.world";
const PAGE_ROUTES = new Set(["about", "contact", "guides", "privacy", "terms", "tools", "anyprofile"]);

function splitSitePath(href: string): { path: string; suffix: string } | null {
  let rest = href;
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (url.hostname.replace(/^www\./, "") !== SITE_HOST) return null;
      rest = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return null;
    }
  }
  if (!rest.startsWith("/") || rest.startsWith("//")) return null;
  const cut = rest.search(/[?#]/);
  return cut === -1 ? { path: rest, suffix: "" } : { path: rest.slice(0, cut), suffix: rest.slice(cut) };
}

function toolLocale(meta: ToolMeta, locale: string): string {
  return locale === "en" || isIndexableTool(meta, locale) ? locale : "en";
}

/** The localized href, or `href` unchanged when it is not a link to a site page. */
export function localizeInternalHref(href: string, locale: string): string {
  const parts = splitSitePath(href);
  if (!parts) return href;
  const segs = parts.path.split("/").filter(Boolean);

  let target = locale;
  const head = segs[0] ?? "";
  if (isPublicLng(head)) {
    target = head;
    segs.shift();
  } else if (head && !PAGE_ROUTES.has(head) && !isPopulatedCluster(head)) {
    return href;
  }

  const legacyTool = segs[0] === "tools";
  if (legacyTool) segs.shift();

  const [first, second] = segs;
  if ((segs.length === 2 && first && isPopulatedCluster(first)) || (legacyTool && segs.length >= 1 && segs.length <= 2)) {
    const slug = segs[segs.length - 1] ?? "";
    const meta = (first && second ? findTool(first, second) : undefined) ?? toolMetas.find((m) => m.slug === slug);
    if (!meta) return href;
    return `/${toolLocale(meta, target)}/${meta.cluster}/${meta.slug}${parts.suffix}`;
  }
  return `/${[target, ...segs].join("/")}${parts.suffix}`;
}

/**
 * Rewrites every Markdown link target `](…)` in a source, outside code: a
 * tutorial that shows Markdown in a fence keeps its sample as written.
 */
export function localizeArticleLinks(source: string, locale: string): string {
  return source
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (_m, href: string, title: string | undefined) => {
            return `](${localizeInternalHref(href, locale)}${title ?? ""})`;
          }),
    )
    .join("");
}
