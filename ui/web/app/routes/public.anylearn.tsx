/**
 * public.anylearn.tsx
 * `/{locale}/anylearn`: AnyLearn's page on the AnyTools site, beside
 * AnyProfile's. What the study app does, how to install it on a phone or a
 * computer, and the way in. Its words are in lib/tools/anylearn-page.ts.
 */
import { ArrowRight, Download } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/public.anylearn";
import { Button } from "~/components/ui/button";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { anyLearnCopy } from "~/lib/tools/anylearn-page";
import { publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, clampMetaDescription, pageMeta, ogImage } from "~/lib/tools/seo";

export async function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const copy = anyLearnCopy(locale);
  return {
    locale,
    origin: APP_URL,
    copy,
    seo: { title: copy.metaTitle, description: clampMetaDescription(copy.metaDescription) },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo } = data;
  const path = (l: string) => `/${l}/anylearn`;
  return [
    ...pageMeta({
      title: seo.title,
      description: seo.description,
      url: `${origin}${path(locale)}`,
      image: ogImage(origin),
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
  ];
}

export default function AnyLearnPage() {
  const { locale, copy } = useLoaderData<typeof loader>();

  return (
    <div lang={locale}>
      {/* The cover, set like AnyProfile's: the two are AnyTools' two apps. */}
      <header className="bg-foreground text-background">
        <div className="lp-layout grid gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-6 lg:py-16">
          <div className="lp-page-enter min-w-0">
            <div className="flex items-center gap-4">
              <img src="/icons/anylearn-192.png" alt="" width={72} height={72} className="size-16 rounded-xl sm:size-18" />
              <p className="text-xs font-semibold tracking-label uppercase opacity-80">{copy.badge}</p>
            </div>
            <h1 translate="no" className="mt-6 font-serif text-5xl leading-tight tracking-display sm:text-6xl">
              AnyLearn
            </h1>
            <p className="mt-3 font-serif text-2xl leading-snug italic opacity-95">{copy.tagline}</p>
            <p className="mt-6 max-w-[62ch] leading-prose opacity-90">{copy.intro}</p>
            {copy.englishNote ? <p className="mt-4 max-w-[62ch] text-sm leading-prose opacity-80">{copy.englishNote}</p> : null}
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:justify-end">
            <Link
              to="/login"
              className="flex items-center justify-between gap-4 rounded-lg border border-background bg-background px-5 py-4 text-foreground transition-colors hover:bg-transparent hover:text-background focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-base font-semibold">{copy.cta}</span>
                <span className="text-sm opacity-80">{copy.ctaNote}</span>
              </span>
              <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
            </Link>
            <a href="#al-install" className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 hover:opacity-80">
              <Download className="size-4" aria-hidden="true" />
              {copy.howToInstall}
            </a>
          </div>
        </div>
      </header>

      <div className="lp-layout px-4 py-12 lg:px-6">
        <section aria-labelledby="al-features">
          <h2 id="al-features" className="lp-section text-2xl">
            {copy.featuresTitle}
          </h2>
          <ul className="mt-5 grid gap-x-10 border-t md:grid-cols-2">
            {copy.features.map((f) => (
              <li key={f.title} className="border-b py-5">
                <h3 className="font-serif text-lg font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-prose text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="al-install-title" id="al-install" className="mt-14 scroll-mt-20">
          <h2 className="lp-section text-2xl" id="al-install-title">
            {copy.installTitle}
          </h2>
          <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{copy.installLead}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {copy.install.map((block) => (
              <div key={block.os} className="lp-keybox p-5 sm:p-6">
                <h3 className="font-serif text-lg font-semibold">{block.os}</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-prose marker:font-semibold marker:text-part">
                  {block.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="al-not" className="mt-14 max-w-(--lp-measure-read) rounded-lg border border-dashed border-control-border px-6 py-5">
          <h2 id="al-not" className="lp-section">
            {copy.notTitle}
          </h2>
          <p className="mt-2 font-serif text-base leading-prose text-muted-foreground italic">{copy.not}</p>
        </section>

        <p className="mt-10">
          <Button asChild size="lg">
            <Link to="/login">{copy.cta}</Link>
          </Button>
        </p>
      </div>
    </div>
  );
}
