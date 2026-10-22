/**
 * u.$handle.tsx
 * /u/<handle>: a learner's public profile (the private design notes),
 * for anyone, signed in or not, in the visitor's language. Outside the app's
 * layouts: there is no session to ask for. A handle with no page and a page
 * not published are the same 404, said on this page in the visitor's
 * language rather than by the root's error page.
 *
 * Search engines may list a page whose learner lets them (`indexed`, ticked
 * for a new page): it is in the sitemap, with a canonical address per
 * language and a schema.org ProfilePage. Otherwise it says `noindex`, and the
 * learner sends its link to whom they choose.
 */
import { data, Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/u.$handle";
import { SiteHeader } from "~/components/layout/site-header";
import { ShowcaseView } from "~/components/showcase/showcase-view";
import { APP_URL } from "~/lib/env.server";
import { initI18n, loadLanguage, publicLngs } from "~/lib/i18n";
import { clientIP, createIPLimiter } from "~/lib/ip-limit.server";
import { visitorLanguage } from "~/lib/language.server";
import { readShowcase } from "~/lib/showcase/api.server";
import { HANDLE_PATTERN, showcaseLangPath, showcasePath, type ShowcasePage } from "~/lib/showcase/design";

/** Views per address: a page counts at most every ten minutes, but each view still reads. */
const views = createIPLimiter(60, 30);

const HANDLE = new RegExp(`^${HANDLE_PATTERN}$`);

export async function loader({ request, params }: Route.LoaderArgs) {
  const handle = (params.handle ?? "").toLowerCase();
  const language = await visitorLanguage(request);
  await loadLanguage(language);
  const indexed = (page: ShowcasePage | null) => Boolean(page?.profile.published && page.profile.indexed);
  const answer = (page: ShowcasePage | null, status: number, headers: Record<string, string> = {}) =>
    data(
      {
        language,
        handle,
        page,
        origin: APP_URL,
        status,
        indexed: indexed(page),
        // The search result's line when the learner wrote no headline.
        description: page ? page.profile.headline || initI18n(language).getFixedT(language, "showcase")("seo.description", { name: page.profile.name }) : "",
      },
      { status, headers: { ...(indexed(page) ? {} : { "X-Robots-Tag": "noindex" }), ...headers } },
    );
  if (!HANDLE.test(handle)) return answer(null, 404, { "Cache-Control": "no-store" });
  if (!views(clientIP(request))) return answer(null, 429, { "Retry-After": "60", "Cache-Control": "no-store" });
  const page = await readShowcase(handle);
  // Nothing found is not kept, so a page published a moment later shows.
  if (!page) return answer(null, 404, { "Cache-Control": "no-store" });
  // The visitor's language picks the words, so no shared cache keeps one
  // visitor's page for another; a short private one spares a reload.
  return answer(page, 200, { "Cache-Control": "private, max-age=60" });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ data: d }: Route.MetaArgs) {
  const page = d?.page;
  if (!page) return [{ title: "AnyLearn" }, { name: "robots", content: "noindex" }];
  const p = page.profile;
  const url = `${d.origin}${showcasePath(p.handle)}`;
  const title = `${p.name} (@${p.handle}) · AnyLearn`;
  const links = p.design.blocks.flatMap((b) => (b.type === "links" ? (b.links ?? []).map((l) => l.url) : []));
  // A page in search: its own address in this language, each language's,
  // the bare address as the default, and who the page is about.
  const search = d.indexed
    ? [
        { tagName: "link", rel: "canonical", href: `${d.origin}${showcaseLangPath(p.handle, d.language)}` },
        ...publicLngs.map((l) => ({ tagName: "link", rel: "alternate", hrefLang: l, href: `${d.origin}${showcaseLangPath(p.handle, l)}` })),
        { tagName: "link", rel: "alternate", hrefLang: "x-default", href: url },
        {
          "script:ld+json": {
            "@context": "https://schema.org",
            "@type": "ProfilePage",
            url,
            inLanguage: d.language,
            dateModified: p.updated_at,
            mainEntity: {
              "@type": "Person",
              name: p.name,
              alternateName: `@${p.handle}`,
              ...(p.headline ? { description: p.headline } : {}),
              url,
              ...(links.length ? { sameAs: links } : {}),
            },
          },
        },
      ]
    : [{ name: "robots", content: "noindex" }];
  return [
    { title },
    ...search,
    { name: "description", content: d.description },
    { property: "og:type", content: "profile" },
    { property: "og:title", content: title },
    { property: "og:description", content: d.description },
    { property: "og:url", content: url },
    // The card's words are in the page's language, named in its address so a cache keeps each apart.
    { property: "og:image", content: `${url}/og.png?lang=${d.language}&v=${encodeURIComponent(page.stats.as_of ?? p.updated_at)}` },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}

export default function ShowcasePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("showcase");
  const { language, handle, page, status } = loaderData;
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader locale={language} languageHref={(l) => `${showcasePath(handle)}?lang=${l}`} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 lg:px-8">
        {page ? (
          <ShowcaseView profile={page.profile} stats={page.stats} />
        ) : (
          <>
            <h1 className="font-serif text-3xl font-semibold">{status === 429 ? t("missing.busyTitle") : t("missing.title")}</h1>
            <p className="mt-3 max-w-[64ch]">{status === 429 ? t("missing.busy") : t("missing.lede")}</p>
          </>
        )}
      </main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-4xl px-4 py-6 text-sm text-muted-foreground lg:px-8">
          {t("footer.made")}{" "}
          <Link to={`/${language}/anylearn`} className="text-primary underline underline-offset-4">
            {t("footer.start")}
          </Link>
        </p>
      </footer>
    </div>
  );
}
