/**
 * ranking-table.tsx
 * Interactive category leaderboard for `/{locale}/rankings/{category}`.
 * Supports sub-niche tag filtering, free-trial toggle, criterion sorting
 * (overall score, value, performance, reliability), one-click coupon copy,
 * transparent `/go/{slug}` affiliate links with printed destination domain,
 * and an expandable `<details>` rubric breakdown with pros/cons and monthly
 * audit changelog.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Award, Check, Copy, ExternalLink, Minus, ShieldCheck, Sparkles } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { RankingLogo } from "~/components/tools-site/ranking-logo";
import {
  filterAndSortItems,
  type CriterionKey,
  type ItemSort,
  type RankingItemView,
  type RankingTagOption,
} from "~/lib/tools/rankings";

interface RankingTableProps {
  locale: PublicLng;
  month: string;
  methodologyNote: string;
  monthlySummary: string;
  criteriaLabels: Record<CriterionKey, string>;
  tagOptions: RankingTagOption[];
  items: RankingItemView[];
}

export function RankingTable({
  locale,
  month,
  methodologyNote,
  monthlySummary,
  criteriaLabels,
  tagOptions,
  items,
}: RankingTableProps) {
  const { t } = useTranslation("pages");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [freeTrialOnly, setFreeTrialOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<ItemSort>("score");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const visibleItems = useMemo(
    () =>
      filterAndSortItems(items, {
        tag: activeTag === "all" ? undefined : activeTag,
        freeTrialOnly,
        sort: sortBy,
      }),
    [items, activeTag, freeTrialOnly, sortBy],
  );

  function handleCopyCoupon(slug: string, code: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(code);
    }
    setCopiedSlug(slug);
    setTimeout(() => {
      setCopiedSlug((prev) => (prev === slug ? null : prev));
    }, 2000);
  }

  return (
    <div className="space-y-6">
      {/* Methodology & affiliate independence disclosure */}
      <aside className="lp-keybox space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            {t("rankings.disclosureTitle")}
          </p>
          <span data-numeric className="font-mono text-xs text-muted-foreground">
            {t("rankings.updatedMonth", { month })}
          </span>
        </div>
        <p className="leading-relaxed text-muted-foreground">{methodologyNote}</p>
        {monthlySummary && <p className="text-xs text-muted-foreground">{monthlySummary}</p>}
        <p className="text-xs text-faint">{t("rankings.disclosureBody")}</p>
      </aside>

      {/* Top 3 Quick Picks Podium */}
      {items.length >= 3 && (
        <section aria-label="Top 3 Picks" className="space-y-3">
          <div className="flex items-center gap-2">
            <Award aria-hidden="true" className="size-4 text-primary" />
            <span className="font-serif text-base font-semibold text-foreground">
              {locale === "vi" ? "Top 3 Lựa chọn hàng đầu" : "Top 3 Recommended"}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {items.slice(0, 3).map((podiumItem, idx) => {
              const isWinner = idx === 0;
              const rankBadge = idx === 0 ? "#1" : idx === 1 ? "#2" : "#3";
              const rankTitle =
                idx === 0
                  ? locale === "vi" ? "Quán quân tổng thể" : "Top Pick"
                  : idx === 1
                    ? locale === "vi" ? "Giá trị tốt nhất" : "Best Value"
                    : locale === "vi" ? "Lựa chọn tiêu biểu" : "Runner Up";
              return (
                <div
                  key={podiumItem.slug}
                  className={cn(
                    "flex flex-col justify-between rounded-xl border p-4 transition-colors",
                    isWinner ? "border-primary/60 bg-selected/20" : "border-border bg-card",
                  )}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "rounded px-2 py-0.5 font-mono text-xs font-bold",
                          isWinner ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        )}
                      >
                        {rankBadge} · {rankTitle}
                      </span>
                      <div className="flex items-baseline gap-1 font-mono">
                        <span className="text-base font-bold text-primary">
                          {podiumItem.userScore.toFixed(1)}
                        </span>
                        <span className="text-xs text-muted-foreground">/ 10</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <RankingLogo domain={podiumItem.websiteDomain} name={podiumItem.name} size={36} />
                      <div className="min-w-0">
                        <h3 className="truncate font-serif text-base font-semibold text-foreground">
                          {podiumItem.name}
                        </h3>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground">
                          {podiumItem.startingPrice}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                      {podiumItem.bestFor}
                    </p>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {podiumItem.freeTrial && (
                        <span className="rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                          {t("rankings.freeTrialBadge")}
                        </span>
                      )}
                      {podiumItem.dealBadge && (
                        <span className="rounded bg-selected px-2 py-0.5 font-medium text-selected-foreground">
                          {podiumItem.dealBadge}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 border-t border-border/60 pt-3">
                    <a
                      href={`${podiumItem.affiliatePath}?loc=${locale}&pos=${podiumItem.rank}`}
                      target="_blank"
                      rel="sponsored noopener"
                      className={cn(
                        "inline-flex w-full min-h-10 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-opacity hover:opacity-90",
                        isWinner ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-hover",
                      )}
                    >
                      <span>{t("rankings.visitSite")}</span>
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Controls: tag filter pills, free-trial toggle, and criterion sort */}
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("rankings.filterTagLabel")}>
          <button
            type="button"
            aria-pressed={activeTag === "all"}
            onClick={() => setActiveTag("all")}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              activeTag === "all"
                ? "bg-selected text-selected-foreground"
                : "bg-muted text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {t("rankings.filterAll")}
          </button>
          {tagOptions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              aria-pressed={activeTag === tag.id}
              onClick={() => setActiveTag(tag.id)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                activeTag === tag.id
                  ? "bg-selected text-selected-foreground"
                  : "bg-muted text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              {tag.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-pressed={freeTrialOnly}
            onClick={() => setFreeTrialOnly((v) => !v)}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              freeTrialOnly
                ? "border-primary bg-selected text-selected-foreground"
                : "border-control-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground",
            )}
          >
            {t("rankings.freeTrialOnly")}
          </button>

          <div className="flex items-center gap-2">
            <label htmlFor="ranking-item-sort" className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              {t("rankings.itemSortLabel")}
            </label>
            <select
              id="ranking-item-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ItemSort)}
              className="h-11 rounded-md border border-control-border bg-background px-3 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="score">{t("rankings.itemSortScore")}</option>
              <option value="value">{t("rankings.itemSortValue")}</option>
              <option value="performance">{t("rankings.itemSortPerformance")}</option>
              <option value="reliability">{t("rankings.itemSortReliability")}</option>
            </select>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("rankings.showingItems", { shown: visibleItems.length, total: items.length })}
      </p>

      {/* Ranked rows */}
      {visibleItems.length === 0 ? (
        <div className="lp-empty">
          <p className="font-serif text-lg font-semibold text-foreground">{t("rankings.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("rankings.emptyBody")}</p>
        </div>
      ) : (
        <ol className="space-y-4">
          {visibleItems.map((item) => (
            <li
              key={item.slug}
              id={`rank-${item.slug}`}
              className="rounded-lg border bg-card p-5 transition-colors"
            >
              <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
                {/* Rank badge + monthly delta */}
                <div className="flex items-center gap-3 lg:flex-col lg:items-center lg:gap-1.5 lg:pr-2">
                  <span
                    data-numeric
                    className={cn(
                      "inline-flex size-11 items-center justify-center rounded-md font-mono text-lg font-bold",
                      item.rank === 1
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    #{item.rank}
                  </span>
                  <RankDeltaBadge delta={item.rankDelta} />
                </div>

                {/* Product logo, summary, best-for, pricing, and coupon */}
                <div className="flex items-start gap-3.5 min-w-0">
                  <RankingLogo
                    domain={item.websiteDomain}
                    name={item.name}
                    size={42}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-serif text-2xl leading-tight font-semibold text-foreground">
                        {item.name}
                      </h2>
                      <span className="rounded bg-selected px-2.5 py-0.5 text-xs font-semibold text-selected-foreground">
                        {item.bestFor}
                      </span>
                      {item.freeTrial && (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {t("rankings.freeTrialBadge")}
                        </span>
                      )}
                    </div>

                    <p className="text-sm leading-relaxed text-muted-foreground">{item.summary}</p>

                    {/* Pricing + deal badge + copyable coupon */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs">
                      <div>
                        <span className="text-muted-foreground">{t("rankings.startingAt")}: </span>
                        <span data-numeric className="font-mono font-semibold text-foreground">
                          {item.startingPrice}
                        </span>
                      </div>

                      {item.dealBadge && (
                        <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                          {item.dealBadge}
                        </span>
                      )}

                      {item.couponCode && (
                        <button
                          type="button"
                          onClick={() => handleCopyCoupon(item.slug, item.couponCode!)}
                          aria-label={t("rankings.copyCoupon", { code: item.couponCode })}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded border border-dashed border-control-border bg-background px-2.5 py-1 font-mono text-xs font-semibold text-foreground hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <span>
                            {t("rankings.couponLabel")}: {item.couponCode}
                          </span>
                          {copiedSlug === item.slug ? (
                            <span className="inline-flex items-center gap-1 text-primary">
                              <Check aria-hidden="true" className="size-3.5" />
                              {t("rankings.copiedCoupon")}
                            </span>
                          ) : (
                            <Copy aria-hidden="true" className="size-3.5 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* User score + outbound CTA with printed destination domain */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
                  <div className="text-left lg:text-right">
                    <div className="text-xs font-medium text-muted-foreground">{t("rankings.userScoreLabel")}</div>
                    <div data-numeric className="font-mono text-2xl font-bold text-primary">
                      {item.userScore.toFixed(1)}
                      <span className="text-sm font-normal text-muted-foreground"> / 10</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start gap-1 lg:items-end">
                    <a
                      href={`${item.affiliatePath}?loc=${locale}&pos=${item.rank}`}
                      target="_blank"
                      rel="sponsored noopener"
                      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span>{t("rankings.visitSite")}</span>
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </a>
                    <span className="font-mono text-xs text-faint">{item.websiteDomain}</span>
                  </div>
                </div>
              </div>

              {/* Expandable 4-criterion breakdown + Pros/Cons + monthly changelog */}
              <details className="group mt-4 border-t pt-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-muted-foreground select-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span>{t("rankings.detailsSummary")}</span>
                </summary>

                <div className="mt-4 grid gap-6 lg:grid-cols-3">
                  {/* 4-criterion score bars */}
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold text-foreground">
                      {t("rankings.criteriaHeading")}
                    </h3>
                    <CriterionRow
                      label={`${criteriaLabels.performance || t("rankings.criterionPerformance")} (35%)`}
                      score={item.criteria.performance}
                    />
                    <CriterionRow
                      label={`${criteriaLabels.value || t("rankings.criterionValue")} (30%)`}
                      score={item.criteria.value}
                    />
                    <CriterionRow
                      label={`${criteriaLabels.reliability || t("rankings.criterionReliability")} (20%)`}
                      score={item.criteria.reliability}
                    />
                    <CriterionRow
                      label={`${criteriaLabels.support || t("rankings.criterionSupport")} (15%)`}
                      score={item.criteria.support}
                    />
                  </div>

                  {/* Pros & Cons */}
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {t("rankings.prosHeading")}
                      </h3>
                      <ul className="mt-1.5 space-y-1 text-sm text-foreground">
                        {item.pros.map((pro, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span aria-hidden="true" className="font-bold text-primary">+</span>
                            <span>{pro}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-muted-foreground">
                        {t("rankings.consHeading")}
                      </h3>
                      <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                        {item.cons.map((con, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span aria-hidden="true" className="font-bold text-muted-foreground">−</span>
                            <span>{con}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Monthly audit note */}
                  {item.changeNote && (
                    <div className="space-y-1.5 rounded-md bg-muted p-3.5 text-sm">
                      <h3 className="text-sm font-semibold text-foreground">
                        {t("rankings.monthlyLogHeading")} ({month})
                      </h3>
                      <p className="leading-relaxed text-foreground">{item.changeNote}</p>
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function CriterionRow({ label, score }: { label: string; score: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 10)));
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span data-numeric className="font-mono font-semibold text-foreground">
          {score.toFixed(1)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RankDeltaBadge({ delta }: { delta: number | "new" }) {
  const { t } = useTranslation("pages");
  if (delta === "new") {
    return (
      <span
        title={t("rankings.deltaNew")}
        className="inline-flex items-center gap-0.5 rounded bg-selected px-1.5 py-0.5 font-mono text-xs font-semibold text-selected-foreground"
      >
        <Sparkles aria-hidden="true" className="size-3" />
        NEW
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span
        data-numeric
        title={t("rankings.deltaUp", { count: delta })}
        className="inline-flex items-center gap-0.5 font-mono text-xs font-semibold text-primary"
      >
        <ArrowUp aria-hidden="true" className="size-3" />
        {delta}
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span
        data-numeric
        title={t("rankings.deltaDown", { count: Math.abs(delta) })}
        className="inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground"
      >
        <ArrowDown aria-hidden="true" className="size-3" />
        {Math.abs(delta)}
      </span>
    );
  }
  return (
    <span title={t("rankings.deltaSame")} className="inline-flex items-center font-mono text-xs text-faint">
      <Minus aria-hidden="true" className="size-3" />
    </span>
  );
}
