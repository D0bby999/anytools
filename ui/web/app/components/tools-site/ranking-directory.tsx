/**
 * ranking-directory.tsx
 * Client-interactive category directory for `/{locale}/rankings` — inspired by
 * affiliate.watch/categories' scannable index (search + sort by tested count,
 * alphabetical, or recently updated), rebuilt around user-first scores and
 * monthly verification stamps.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Search, ShieldCheck, X } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";
import { SEARCH_ATTR } from "~/components/layout/site-header";
import { isPlateName, Plate, type PlateName } from "~/components/ui/plate";
import { RankingLogo } from "~/components/tools-site/ranking-logo";
import {
  filterRankingCategories,
  type CategorySort,
  type RankingCategorySummary,
} from "~/lib/tools/rankings";

interface RankingDirectoryProps {
  locale: PublicLng;
  categories: RankingCategorySummary[];
  initialQuery?: string;
}

export function RankingDirectory({ locale, categories, initialQuery = "" }: RankingDirectoryProps) {
  const { t } = useTranslation("pages");
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<CategorySort>("count");

  const totalTested = useMemo(
    () => categories.reduce((acc, c) => acc + c.itemCount, 0),
    [categories],
  );

  const visibleCategories = useMemo(
    () => filterRankingCategories(categories, { query, sort, locale }),
    [categories, query, sort, locale],
  );

  const matchedItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits: {
      categorySlug: string;
      categoryTitle: string;
      slug: string;
      name: string;
      bestFor: string;
      userScore: number;
      rank: number;
      websiteDomain?: string;
    }[] = [];
    for (const cat of categories) {
      for (const item of cat.itemsPreview) {
        if (
          item.name.toLowerCase().includes(q) ||
          item.bestFor.toLowerCase().includes(q) ||
          item.tags.some((tag: string) => tag.toLowerCase().includes(q))
        ) {
          hits.push({
            categorySlug: cat.slug,
            categoryTitle: cat.title,
            slug: item.slug,
            name: item.name,
            bestFor: item.bestFor,
            userScore: item.userScore,
            rank: item.rank,
            websiteDomain: item.websiteDomain,
          });
        }
      }
    }
    return hits.sort((a, b) => b.userScore - a.userScore);
  }, [categories, query]);

  return (
    <div className="space-y-8">
      {/* Reader-supported & user-first methodology callout */}
      <aside className="lp-keybox flex items-start gap-3 p-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-foreground">{t("rankings.disclosureTitle")}</p>
          <p className="leading-relaxed text-muted-foreground">{t("rankings.disclosureBody")}</p>
        </div>
      </aside>

      {/* Filter & sort bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            {...{ [SEARCH_ATTR]: "" }}
            placeholder={t("rankings.searchPlaceholder", { count: totalTested })}
            aria-label={t("rankings.searchPlaceholder", { count: totalTested })}
            className="h-11 w-full rounded-md border border-control-border bg-card pr-10 pl-10 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("rankings.clearSearch")}
              className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="ranking-cat-sort" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            {t("rankings.sortLabel")}
          </label>
          <select
            id="ranking-cat-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as CategorySort)}
            className="h-11 rounded-md border border-control-border bg-card px-3 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="count">{t("rankings.sortCount")}</option>
            <option value="az">{t("rankings.sortAz")}</option>
            <option value="updated">{t("rankings.sortUpdated")}</option>
          </select>
        </div>
      </div>

      {/* Direct product hits when searching */}
      {matchedItems.length > 0 && (
        <section aria-label={t("rankings.matchedItemsHeading")} className="rounded-xl border bg-card p-4 shadow-xs">
          <h2 className="text-sm font-semibold text-foreground">
            {t("rankings.matchedItemsHeading")}
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {matchedItems.map((hit) => (
              <li key={`${hit.categorySlug}-${hit.slug}`} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  {hit.websiteDomain && (
                    <RankingLogo domain={hit.websiteDomain} name={hit.name} size={32} />
                  )}
                  <div className="min-w-0">
                    <Link
                      to={`/${locale}/rankings/${hit.categorySlug}#rank-${hit.slug}`}
                      className="font-semibold text-foreground hover:text-primary hover:underline"
                    >
                      {hit.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      · {hit.categoryTitle} (#{hit.rank}) — {hit.bestFor}
                    </span>
                  </div>
                </div>
                <span data-numeric className="font-mono text-sm font-semibold text-primary">
                  {hit.userScore.toFixed(1)} / 10
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Category index grid */}
      {visibleCategories.length === 0 ? (
        <div className="lp-empty">
          <p className="font-serif text-lg font-semibold text-foreground">{t("rankings.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("rankings.emptyBody")}</p>
        </div>
      ) : (
        <ul className="grid gap-6 md:grid-cols-2 items-stretch">
          {visibleCategories.map((cat) => {
            const plateName = `ranking-${cat.slug}`;
            return (
              <li
                key={cat.slug}
                className="group flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50"
              >
                <div>
                  {/* Plate illustrated header */}
                  <div className="relative flex h-44 w-full items-center justify-center overflow-hidden bg-muted/20 p-4 transition-colors group-hover:bg-muted/30">
                    {isPlateName(plateName) && (
                      <Plate
                        name={plateName as PlateName}
                        sizes="(min-width: 1024px) 25vw, 50vw"
                        className="h-full w-full max-h-36 object-contain transition-transform duration-300 group-hover:scale-105"
                      />
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span data-numeric className="font-mono">
                        {t("rankings.updatedMonth", { month: cat.month })}
                      </span>
                      <span data-numeric className="rounded bg-muted px-2 py-0.5 font-mono font-medium text-foreground">
                        {t("rankings.itemsCount", { count: cat.itemCount })}
                      </span>
                    </div>

                    <h2 className="mt-2 font-serif text-2xl leading-snug font-semibold text-foreground">
                      <Link
                        to={`/${locale}/rankings/${cat.slug}`}
                        className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {cat.title}
                      </Link>
                    </h2>

                    <p className="mt-1 text-sm font-medium text-primary">
                      {cat.tagline}
                    </p>

                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground line-clamp-2">
                      {cat.description}
                    </p>

                    {/* Sub-niche tags preview */}
                    {cat.itemsPreview.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {Array.from(new Set(cat.itemsPreview.flatMap((i) => i.tags))).slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Top pick highlight and CTA */}
                <div className="border-t border-border/80 bg-muted/10 p-5">
                  <div className="rounded-lg border border-border bg-card p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {cat.topPick.websiteDomain && (
                          <RankingLogo
                            domain={cat.topPick.websiteDomain}
                            name={cat.topPick.name}
                            size={32}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                            <span className="inline-block size-1.5 rounded-full bg-primary" />
                            {t("rankings.topPickLabel")}
                          </div>
                          <p className="truncate font-serif text-sm font-semibold text-foreground">
                            {cat.topPick.name}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span data-numeric className="font-mono text-base font-bold text-primary">
                          {cat.topPick.userScore.toFixed(1)}
                        </span>
                        <span className="text-xs text-muted-foreground"> / 10</span>
                        {cat.topPick.startingPrice && (
                          <div data-numeric className="font-mono text-xs text-muted-foreground">
                            {cat.topPick.startingPrice}
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground truncate">
                      {cat.topPick.bestFor}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-end">
                    <Link
                      to={`/${locale}/rankings/${cat.slug}`}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-primary transition-colors hover:bg-selected hover:text-selected-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span>{t("rankings.viewCategory")}</span>
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
