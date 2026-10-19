/**
 * landing.tsx
 * The public front door at `/`: what AnyTools is, what it will not do, and the
 * way in. Indexable, like the public tool pages; everything behind sign-in
 * says `noindex`.
 *
 * AnyTools phase 4 merged the old site's front door into it: the tool
 * clusters, in the visitor's language (the same pick as the Tools tab), and
 * the public pages' links. Since 2026-10-19 the page itself is in that
 * language too (`pages.json` → `landing`), chosen by `?lng=` from the site
 * header's language menu or else by the browser; the app behind it is English,
 * and the page says so beside the way in.
 *
 * A signed-in visitor never sees it: the loader sends them to `/home`, so a
 * bookmark of the old address still lands in the app.
 *
 * Same world as the rest of the product (DESIGN.md): a calm book page, one
 * green ink, hairline rows — not a marketing hero. The claims are the ones the
 * product can prove, stated with their limits.
 */
import { Link, redirect, useLoaderData } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { Route } from "./+types/landing";
import { getUserId } from "~/lib/auth.server";
import { APP_URL } from "~/lib/env.server";
import { isPublicLng, publicLngs, type PublicLng } from "~/lib/i18n";
import { Button } from "~/components/ui/button";
import { Plate } from "~/components/ui/plate";
import { AnyProfileFeature } from "~/components/tools-site/anyprofile-feature";
import { SiteFooter } from "~/components/tools-site/public-shell";
import { homeHref, SiteHeader } from "~/components/layout/site-header";
import { PARTS } from "~/lib/parts";
import { catalogEntries, CLUSTER_ORDER } from "~/lib/tools/catalog";
import { addPagesBundle, toolsI18n } from "~/lib/tools/i18n";
import { pagesMessages, toolsMessages } from "~/lib/tools/messages.server";
import { pagesT } from "~/lib/tools/route.server";
import { pickPublicLocale } from "./tools";
import { ogImage } from "~/lib/tools/seo";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) throw redirect("/home");
  const asked = new URL(request.url).searchParams.get("lng") ?? "";
  const locale: PublicLng = isPublicLng(asked) ? asked : pickPublicLocale(request.headers.get("Accept-Language"));
  const clusters = CLUSTER_ORDER.map((id) => ({ id, count: catalogEntries(locale, id).length })).filter((c) => c.count > 0);
  const t = pagesT(locale);
  return {
    appUrl: APP_URL,
    toolsLocale: locale,
    clusters,
    messages: toolsMessages(locale),
    pages: pagesMessages(locale),
    seo: { title: t("landing.metaTitle"), description: t("landing.metaDescription") },
  };
}

