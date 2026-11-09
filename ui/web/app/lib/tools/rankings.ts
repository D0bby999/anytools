/**
 * tools/rankings.ts
 * Client-safe types, weighted user-value rubric, and filter/sort helpers for
 * the public user-first rankings directory (`/{locale}/rankings` and
 * `/{locale}/rankings/{category}`).
 *
 * Unlike affiliate directories that rank by payout or commission, every item
 * here is scored on four user-centric criteria (0.0 to 10.0) with fixed weights:
 * performance (35%), value for money (30%), reliability & privacy (20%), and
 * support & ease of use (15%).
 */
import type { PublicLng } from "~/lib/i18n";

export const RANKING_CATEGORY_IDS = [
  "proxies",
  "seo-tools",
  "ai-tools",
  "antidetect-browsers",
  "vps-hosting",
] as const;

export type RankingCategoryId = (typeof RANKING_CATEGORY_IDS)[number];

export function isRankingCategoryId(value: string | undefined): value is RankingCategoryId {
  return (RANKING_CATEGORY_IDS as readonly string[]).includes(value ?? "");
}

export const CRITERION_KEYS = ["performance", "value", "reliability", "support"] as const;
export type CriterionKey = (typeof CRITERION_KEYS)[number];

export const CRITERION_WEIGHTS: Record<CriterionKey, number> = {
  performance: 0.35,
  value: 0.3,
  reliability: 0.2,
  support: 0.15,
};

export type RankingCriteria = Record<CriterionKey, number>;

/** Deterministic 0.0–10.0 user score from the four weighted criteria, rounded to 1 decimal. */
export function computeUserScore(criteria: RankingCriteria): number {
  const raw =
    criteria.performance * CRITERION_WEIGHTS.performance +
    criteria.value * CRITERION_WEIGHTS.value +
    criteria.reliability * CRITERION_WEIGHTS.reliability +
    criteria.support * CRITERION_WEIGHTS.support;
  return Math.round(raw * 10) / 10;
}

export const CATEGORY_SORTS = ["count", "az", "updated"] as const;
export type CategorySort = (typeof CATEGORY_SORTS)[number];

export const ITEM_SORTS = ["score", "value", "performance", "reliability"] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

export type RankingItemView = {
  slug: string;
  name: string;
  rank: number;
  rankDelta: number | "new";
  userScore: number;
  criteria: RankingCriteria;
  startingPrice: string;
  freeTrial: boolean;
  tags: string[];
  bestFor: string;
  summary: string;
  pros: string[];
  cons: string[];
  changeNote: string | null;
  dealBadge: string | null;
  couponCode: string | null;
  affiliatePath: string;
  websiteDomain: string;
};

export type RankingCategorySummary = {
  slug: RankingCategoryId;
  month: string;
  updated: string;
  title: string;
  tagline: string;
  description: string;
  itemCount: number;
  topPick: {
    slug: string;
    name: string;
    userScore: number;
    bestFor: string;
    startingPrice: string;
    websiteDomain?: string;
  };
  itemsPreview: {
    slug: string;
    name: string;
    rank: number;
    userScore: number;
    bestFor: string;
    tags: string[];
    websiteDomain?: string;
  }[];
};

export type RankingTagOption = {
  id: string;
  label: string;
  count: number;
};

export type RankingFaq = {
  q: string;
  a: string;
};

export type RankingCategoryDetail = {
  slug: RankingCategoryId;
  month: string;
  updated: string;
  title: string;
  tagline: string;
  description: string;
  methodologyNote: string;
  monthlySummary: string;
  criteriaLabels: Record<CriterionKey, string>;
  tagOptions: RankingTagOption[];
  items: RankingItemView[];
  buyingGuide: string[];
  faqs: RankingFaq[];
};

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export function sortRankingCategories(
  categories: readonly RankingCategorySummary[],
  sort: CategorySort,
  locale: PublicLng | string,
): RankingCategorySummary[] {
  const copy = [...categories];
  if (sort === "az") {
    return copy.sort((a, b) => a.title.localeCompare(b.title, locale));
  }
  if (sort === "updated") {
    return copy.sort((a, b) => b.updated.localeCompare(a.updated) || b.itemCount - a.itemCount);
  }
  // Default "count": highest number of tested services first (like affiliate.watch/categories),
  // breaking ties by canonical RANKING_CATEGORY_IDS order.
  return copy.sort(
    (a, b) =>
      b.itemCount - a.itemCount ||
      RANKING_CATEGORY_IDS.indexOf(a.slug) - RANKING_CATEGORY_IDS.indexOf(b.slug),
  );
}

export function filterRankingCategories(
  categories: readonly RankingCategorySummary[],
  opts: { query: string; sort: CategorySort; locale: PublicLng | string },
): RankingCategorySummary[] {
  const q = fold(opts.query.trim());
  const filtered = q
    ? categories.filter((c) => {
        if (fold(`${c.title} ${c.tagline} ${c.description}`).includes(q)) return true;
        return c.itemsPreview.some((item) =>
          fold(`${item.name} ${item.bestFor} ${item.tags.join(" ")}`).includes(q),
        );
      })
    : categories;
  return sortRankingCategories(filtered, opts.sort, opts.locale);
}

export function filterAndSortItems(
  items: readonly RankingItemView[],
  opts: { query?: string; tag?: string; freeTrialOnly?: boolean; sort?: ItemSort },
): RankingItemView[] {
  const q = fold((opts.query ?? "").trim());
  const tag = opts.tag && opts.tag !== "all" ? opts.tag : null;
  const sort = opts.sort ?? "score";

  const filtered = items.filter((item) => {
    if (tag && !item.tags.includes(tag)) return false;
    if (opts.freeTrialOnly && !item.freeTrial) return false;
    if (q) {
      const hay = fold(
        `${item.name} ${item.bestFor} ${item.summary} ${item.tags.join(" ")} ${item.websiteDomain}`,
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sort === "value") return b.criteria.value - a.criteria.value || a.rank - b.rank;
    if (sort === "performance") return b.criteria.performance - a.criteria.performance || a.rank - b.rank;
    if (sort === "reliability") return b.criteria.reliability - a.criteria.reliability || a.rank - b.rank;
    return a.rank - b.rank;
  });
}

