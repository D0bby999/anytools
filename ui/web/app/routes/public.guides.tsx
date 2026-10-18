/**
 * public.guides.tsx
 * `/{locale}/guides`: the long guides, ported from the old site, as hairline
 * rows. Every guide is written in all four languages.
 */
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.guides";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { listGuides } from "~/lib/tools/pages.server";
import { pagesT, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, breadcrumbSchema, clampMetaDescription, pageMeta } from "~/lib/tools/seo";

export function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const t = pagesT(locale);
  return {
    locale,
    origin: APP_URL,
    pages: pagesMessages(locale),
    guides: listGuides(locale),
    seo: { title: t("guides.metaTitle"), label: t("guides.title"), description: clampMetaDescription(t("guides.description")) },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo } = data;
  const path = (l: string) => `/${l}/guides`;
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
      "script:ld+json": breadcrumbSchema([
        { name: "AnyTools", url: `${origin}/${locale}` },
        { name: seo.label, url: `${origin}${path(locale)}` },
      ]),
    },
  ];
}

export default function GuidesPage() {
  const { locale, pages, guides } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");

  return (
    <div className="lp-layout px-4 py-8 lg:px-6 lg:py-12">
      <header className="lp-page-enter max-w-(--lp-measure-read)">
        <h1 className="text-3xl leading-tight lg:text-4xl">{t("guides.title")}</h1>
        <p className="mt-3 text-lg leading-snug text-muted-foreground">{t("guides.description")}</p>
      </header>

      <ul className="mt-10 max-w-(--lp-measure-read) border-t">
        {guides.map((g) => (
          <li key={g.slug} className="border-b">
            <Link
              to={`/${locale}/guides/${g.slug}`}
              className="group flex flex-col gap-1 px-1 py-5 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <span className="font-serif text-xl leading-snug font-semibold group-hover:text-primary">{g.title}</span>
              {g.description && <span className="text-sm text-muted-foreground">{g.description}</span>}
              {g.readingTime !== null && (
                <span className="text-xs text-faint">
                  {t("guides.readingTime", { count: g.readingTime })}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