/** Without `?lng=` the language follows the browser's, so a cache must key on it. */
export function headers() {
  return { Vary: "Accept-Language" };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const url = data.appUrl;
  const { title, description } = data.seo;
  const self = `${url}${homeHref(data.toolsLocale)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AnyLearn",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description,
    url: self,
    inLanguage: data.toolsLocale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: self },
    ...publicLngs.map((l) => ({ tagName: "link", rel: "alternate", hrefLang: l, href: `${url}${homeHref(l)}` })),
    { tagName: "link", rel: "alternate", hrefLang: "x-default", href: `${url}/` },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: self },
    { property: "og:locale", content: data.toolsLocale },
    { property: "og:image", content: ogImage(url) },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { "script:ld+json": jsonLd },
  ];
}

export default function Landing() {
  const { toolsLocale: lng, messages, pages } = useLoaderData<typeof loader>();
  addPagesBundle(lng, pages);
  return (
    <I18nextProvider i18n={toolsI18n(lng, messages)}>
      <LandingPage />
    </I18nextProvider>
  );
}

function LandingPage() {
  const { toolsLocale: lng, clusters } = useLoaderData<typeof loader>();
  const { t } = useTranslation("pages");
  const { t: tTools } = useTranslation("tools");

  // Literal keys, so the i18n guard can see every one of them.
  const points = [
    { title: t("landing.points.cite.title"), body: t("landing.points.cite.body"), part: "ask" },
    { title: t("landing.points.practice.title"), body: t("landing.points.practice.body"), part: "practise" },
    { title: t("landing.points.evidence.title"), body: t("landing.points.evidence.body"), part: "reflect" },
    { title: t("landing.points.byok.title"), body: t("landing.points.byok.body"), part: "home" },
  ];
  const parts = {
    read: { title: t("landing.parts.read.title"), body: t("landing.parts.read.body") },
    ask: { title: t("landing.parts.ask.title"), body: t("landing.parts.ask.body") },
    practise: { title: t("landing.parts.practise.title"), body: t("landing.parts.practise.body") },
    reflect: { title: t("landing.parts.reflect.title"), body: t("landing.parts.reflect.body") },
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader locale={lng} languageHref={homeHref} search />

      <main id="main" className="flex-1">
        {/* First viewport: the offer, the one action, and the book on the desk. */}
        <section className="lp-layout grid gap-10 px-4 pt-10 pb-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12 lg:px-6 lg:pt-16 lg:pb-20">
          <div className="lp-page-enter">
            <h1 className="max-w-[16ch] text-4xl leading-tight sm:text-5xl lg:text-6xl">{t("landing.title")}</h1>
            <p className="mt-4 max-w-[30ch] font-serif text-2xl leading-snug text-muted-foreground italic">{t("landing.subtitle")}</p>
            <p className="mt-6 max-w-[52ch] text-lg leading-snug">{t("landing.lede")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button asChild size="lg">
                <Link to="/login">{t("landing.cta")}</Link>
              </Button>
              <p className="max-w-[34ch] text-sm leading-snug text-muted-foreground">{t("landing.ctaNote")}</p>
            </div>
          </div>
          <Plate name="hero-study" priority sizes="(min-width: 1024px) 52vw, 100vw" className="-mx-2 w-[calc(100%+1rem)] max-w-none lg:mx-0 lg:w-full" />
        </section>

        {/* The book's contents: four parts, each with its plate. */}
        <section aria-labelledby="lp-landing-contents" className="border-t">
          <div className="lp-layout px-4 py-14 lg:px-6 lg:py-16">
            <h2 id="lp-landing-contents" className="lp-section text-3xl">
              {t("landing.contentsTitle")}
            </h2>
            <ol className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:gap-x-8 sm:gap-y-10 lg:grid-cols-4">
              {PARTS.map((part) => (
                <li key={part.id} data-part={part.id}>
                  <Plate name={`part-${part.id}`} sizes="(min-width: 1024px) 22vw, 45vw" />
                  <div className="mt-3 flex items-baseline gap-2 sm:gap-3">
                    <span aria-hidden="true" className="lp-numeral text-2xl sm:text-3xl">
                      {part.numeral}
                    </span>
                    <h3 className="font-serif text-lg font-semibold text-part sm:text-xl">
                      <span className="sr-only">{t("landing.part", { numeral: part.numeral })}: </span>
                      {parts[part.id].title}
                    </h3>
                  </div>
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">{parts[part.id].body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div className="border-t bg-muted">
          <div className="lp-layout px-4 py-16 lg:px-6">
            <section aria-labelledby="lp-landing-what">
              <h2 id="lp-landing-what" className="lp-section text-3xl">
                {t("landing.whatTitle")}
              </h2>
              <p className="mt-4 max-w-(--lp-measure-read) font-serif text-lg leading-prose">{t("landing.lead")}</p>
              <ul className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
                {points.map((p) => (
                  <li key={p.part} data-part={p.part}>
                    <h3 className="font-serif text-xl font-semibold text-part">{p.title}</h3>
                    <p className="mt-2 text-sm leading-prose text-muted-foreground">{p.body}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="lp-landing-not" className="mt-14 max-w-(--lp-measure-read) rounded-lg border border-dashed border-control-border bg-background px-6 py-5">
              <h2 id="lp-landing-not" className="lp-section">
                {t("landing.notTitle")}
              </h2>
              <p className="mt-2 font-serif text-base leading-prose text-muted-foreground italic">{t("landing.notBody")}</p>
            </section>
          </div>
        </div>

        <section data-part="tools" aria-labelledby="lp-landing-tools" className="lp-layout px-4 py-16 lg:px-6">
          <h2 id="lp-landing-tools" className="lp-section text-3xl">
            {t("landing.tools.title")}
          </h2>
          <p className="mt-3 max-w-(--lp-measure-read) text-base leading-prose text-muted-foreground">{t("landing.tools.body")}</p>
          <div className="mt-8">
            <AnyProfileFeature locale={lng} compact />
          </div>
          <ul className="mt-8 grid grid-cols-1 gap-x-10 border-t sm:grid-cols-2 lg:grid-cols-3">
            {clusters.map((c) => (
              <li key={c.id} className="border-b">
                <Link
                  to={`/${lng}/${c.id}`}
                  className="group flex min-h-12 items-baseline px-1 py-3 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <span className="font-serif font-semibold group-hover:text-primary">{tTools(`catalog.cluster.${c.id}`)}</span>
                  <span aria-hidden="true" className="lp-leader" />
                  <span className="text-sm text-muted-foreground">{t("landing.tools.count", { count: c.count })}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5">
            <Link to={`/${lng}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
              {t("landing.tools.all")}
            </Link>
          </p>
        </section>

        {/* A sibling product from the same maker, after the site's own offer. It
            leaves the site, so the address is printed beside the button. */}
        <section aria-labelledby="lp-landing-postclaw" className="border-t bg-muted">
          <div className="lp-layout grid gap-8 px-4 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center lg:gap-12 lg:px-6">
            <div>
              <h2 id="lp-landing-postclaw" className="lp-section text-3xl">
                {t("landing.postclaw.title")}
              </h2>
              <p className="mt-3 max-w-[34ch] font-serif text-xl leading-snug text-muted-foreground italic">{t("landing.postclaw.tagline")}</p>
              <p className="mt-4 max-w-(--lp-measure-read) text-base leading-prose">{t("landing.postclaw.body")}</p>
              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button asChild size="lg" variant="outline">
                  <a href="https://postclaw.fun" rel="noopener">
                    {t("landing.postclaw.cta")}
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                  </a>
                </Button>
                <span translate="no" className="text-sm text-muted-foreground">
                  postclaw.fun
                </span>
              </div>
            </div>
            <Plate name="postclaw" sizes="(min-width: 1024px) 52vw, 100vw" />
          </div>
        </section>
      </main>

      <SiteFooter locale={lng} note={t("landing.footer")} />
    </div>
  );
}
