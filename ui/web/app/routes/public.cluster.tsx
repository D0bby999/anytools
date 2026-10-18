/**
 * public.cluster.tsx
 * `/{locale}/{cluster}`: one cluster's tools, then the prose on choosing
 * between them. A cluster with no published tool here is a 404.
 */
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.cluster";
import { ToolRows } from "~/components/tools-site/tool-rows";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { catalogEntries, isPopulatedCluster } from "~/lib/tools/catalog";
import { clusterIsIndexable } from "~/lib/tools/content.server";
import { notFound, publicLocale, toolsT } from "~/lib/tools/route.server";
import { alternateLinks, breadcrumbSchema, buildToolTitle, clampMetaDescription, clusterPageNoun, pageMeta } from "~/lib/tools/seo";

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const cluster = params.cluster;
  if (!isPopulatedCluster(cluster)) notFound();
  const tools = catalogEntries(locale, cluster);
  if (tools.length === 0) notFound();

  const t = toolsT(locale);
  const label = t(`catalog.cluster.${cluster}`);
  const intro = t(`clusterLanding.${cluster}.intro`);
  const body = t(`clusterLanding.${cluster}.body`, { returnObjects: true });
  return {
    locale,
    cluster,
    origin: APP_URL,
    tools,
    body: Array.isArray(body) ? (body as string[]) : [],
    indexable: clusterIsIndexable(locale, cluster),
    // hreflang names only the locales whose page is itself indexable.
    alternates: publicLngs.filter((l) => clusterIsIndexable(l, cluster)),
    seo: {
      label,
      title: buildToolTitle(label, clusterPageNoun(locale), locale),
      description: clampMetaDescription(intro),
    },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, cluster, seo } = data;
  const path = (l: string) => `/${l}/${cluster}`;
  return [
    ...pageMeta({
      title: seo.title,
      description: seo.description,
      url: `${origin}${path(locale)}`,
      image: `${origin}/og.png`,
      locale,
      indexable: data.indexable,
      alternateLocales: data.alternates,
    }),
    ...alternateLinks(origin, path, locale, data.alternates),
    {
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: seo.label, url: `${origin}${path(locale)}` },
      ]),
    },
  ];
}

export default function ClusterPage() {
  const { locale, cluster, tools, body } = useLoaderData<typeof loader>();
  const { t } = useTranslation("tools");

  return (
    <div className="lp-layout px-4 py-8 lg:px-6 lg:py-12">
      <div className="lp-prose max-w-(--lp-measure-read)">
        <h1>{t(`catalog.cluster.${cluster}`)}</h1>
        <p className="text-lg">{t(`clusterLanding.${cluster}.tagline`)}</p>
        <p>{t(`clusterLanding.${cluster}.intro`)}</p>
      </div>

      <section aria-labelledby="cluster-tools" className="mt-8">
        <h2 id="cluster-tools" className="lp-kicker mb-3">
          {t("clusterLanding.toolCount", { count: tools.length })}
        </h2>
        <ToolRows locale={locale} tools={tools} />
      </section>

      {body.length > 0 && (
        <section aria-labelledby="cluster-body" className="mt-12 max-w-(--lp-measure-read)">
          <h2 id="cluster-body" className="lp-kicker">
            {t("clusterLanding.bodyHeading")}
          </h2>
          <div className="lp-prose">
            {body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
