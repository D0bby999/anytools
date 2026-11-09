/**
 * public.rankings.tsx
 * `/{locale}/rankings`: user-first monthly software & service rankings index.
 * Inspired by affiliate.watch/categories' scannable directory, rebuilt around
 * transparent 4-criterion user scores (Performance, Value, Reliability, Support)
 * rather than affiliate commission rates.
 */
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.rankings";
import { RankingDirectory } from "~/components/tools-site/ranking-directory";
import { Plate } from "~/components/ui/plate";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { listRankingCategories } from "~/lib/tools/rankings.server";
import { pagesT, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, breadcrumbSchema, clampMetaDescription, ogImage, pageMeta } from "~/lib/tools/seo";

/** The directory has its own `[data-tools-search]` box. */
export const handle = { ownSearch: true };

export function loader({ params, request }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const t = pagesT(locale);
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return {
    locale,
    origin: APP_URL,
    q,
    pages: pagesMessages(locale),
    categories: listRankingCategories(locale),
    seo: {
      title: t("rankings.metaTitle"),
      label: t("rankings.title"),
      description: clampMetaDescription(t("rankings.description")),
    },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo } = data;
  const path = (l: string) => `/${l}/rankings`;
  return [
    ...pageMeta({
      title: seo.title,
      description: seo.description,
      url: `${origin}${path(locale)}`,
      image: ogImage(origin),
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
    {
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: seo.label, url: `${origin}${path(locale)}` },
      ]),
    },
  ];
}

export default function RankingsPage() {
  const { locale, q, pages, categories } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");

  return (
    <div className="lp-layout px-4 py-8 lg:px-6 lg:py-12">
      <header className="lp-page-enter grid items-center gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
        <div className="max-w-(--lp-measure-read)">
          <h1 className="text-3xl leading-tight lg:text-5xl">{t("rankings.title")}</h1>
          <p className="mt-4 text-lg leading-snug text-muted-foreground">{t("rankings.lede")}</p>
        </div>
        <Plate
          name="rankings-hero"
          sizes="(min-width: 1024px) 35vw, 100vw"
          className="hidden sm:block max-w-[340px] justify-self-end"
          priority
        />
      </header>

      <div className="mt-8">
        <RankingDirectory locale={locale} categories={categories} initialQuery={q} />
      </div>
    </div>
  );
}

