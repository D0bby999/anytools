/**
 * tools/rankings.server.ts
 * Server-only loader for the user-first monthly rankings (`content/rankings/*.json`)
 * and the `/go/:slug` outbound affiliate redirect resolver.
 *
 * Raw merchant affiliate URLs stay inside this server module and are never
 * sent to the browser in page loader data; components only receive `/go/<slug>`
 * paths (`affiliatePath`) and the clean `websiteDomain`.
 */
import type { PublicLng } from "~/lib/i18n";
import {
  computeUserScore,
  isRankingCategoryId,
  RANKING_CATEGORY_IDS,
  type CriterionKey,
  type RankingCategoryDetail,
  type RankingCategoryId,
  type RankingCategorySummary,
  type RankingCriteria,
  type RankingFaq,
  type RankingItemView,
} from "./rankings";

type LocalizedCategoryText = {
  title: string;
  tagline: string;
  description: string;
  methodologyNote: string;
  monthlySummary: string;
  criteriaLabels: Record<CriterionKey, string>;
  tagLabels: Record<string, string>;
  buyingGuide: string[];
  faqs: RankingFaq[];
};

type LocalizedItemText = {
  bestFor: string;
  summary: string;
  pros: string[];
  cons: string[];
  changeNote?: string | null;
  dealBadge?: string | null;
};

export type RawRankingItem = {
  slug: string;
  name: string;
  rank: number;
  rankDelta: number | "new";
  criteria: RankingCriteria;
  startingPrice: string;
  freeTrial: boolean;
  tags: string[];
  couponCode?: string | null;
  websiteDomain: string;
  affiliateUrl: string;
  locales: Record<PublicLng, LocalizedItemText>;
};

export type RawRankingCategoryFile = {
  slug: RankingCategoryId;
  month: string;
  updated: string;
  locales: Record<PublicLng, LocalizedCategoryText>;
  items: RawRankingItem[];
};

const CATEGORY_FILES = import.meta.glob<RawRankingCategoryFile>("/content/rankings/*.json", {
  import: "default",
  eager: true,
});

function rawCategory(slug: RankingCategoryId): RawRankingCategoryFile | null {
  return CATEGORY_FILES[`/content/rankings/${slug}.json`] ?? null;
}

function toItemView(raw: RawRankingItem, locale: PublicLng): RankingItemView {
  const loc = raw.locales[locale] ?? raw.locales.en;
  return {
    slug: raw.slug,
    name: raw.name,
    rank: raw.rank,
    rankDelta: raw.rankDelta,
    userScore: computeUserScore(raw.criteria),
    criteria: raw.criteria,
    startingPrice: raw.startingPrice,
    freeTrial: raw.freeTrial,
    tags: raw.tags,
    bestFor: loc.bestFor,
    summary: loc.summary,
    pros: loc.pros,
    cons: loc.cons,
    changeNote: loc.changeNote ?? null,
    dealBadge: loc.dealBadge ?? null,
    couponCode: raw.couponCode ?? null,
    affiliatePath: `/go/${raw.slug}`,
    websiteDomain: raw.websiteDomain,
  };
}

export function listRankingCategories(locale: PublicLng): RankingCategorySummary[] {
  return RANKING_CATEGORY_IDS.flatMap((slug) => {
    const raw = rawCategory(slug);
    if (!raw || raw.items.length === 0) return [];
    const loc = raw.locales[locale] ?? raw.locales.en;
    const sorted = [...raw.items]
      .map((item) => toItemView(item, locale))
      .sort((a, b) => a.rank - b.rank);
    const top = sorted[0]!;
    return [
      {
        slug: raw.slug,
        month: raw.month,
        updated: raw.updated,
        title: loc.title,
        tagline: loc.tagline,
        description: loc.description,
        itemCount: sorted.length,
        topPick: {
          slug: top.slug,
          name: top.name,
          userScore: top.userScore,
          bestFor: top.bestFor,
          startingPrice: top.startingPrice,
          websiteDomain: top.websiteDomain,
        },
        itemsPreview: sorted.map((i) => ({
          slug: i.slug,
          name: i.name,
          rank: i.rank,
          userScore: i.userScore,
          bestFor: i.bestFor,
          tags: i.tags,
          websiteDomain: i.websiteDomain,
        })),
      },
    ];
  });
}

export function loadRankingCategory(locale: PublicLng, slug: string | undefined): RankingCategoryDetail | null {
  if (!isRankingCategoryId(slug)) return null;
  const raw = rawCategory(slug);
  if (!raw || raw.items.length === 0) return null;
  const loc = raw.locales[locale] ?? raw.locales.en;
  const items = [...raw.items]
    .map((item) => toItemView(item, locale))
    .sort((a, b) => a.rank - b.rank);

  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const tagOptions = [...tagCounts.entries()].map(([id, count]) => ({
    id,
    label: loc.tagLabels[id] ?? id,
    count,
  }));

  return {
    slug: raw.slug,
    month: raw.month,
    updated: raw.updated,
    title: loc.title,
    tagline: loc.tagline,
    description: loc.description,
    methodologyNote: loc.methodologyNote,
    monthlySummary: loc.monthlySummary,
    criteriaLabels: loc.criteriaLabels,
    tagOptions,
    items,
    buyingGuide: loc.buyingGuide,
    faqs: loc.faqs,
  };
}

export type AffiliateTarget = {
  slug: string;
  name: string;
  category: RankingCategoryId;
  url: string;
  websiteDomain: string;
};

/** Resolves an item slug for `/go/:slug` across all ranking categories. */
export function resolveAffiliateTarget(slug: string | undefined): AffiliateTarget | null {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  for (const catId of RANKING_CATEGORY_IDS) {
    const raw = rawCategory(catId);
    if (!raw) continue;
    const found = raw.items.find((i) => i.slug === slug);
    if (found) {
      return {
        slug: found.slug,
        name: found.name,
        category: catId,
        url: found.affiliateUrl,
        websiteDomain: found.websiteDomain,
      };
    }
  }
  return null;
}

/** Every bundled rankings file key, for tests verifying no orphaned JSON files. */
export function rankingFileKeys(): string[] {
  return Object.keys(CATEGORY_FILES);
}

