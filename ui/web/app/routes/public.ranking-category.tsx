/**
 * public.ranking-category.tsx
 * `/{locale}/rankings/{category}`: monthly user-first leaderboard for one
 * category (e.g., proxies, seo-tools, ai-tools, antidetect-browsers, vps-hosting),
 * with ItemList + BreadcrumbList + FAQPage JSON-LD, tag filters, criterion sort,
 * transparent `/go/{slug}` affiliate links, buying guide, and FAQs.
 */
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/public.ranking-category";
import { RankingTable } from "~/components/tools-site/ranking-table";
import { isPlateName, Plate, type PlateName } from "~/components/ui/plate";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { loadRankingCategory } from "~/lib/tools/rankings.server";
import { notFound, pagesT, publicLocale } from "~/lib/tools/route.server";
import {
  alternateLinks,
  breadcrumbSchema,
  clampMetaDescription,
  faqSchema,
  itemListSchema,
  MAX_TITLE_CHARS,
  ogImage,
  pageMeta,
} from "~/lib/tools/seo";

function rankingTitle(title: string): string {
  const full = `${title} | AnyTools`;
  return full.length <= MAX_TITLE_CHARS ? full : title.slice(0, MAX_TITLE_CHARS);
}

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const categoryId = params.category ?? "";
  const category = loadRankingCategory(locale, categoryId);
  if (!category) notFound();
  const t = pagesT(locale);
  return {
    locale,
    origin: APP_URL,
    pages: pagesMessages(locale),
    category,
    rankingsLabel: t("rankings.title"),
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, category, rankingsLabel } = data;
  const path = (l: string) => `/${l}/rankings/${category.slug}`;
  const url = `${origin}${path(locale)}`;
  const tags = [
    ...pageMeta({
      title: rankingTitle(category.title),
      description: clampMetaDescription(category.description),
      url,
      image: ogImage(origin),
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
    {
      "script:ld+json": itemListSchema({
        name: category.title,
        description: category.description,
        url,
        items: category.items.map((item) => ({
          rank: item.rank,
          name: item.name,
          description: item.summary,
          url: `${origin}${item.affiliatePath}`,
          userScore: item.userScore,
        })),
      }),
    },
    {
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: rankingsLabel, url: `${origin}/${locale}/rankings` },
        { name: category.title, url },
      ]),
    },
  ];
  if (category.faqs.length > 0) {
    tags.push({ "script:ld+json": faqSchema(category.faqs) });
  }
  return tags;
}

export default function RankingCategoryPage() {
  const { locale, pages, category } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");

  return (
    <article className="lp-layout px-4 py-8 lg:px-6 lg:py-12">
      <header className="lp-page-enter grid items-center gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)]">
        <div className="max-w-(--lp-measure-read)">
          <p className="mb-3 text-sm">
            <Link
              to={`/${locale}/rankings`}
              className="inline-flex min-h-11 items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t("rankings.allCategories")}
            </Link>
          </p>
          <h1 className="text-3xl leading-tight lg:text-5xl">{category.title}</h1>
          <p className="mt-4 text-lg leading-snug text-muted-foreground">{category.description}</p>
        </div>
        {isPlateName(`ranking-${category.slug}`) && (
          <Plate
            name={`ranking-${category.slug}` as PlateName}
            sizes="(min-width: 1024px) 30vw, 100vw"
            className="hidden sm:block max-w-[320px] justify-self-end"
            priority
          />
        )}
      </header>

      <div className="mt-8">
        <RankingTable
          locale={locale}
          month={category.month}
          methodologyNote={category.methodologyNote}
          monthlySummary={category.monthlySummary}
          criteriaLabels={category.criteriaLabels}
          tagOptions={category.tagOptions}
          items={category.items}
        />
      </div>

      {/* Buying guide */}
      {category.buyingGuide.length > 0 && (
        <section className="mt-16 max-w-(--lp-measure-read)">
          <h2 className="text-2xl leading-snug lg:text-3xl">{t("rankings.buyingGuideHeading")}</h2>
          <div className="mt-4 space-y-4 text-base leading-relaxed text-muted-foreground">
            {category.buyingGuide.map((para, idx) => (
              <p key={idx}>{para}</p>
            ))}
          </div>
        </section>
      )}

      {/* FAQs */}
      {category.faqs.length > 0 && (
        <section className="mt-16 max-w-(--lp-measure-read)">
          <h2 className="text-2xl leading-snug lg:text-3xl">{t("rankings.faqHeading")}</h2>
          <div className="mt-4 divide-y border-t border-b">
            {category.faqs.map((faq, idx) => (
              <details key={idx} className="group py-4">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 font-serif text-lg font-semibold text-foreground select-none hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <span>{faq.q}</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      <p className="mt-12 border-t pt-6 text-sm">
        <Link
          to={`/${locale}/rankings`}
          className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary underline underline-offset-4"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("rankings.allCategories")}
        </Link>
      </p>
    </article>
  );
}
