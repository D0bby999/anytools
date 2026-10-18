import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { filterCatalog, SORTS, type CatalogEntry, type Sort } from "~/lib/tools/catalog";
import { cn } from "~/lib/utils";
import { SEARCH_ATTR } from "./public-shell";
import { ToolRows } from "./tool-rows";

/**
 * The tools home's search, cluster filter and sort. The server renders the
 * list the URL asks for (`?q=`, `?cluster=`, `?sort=`; the header search and
 * the WebSite SearchAction both land here), and an unfiltered URL renders
 * every tool, which is what a crawler should see: every tool page is linked
 * from this one. Typing filters in place and keeps the URL shareable with
 * replaceState rather than a navigation, so no loader reruns per keystroke.
 */
export function ToolCatalog({
  locale,
  entries,
  clusters,
  initial,
}: {
  locale: string;
  entries: CatalogEntry[];
  clusters: { id: string; count: number }[];
  initial: { query: string; cluster: string; sort: Sort };
}) {
  const { t } = useTranslation("tools");
  const [query, setQuery] = useState(initial.query);
  const [cluster, setCluster] = useState(initial.cluster);
  const [sort, setSort] = useState<Sort>(initial.sort);
  const deferredQuery = useDeferredValue(query);

  const visible = useMemo(
    () => filterCatalog(entries, { query: deferredQuery, cluster, sort, locale }),
    [entries, deferredQuery, cluster, sort, locale],
  );

  function sync(next: Partial<{ query: string; cluster: string; sort: Sort }>) {
    const q = next.query ?? query;
    const c = next.cluster ?? cluster;
    const s = next.sort ?? sort;
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (c !== "all") params.set("cluster", c);
    if (s !== "popular") params.set("sort", s);
    const str = params.toString();
    window.history.replaceState(window.history.state, "", str ? `?${str}` : window.location.pathname);
  }

  const sortLabels: Record<Sort, string> = {
    popular: t("catalog.sortPopular"),
    az: t("catalog.sortAz"),
    recent: t("catalog.sortRecent"),
  };
  const placeholder = t("catalog.searchPlaceholder", { count: entries.length });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">{placeholder}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            {...{ [SEARCH_ATTR]: "" }}
            onChange={(e) => {
              setQuery(e.target.value);
              sync({ query: e.target.value });
            }}
            placeholder={placeholder}
            className="h-11 w-full rounded-md border bg-card pr-10 pl-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                sync({ query: "" });
              }}
              aria-label={t("catalog.clear")}
              className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md border-0 text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("catalog.sortLabel")}</span>
          <select
            value={sort}
            onChange={(e) => {
              const next = e.target.value as Sort;
              setSort(next);
              sync({ sort: next });
            }}
            className="h-11 rounded-md border bg-card px-3 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabels[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div role="group" aria-label={t("catalog.filterLabel")} className="flex flex-wrap gap-2">
        {[{ id: "all", count: entries.length }, ...clusters].map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={cluster === c.id}
            onClick={() => {
              setCluster(c.id);
              sync({ cluster: c.id });
            }}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
              cluster === c.id
                ? "border-primary bg-selected font-medium text-selected-foreground"
                : "bg-card hover:bg-primary-soft",
            )}
          >
            {c.id === "all" ? t("catalog.clusterAll") : t(`catalog.cluster.${c.id}`)}
            <span className="font-mono text-2xs text-muted-foreground">{c.count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div role="status" className="border-y py-10 text-center">
          <p className="font-medium">{t("catalog.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("catalog.emptyBody")}</p>
        </div>
      ) : (
        <ToolRows locale={locale} tools={visible} showCluster={cluster === "all"} />
      )}

      <p role="status" className="text-center text-xs text-muted-foreground">
        {t("catalog.showing", { visible: visible.length, total: entries.length })}
      </p>
    </div>
  );
}
