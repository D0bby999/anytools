/**
 * landing.tsx
 * The public front door at `/`: what AnyTools is, what it will not do, and the
 * way in. Indexable, like the public tool pages; everything behind sign-in
 * says `noindex`.
 *
 * AnyTools phase 4 merged the old site's front door into it: the tool
 * clusters, in the visitor's language (the same pick as the Tools tab), and
 * the public pages' links. The page itself stays English, like the app.
 *
 * A signed-in visitor never sees it: the loader sends them to `/home`, so a
 * bookmark of the old address still lands in the app.
 *
 * Same world as the rest of the product (DESIGN.md): a calm book page, one
 * green ink, hairline rows — not a marketing hero. The claims are the ones the
 * product can prove, stated with their limits.
 */
import { Link, redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/landing";
import { getUserId } from "~/lib/auth.server";
import { APP_URL } from "~/lib/env.server";
import { Button } from "~/components/ui/button";
import { AnyProfileFeature } from "~/components/tools-site/anyprofile-feature";
import { PARTS } from "~/lib/parts";
import { SOURCE_URL } from "~/components/tools-site/public-shell";
import { catalogEntries, CLUSTER_ORDER } from "~/lib/tools/catalog";
import { pickPublicLocale } from "./tools";
import { ogImage } from "~/lib/tools/seo";

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUserId(request)) throw redirect("/home");
  const locale = pickPublicLocale(request.headers.get("Accept-Language"));
  const clusters = CLUSTER_ORDER.map((id) => ({ id, count: catalogEntries(locale, id).length })).filter((c) => c.count > 0);
  return { appUrl: APP_URL, toolsLocale: locale, clusters };
}

/** The tool links follow the browser's language, so a cache must key on it. */
export function headers() {
  return { Vary: "Accept-Language" };
}

const TITLE = "AnyTools — free tools, and a study app that runs on your own AI";
const DESCRIPTION =
  "AnyTools is free: everyday tools that run in your browser without an account, and a self-study app that grounds chat, quizzes, a spaced-repetition mastery path and a 90-day learning loop in the documents you upload, using the AI accounts you already have. Every answer cites the page it came from.";

export function meta({ data }: Route.MetaArgs) {
  const url = data?.appUrl ?? "";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AnyTools",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description: DESCRIPTION,
    url: `${url}/`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return [
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { tagName: "link", rel: "canonical", href: `${url}/` },
    { property: "og:type", content: "website" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: `${url}/` },
    { property: "og:image", content: ogImage(url) },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
    { "script:ld+json": jsonLd },
  ];
}

export default function Landing({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { t: tTools } = useTranslation("tools");
  const { toolsLocale: lng, clusters } = loaderData;
  const links = [
    { to: `/${lng}/guides`, label: t("landing.links.guides") },
    { to: `/${lng}/anyprofile`, label: t("landing.links.anyprofile") },
    { to: `/${lng}/about`, label: t("landing.links.about") },
    { to: `/${lng}/privacy`, label: t("landing.links.privacy") },
    { to: `/${lng}/terms`, label: t("landing.links.terms") },
    { to: `/${lng}/contact`, label: t("landing.links.contact") },
  ];

  // Literal keys, so the i18n guard can see every one of them.
  const points = [
    { title: t("landing.points.cite.title"), body: t("landing.points.cite.body"), part: "ask" },
    { title: t("landing.points.practice.title"), body: t("landing.points.practice.body"), part: "practise" },
    { title: t("landing.points.evidence.title"), body: t("landing.points.evidence.body"), part: "reflect" },
    { title: t("landing.points.byok.title"), body: t("landing.points.byok.body"), part: "home" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="lp-layout flex items-center gap-2 px-4 py-3 lg:px-6">
          <p translate="no" className="mr-auto font-serif text-2xl font-semibold tracking-display">
            {t("app.name")}
          </p>
          <nav aria-label={t("landing.nav.label")} className="hidden items-center gap-1 sm:flex">
            <Link to={`/${lng}`} className={NAV}>
              {t("landing.nav.tools")}
            </Link>
            <Link to={`/${lng}/guides`} className={NAV}>
              {t("landing.nav.guides")}
            </Link>
            <Link to={`/${lng}/anyprofile`} className={NAV}>
              {t("landing.links.anyprofile")}
            </Link>
          </nav>
          <Button asChild variant="outline" size="sm">
            <Link to="/login">{t("landing.nav.signIn")}</Link>
          </Button>
        </div>
      </header>

      <main>
        {/* First viewport: the offer, the one action, and the book's contents,
            which is the shape only this product has. */}
        <section className="lp-layout grid gap-12 px-4 pt-12 pb-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:px-6 lg:pt-20 lg:pb-24">
          <div className="lp-page-enter">
            <h1 className="max-w-[16ch] text-4xl leading-tight sm:text-5xl lg:text-6xl">{t("landing.title")}</h1>
            <p className="mt-4 max-w-[30ch] font-serif text-2xl leading-snug text-muted-foreground italic">
              {t("landing.subtitle")}
            </p>
            <p className="mt-6 max-w-[52ch] text-lg leading-snug">{t("landing.lede")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3">
              <Button asChild size="lg">
                <Link to="/login">{t("landing.cta")}</Link>
              </Button>
              <p className="text-sm text-muted-foreground">{t("landing.ctaNote")}</p>
            </div>
          </div>

          <section aria-labelledby="lp-landing-contents" className="rounded-xl border bg-card p-6 shadow-md sm:p-8">
            <h2 id="lp-landing-contents" className="lp-section text-xl">
              {t("landing.contentsTitle")}
            </h2>
            <ol className="mt-4">
              {PARTS.map((part) => (
                <li key={part.id} data-part={part.id} className="grid grid-cols-[3rem_1fr] gap-x-4 border-t py-4 first:border-t-0 first:pt-2">
                  <span aria-hidden="true" className="lp-numeral text-4xl">
                    {part.numeral}
                  </span>
                  <div>
                    <h3 className="font-serif text-lg font-semibold text-part">
                      <span className="sr-only">{t("parts.part", { numeral: part.numeral })}: </span>
                      {t(part.labelKey)}
                    </h3>
                    <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{t(part.bodyKey)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
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
                  <li key={p.title} data-part={p.part}>
                    <h3 className="font-serif text-xl font-semibold text-part">{p.title}</h3>
                    <p className="mt-2 text-sm leading-prose text-muted-foreground">{p.body}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="lp-landing-not" className="mt-14 max-w-(--lp-measure-read) rounded-lg border border-dashed border-control-border px-6 py-5">
              <h2 id="lp-landing-not" className="lp-section">
                {t("landing.notTitle")}
              </h2>
              <p className="mt-2 font-serif text-base leading-prose italic text-muted-foreground">{t("landing.notBody")}</p>
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
      </main>

      <footer className="border-t">
        <div className="lp-layout px-4 py-8 text-xs text-muted-foreground lg:px-6">
          <p className="max-w-(--lp-measure-read)">{t("landing.footer")}</p>
          <nav aria-label={t("landing.links.label")} className="mt-3">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={SOURCE_URL} rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                  {t("landing.links.source")}
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const NAV =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground";
