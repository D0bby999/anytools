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
import { SOURCE_URL } from "~/components/tools-site/public-shell";
import { catalogEntries, CLUSTER_ORDER } from "~/lib/tools/catalog";
import { pickPublicLocale } from "./tools";

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
    { property: "og:image", content: `${url}/og.png` },
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
    { title: t("landing.points.cite.title"), body: t("landing.points.cite.body") },
    { title: t("landing.points.byok.title"), body: t("landing.points.byok.body") },
    { title: t("landing.points.practice.title"), body: t("landing.points.practice.body") },
    { title: t("landing.points.evidence.title"), body: t("landing.points.evidence.body") },
  ];

  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:py-20">
      <div className="mx-auto max-w-(--lp-measure-read)">
        <p translate="no" className="font-serif text-xl font-semibold">
          {t("app.name")}
        </p>

        <div className="lp-prose mt-10">
          <h1>{t("landing.title")}</h1>
          <p>{t("landing.lead")}</p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link to="/login">{t("landing.cta")}</Link>
          </Button>
          <p className="text-sm text-muted-foreground">{t("landing.ctaNote")}</p>
        </div>

        <section aria-labelledby="lp-landing-tools" className="mt-14">
          <h2 id="lp-landing-tools" className="lp-kicker">
            {t("landing.tools.title")}
          </h2>
          <p className="mt-4 text-sm leading-prose text-muted-foreground">{t("landing.tools.body")}</p>
          <ul className="mt-4 grid grid-cols-1 gap-x-8 border-t sm:grid-cols-2">
            {clusters.map((c) => (
              <li key={c.id} className="border-b">
                <Link
                  to={`/${lng}/${c.id}`}
                  className="flex items-baseline justify-between gap-3 px-1 py-3 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                >
                  <span className="font-medium">{tTools(`catalog.cluster.${c.id}`)}</span>
                  <span className="font-mono text-2xs uppercase tracking-label text-faint">
                    {t("landing.tools.count", { count: c.count })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link to={`/${lng}`} className="text-primary underline underline-offset-4">
              {t("landing.tools.all")}
            </Link>
          </p>
        </section>

        <section aria-labelledby="lp-landing-what" className="mt-12">
          <h2 id="lp-landing-what" className="lp-kicker">
            {t("landing.whatTitle")}
          </h2>
          <ul className="mt-4 border-t">
            {points.map((p) => (
              <li key={p.title} className="border-b py-4">
                <h3 className="font-sans text-base font-medium">{p.title}</h3>
                <p className="mt-1 text-sm leading-prose text-muted-foreground">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="lp-landing-not" className="mt-12">
          <h2 id="lp-landing-not" className="lp-kicker">
            {t("landing.notTitle")}
          </h2>
          <p className="mt-4 text-sm leading-prose text-muted-foreground">{t("landing.notBody")}</p>
        </section>

        <footer className="mt-16 border-t pt-6 text-xs text-muted-foreground">
          <p>{t("landing.footer")}</p>
          <nav aria-label={t("landing.links.label")} className="mt-3">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="underline-offset-4 hover:text-foreground hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={SOURCE_URL} rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
                  {t("landing.links.source")}
                </a>
              </li>
            </ul>
          </nav>
        </footer>
      </div>
    </main>
  );
}
