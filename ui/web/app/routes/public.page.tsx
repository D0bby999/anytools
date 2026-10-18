/**
 * public.page.tsx
 * `/{locale}/about`, `/privacy`, `/terms` and `/contact`: one module,
 * registered once per page (routes.ts gives each its own id). The text is
 * Markdown in content/<locale>/pages/, written for the merged site: one
 * privacy policy and one set of terms for the tools and the study app.
 */
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.page";
import { Article } from "~/components/tools-site/article";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { isStaticPage, loadPage } from "~/lib/tools/pages.server";
import { notFound, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, clampMetaDescription, MAX_TITLE_CHARS, pageMeta } from "~/lib/tools/seo";

export function loader({ request, params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  // The route has no param of its own: the page is the path's second segment.
  const page = new URL(request.url).pathname.split("/")[2] ?? "";
  if (!isStaticPage(page)) notFound();
  const doc = loadPage(locale, page);
  if (!doc) notFound();
  return { locale, origin: APP_URL, page, pages: pagesMessages(locale), ...doc };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, page } = data;
  const path = (l: string) => `/${l}/${page}`;
  const full = `${data.title} — AnyTools`;
  return [
    ...pageMeta({
      title: full.length <= MAX_TITLE_CHARS ? full : data.title,
      description: clampMetaDescription(data.description),
      url: `${origin}${path(locale)}`,
      image: `${origin}/og.png`,
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
  ];
}

export default function StaticPage() {
  const { locale, pages, title, updated, source } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");

  return (
    <article className="lp-measure px-4 py-8 lg:py-12">
      <header className="lp-page-enter">
        <h1 className="text-3xl leading-tight lg:text-4xl">{title}</h1>
        {updated && <p className="mt-3 text-sm text-faint">{t("legal.updated", { date: updated })}</p>}
      </header>
      <div className="mt-6">
        <Article source={source} standalone />
      </div>
    </article>
  );
}
