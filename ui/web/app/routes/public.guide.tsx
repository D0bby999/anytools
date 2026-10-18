/**
 * public.guide.tsx
 * `/{locale}/guides/{slug}`: one guide, as the old site served it, with its
 * Article JSON-LD and no ad slot. An unknown slug is a 404. Its links to tools
 * go through the same localizer as the tool articles, so a link in a
 * Vietnamese guide lands on the Vietnamese tool page where there is one.
 */
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.guide";
import { Article } from "~/components/tools-site/article";
import { APP_URL } from "~/lib/env.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { localizeArticleLinks } from "~/lib/tools/links.server";
import { pagesMessages } from "~/lib/tools/messages.server";
import { guideLocales, loadGuide } from "~/lib/tools/pages.server";
import { notFound, pagesT, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, breadcrumbSchema, clampMetaDescription, MAX_TITLE_CHARS, pageMeta, ogImage } from "~/lib/tools/seo";

/** Guide titles are long; the brand suffix goes where it would push past what Google shows. */
function guideTitle(title: string): string {
  const full = `${title} | AnyTools`;
  return full.length <= MAX_TITLE_CHARS ? full : title;
}

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const slug = params.slug ?? "";
  const guide = loadGuide(locale, slug);
  if (!guide) notFound();
  const t = pagesT(locale);
  return {
    locale,
    origin: APP_URL,
    slug,
    pages: pagesMessages(locale),
    locales: guideLocales(slug),
    title: guide.title,
    description: guide.description,
    updated: guide.updated,
    readingTime: guide.readingTime,
    source: localizeArticleLinks(guide.source, locale),
    guidesLabel: t("guides.title"),
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, slug } = data;
  const path = (l: string) => `/${l}/guides/${slug}`;
  const url = `${origin}${path(locale)}`;
  return [
    ...pageMeta({
      title: guideTitle(data.title),
      description: clampMetaDescription(data.description),
      url,
      image: ogImage(origin),
      locale,
      indexable: true,
      alternateLocales: data.locales,
    }),
    ...alternateLinks(origin, path, locale, data.locales),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: data.title,
        description: data.description,
        inLanguage: locale,
        ...(data.updated ? { datePublished: data.updated, dateModified: data.updated } : {}),
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
      },
    },
    {
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: data.guidesLabel, url: `${origin}/${locale}/guides` },
        { name: data.title, url },
      ]),
    },
  ];
}

export default function GuidePage() {
  const { locale, pages, title, description, updated, readingTime, source } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");
  const facts = [updated ? t("guides.updated", { date: updated }) : null, readingTime ? t("guides.readingTime", { count: readingTime }) : null].filter(Boolean);

  return (
    <article className="lp-measure px-4 py-8 lg:py-12">
      <header className="lp-page-enter">
        <h1 className="text-3xl leading-tight lg:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-lg leading-snug text-muted-foreground">{description}</p>}
        {facts.length > 0 && <p className="mt-3 text-sm text-faint">{facts.join(" · ")}</p>}
      </header>
      <div className="mt-8">
        <Article source={source} standalone />
      </div>
      <p className="mt-12 border-t pt-6 text-sm">
        <Link to={`/${locale}/guides`} className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4">
          {t("guides.all")}
        </Link>
      </p>
    </article>
  );
}
