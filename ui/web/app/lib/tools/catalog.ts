/**
 * tools/catalog.ts
 * What the public pages need to list tools: clusters, titles in a locale, and
 * the URL of a page. Client-safe, and UI-free: it reads meta-registry.ts only.
 */
import { toolMetas } from "~/tools/meta-registry";
import type { ClusterId, ToolMeta } from "~/tools/types";
import { isPorted } from "~/tools/ui-registry";
import type { PublicLng } from "~/lib/i18n";

/** Display order of the catalog's cluster filter and the home page's index. */
export const CLUSTER_ORDER: readonly ClusterId[] = [
  "encoding",
  "formatters",
  "generators",
  "converters",
  "text-regex",
  "time-date",
  "web3",
  "finance",
  "health",
  "lifestyle",
  "design",
  "pdf",
  "image",
  "marketing",
  "ecommerce-vn",
];

/**
 * Clusters with at least one published tool. `marketing` and `ecommerce-vn`
 * have none, so they 404 rather than render an empty page.
 */
export const POPULATED_CLUSTERS: readonly ClusterId[] = CLUSTER_ORDER.filter((c) =>
  toolMetas.some((m) => m.cluster === c && m.published !== false),
);

export function isPopulatedCluster(s: string): s is ClusterId {
  return (POPULATED_CLUSTERS as readonly string[]).includes(s);
}

export function offeredIn(meta: Pick<ToolMeta, "availableLocales">, locale: string): boolean {
  return !meta.availableLocales || (meta.availableLocales as readonly string[]).includes(locale);
}

/** Tools a visitor in this locale may be shown: published and offered in it. */
export function listedTools(locale: string, cluster?: string): ToolMeta[] {
  return toolMetas.filter(
    (m) => m.published !== false && offeredIn(m, locale) && (cluster === undefined || m.cluster === cluster),
  );
}

export function findTool(cluster: string, slug: string): ToolMeta | undefined {
  return toolMetas.find((m) => m.cluster === cluster && m.slug === slug);
}

export function toolTitle(meta: ToolMeta, locale: string): string {
  return meta.title[locale] ?? meta.title.en ?? meta.slug;
}

export function toolDescription(meta: ToolMeta, locale: string): string {
  return meta.description[locale] ?? meta.description.en ?? "";
}

export function toolPath(locale: string, meta: Pick<ToolMeta, "cluster" | "slug">): string {
  return `/${locale}/${meta.cluster}/${meta.slug}`;
}

/** The slim shape a page sends to the browser for search: no suggestions. */
export type CatalogEntry = {
  slug: string;
  cluster: ClusterId;
  title: string;
  description: string;
  keywords: string[];
  priority: ToolMeta["priority"];
  ported: boolean;
};

export function catalogEntries(locale: PublicLng, cluster?: string): CatalogEntry[] {
  return listedTools(locale, cluster).map((m) => ({
    slug: m.slug,
    cluster: m.cluster,
    title: toolTitle(m, locale),
    description: toolDescription(m, locale),
    keywords: m.keywords,
    priority: m.priority,
    ported: isPorted(m.slug),
  }));
}

const PRIORITY_RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

export const SORTS = ["popular", "az", "recent"] as const;
export type Sort = (typeof SORTS)[number];

/** The old catalog's filter: a substring of slug, title, description or keywords. */
export function filterCatalog(
  entries: CatalogEntry[],
  { query, cluster, sort, locale }: { query: string; cluster: string; sort: Sort; locale: string },
): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  let out = cluster === "all" ? entries : entries.filter((e) => e.cluster === cluster);
  if (q) {
    out = out.filter((e) =>
      [e.slug, e.title, e.description, ...e.keywords].join(" ").toLowerCase().includes(q),
    );
  }
  switch (sort) {
    case "az":
      return [...out].sort((a, b) => a.title.localeCompare(b.title, locale));
    case "recent":
      // Registry order is the order tools were added.
      return [...out].reverse();
    default:
      return [...out].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99));
  }
}

/** Sibling tools for "More … tools": same cluster, listed, ported first. */
export function relatedTools(meta: ToolMeta, locale: string, limit = 6): ToolMeta[] {
  return listedTools(locale, meta.cluster)
    .filter((m) => m.slug !== meta.slug)
    .sort((a, b) => Number(isPorted(b.slug)) - Number(isPorted(a.slug)))
    .slice(0, limit);
}

/** The tool's hand-written next steps, resolved and limited to listed tools. */
export function nextSteps(meta: ToolMeta, locale: string): { meta: ToolMeta; reason: string }[] {
  return (meta.nextStepSuggestions ?? []).flatMap((s) => {
    const m = toolMetas.find((x) => x.slug === s.tool);
    if (!m || m.published === false || !offeredIn(m, locale)) return [];
    return [{ meta: m, reason: s.reason[locale] ?? s.reason.en ?? "" }];
  });
}
