/**
 * public.tool.tsx
 * `/{locale}/{cluster}/{tool}`: the tool, then what to do next, its article,
 * its FAQ and its siblings. An unknown tool, a tool filed under another
 * cluster, or an English-only tool asked for in another language is a 404,
 * as on the old site.
 */
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.tool";
import { Article } from "~/components/tools-site/article";
import { ToolFrame } from "~/components/tools-site/tool-frame";
import { ToolRows } from "~/components/tools-site/tool-rows";
import { APP_URL } from "~/lib/env.server";
import { findTool, nextSteps, offeredIn, relatedTools, toolDescription, toolTitle } from "~/lib/tools/catalog";
import { isIndexableTool, loadToolContent, toolLocales } from "~/lib/tools/content.server";
import { localizeArticleLinks } from "~/lib/tools/links.server";
import { notFound, publicLocale, toolsT } from "~/lib/tools/route.server";
import {
  alternateLinks,
  breadcrumbSchema,
  buildToolTitle,
  clusterSeoLabel,
  faqSchema,
  pageMeta,
  ogImage,
  softwareAppSchema,
} from "~/lib/tools/seo";
import { isPorted } from "~/tools/ui-registry";

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const meta = findTool(params.cluster, params.tool);
  if (!meta || !offeredIn(meta, locale)) notFound();

  const t = toolsT(locale);
  const content = loadToolContent(locale, meta.cluster, meta.slug);
  const title = toolTitle(meta, locale);
  const row = (m: typeof meta) => ({
    slug: m.slug,
    cluster: m.cluster,
    title: toolTitle(m, locale),
    description: toolDescription(m, locale),
    ported: isPorted(m.slug),
  });
  return {
    locale,
    origin: APP_URL,
    slug: meta.slug,
    cluster: meta.cluster,
    title,
    description: toolDescription(meta, locale),
    keywords: meta.keywords,
    clusterLabel: t(`catalog.cluster.${meta.cluster}`),
    // The switcher offers only the locales this page exists in.
    locales: toolLocales(meta),
    indexable: isIndexableTool(meta, locale),
    alternates: toolLocales(meta).filter((l) => isIndexableTool(meta, l)),
    tutorial: content.tutorial ? localizeArticleLinks(content.tutorial.source, locale) : null,
    faq: content.faq ? localizeArticleLinks(content.faq.source, locale) : null,
    faqItems: content.faq?.items ?? [],
    next: nextSteps(meta, locale).map((n) => ({ ...row(n.meta), description: n.reason || toolDescription(n.meta, locale) })),
    related: relatedTools(meta, locale).map(row),
    seoTitle: buildToolTitle(title, clusterSeoLabel(locale, meta.cluster), locale),
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, cluster, slug } = data;
  const path = (l: string) => `/${l}/${cluster}/${slug}`;
  const url = `${origin}${path(locale)}`;
  const tags = [
    ...pageMeta({
      title: data.seoTitle,
      description: data.description,
      url,
      image: ogImage(url),
      locale,
      indexable: data.indexable,
      alternateLocales: data.alternates,
    }),
    { name: "keywords", content: data.keywords.join(", ") },
    ...alternateLinks(origin, path, locale, data.alternates),
    {
      "script:ld+json": softwareAppSchema({ name: data.title, description: data.description, url, cluster, locale }),
    },
    {
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: data.clusterLabel, url: `${origin}/${locale}/${cluster}` },
        { name: data.title, url },
      ]),
    },
  ];
  if (data.faqItems.length > 0) tags.push({ "script:ld+json": faqSchema(data.faqItems) });
  return tags;
}

export default function ToolPage() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("tools");
  const { locale } = data;

  return (
    <div className="lp-layout px-4 py-5 lg:px-6 lg:py-8">
      <nav aria-label={t("tool.breadcrumb")} className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link to={`/${locale}`} className="inline-flex min-h-11 items-center gap-2 hover:text-foreground">
              <span aria-hidden="true" className="lp-tab">
                {t("feature.appendix")}
              </span>
              AnyTools
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link to={`/${locale}/${data.cluster}`} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
              {data.clusterLabel}
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-foreground">
            {data.title}
          </li>
        </ol>
      </nav>

      <header className="lp-page-enter mt-1 max-w-(--lp-measure-read)">
        <h1 className="text-3xl leading-tight md:text-4xl">{data.title}</h1>
        <p className="mt-2 text-base leading-snug text-muted-foreground md:text-lg">{data.description}</p>
      </header>

      {/* The tool first: a visitor who searched for it wants it above the
          fold. Each tool draws its own sheet (tools-ui Card). */}
      <section id="tool" aria-label={data.title} className="mt-6 max-w-5xl scroll-mt-4">
        <ToolFrame slug={data.slug} locale={locale} />
      </section>

      {data.next.length > 0 && (
        <section aria-labelledby="tool-next" className="mt-10 max-w-5xl">
          <h2 id="tool-next" className="lp-section mb-3">
            {t("tool.whatNext")}
          </h2>
          <ToolRows locale={locale} tools={data.next} />
        </section>
      )}

      {data.tutorial && (
        <section id="tutorial" aria-labelledby="tool-tutorial" className="mt-12 max-w-(--lp-measure-read) scroll-mt-4">
          <h2 id="tool-tutorial" className="lp-section">
            {t("tool.tutorial")}
          </h2>
          <Article source={data.tutorial} />
        </section>
      )}

      {data.faq && (
        <section id="faq" aria-labelledby="tool-faq" className="mt-12 max-w-(--lp-measure-read) scroll-mt-4">
          <h2 id="tool-faq" className="lp-section">
            {t("tool.faq")}
          </h2>
          <Article source={data.faq} />
        </section>
      )}

      {data.related.length > 0 && (
        <section aria-labelledby="tool-related" className="mt-12 max-w-5xl">
          <h2 id="tool-related" className="lp-section mb-3">
            {t("tool.related", { cluster: data.clusterLabel })}
          </h2>
          <ToolRows locale={locale} tools={data.related} />
        </section>
      )}
    </div>
  );
}
