/**
 * public.home.tsx
 * `/{locale}`: the tools home. What the site is in two lines, every cluster,
 * and the catalog with its search. Every listed tool is linked from here.
 */
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.home";
import { AnyProfileFeature } from "~/components/tools-site/anyprofile-feature";
import { ToolCatalog } from "~/components/tools-site/tool-catalog";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { catalogEntries, POPULATED_CLUSTERS, SORTS, type Sort } from "~/lib/tools/catalog";
import { publicLocale, toolsT } from "~/lib/tools/route.server";
import { alternateLinks, pageMeta } from "~/lib/tools/seo";

/** The page has its own search box; the header leaves its one out. */
export const handle = { ownSearch: true };

export function loader({ params, request }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const t = toolsT(locale);
  const entries = catalogEntries(locale);
  const url = new URL(request.url);
  const cluster = url.searchParams.get("cluster") ?? "all";
  const sort = url.searchParams.get("sort") ?? "popular";
  const clusters = POPULATED_CLUSTERS.map((id) => ({ id, count: entries.filter((e) => e.cluster === id).length })).filter(
    (c) => c.count > 0,
  );
  return {
    locale,
    origin: APP_URL,
    entries,
    clusters,
    initial: {
      query: (url.searchParams.get("q") ?? "").slice(0, 100),
      cluster: clusters.some((c) => c.id === cluster) ? cluster : "all",
      sort: (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : "popular",
    },
    seo: {
      title: t("home.metaTitle", { count: entries.length }),
      description: t("home.metaDescription"),
    },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo } = data;
  const path = (l: string) => `/${l}`;
  return [
    ...pageMeta({
      title: seo.title,
      description: seo.description,
      url: `${origin}${path(locale)}`,
      image: `${origin}/og.png`,
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "AnyTools",
        url: `${origin}${path(locale)}`,
        inLanguage: locale,
        potentialAction: {
          "@type": "SearchAction",
          target: { "@type": "EntryPoint", urlTemplate: `${origin}/${locale}?q={search_term_string}` },
          "query-input": "required name=search_term_string",
        },
      },
    },
  ];
}

export default function ToolsHome() {
  const { locale, entries, clusters, initial } = useLoaderData<typeof loader>();
  const { t } = useTranslation("tools");

  return (
    <div className="lp-layout px-4 py-8 lg:px-6 lg:py-10">
      {/* AnyProfile leads the appendix (owner, 2026-10-18). */}
      <AnyProfileFeature locale={locale} />

      <header className="mt-12 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-(--lp-measure-read)">
          <h1 className="text-3xl leading-tight lg:text-4xl">{t("home.heroTitle")}</h1>
          <p className="mt-3 text-lg leading-snug text-muted-foreground">{t("home.heroSubtitle")}</p>
        </div>
        <p className="text-sm text-muted-foreground lg:text-right">{t("home.eyebrow", { count: entries.length })}</p>
      </header>

      <section aria-labelledby="tools-clusters" className="mt-10">
        <h2 id="tools-clusters" className="lp-section text-xl">
          {t("catalog.clustersTitle")}
        </h2>
        {/* The appendix's sections, as an index: name, then how many tools. */}
        <ul className="mt-3 grid grid-cols-1 gap-x-8 border-t sm:grid-cols-2 lg:grid-cols-3">
          {clusters.map((c) => (
            <li key={c.id} className="border-b">
              <Link
                to={`/${locale}/${c.id}`}
                className="group flex min-h-12 items-baseline gap-2 px-1 py-3 text-base transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                <span className="font-serif font-semibold group-hover:text-primary">{t(`catalog.cluster.${c.id}`)}</span>
                <span aria-hidden="true" className="lp-leader" />
                <span data-numeric className="text-sm text-muted-foreground">
                  {c.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="tools-all" className="mt-12">
        <h2 id="tools-all" className="lp-section mb-4 text-xl">
          {t("catalog.allTitle")}
        </h2>
        <ToolCatalog locale={locale} entries={entries} clusters={clusters} initial={initial} />
      </section>
    </div>
  );
}
