/**
 * public.anyprofile.tsx
 * `/{locale}/anyprofile`: the download page of AnyProfile, the author's
 * open-source desktop app, ported from the old site with the same copy and
 * no ads. The buttons point at the build named in the release's latest.json
 * when it can be read, with its version and checksums, and at GitHub's
 * "latest" redirect when it cannot (lib/tools/anyprofile.server.ts).
 */
import { Download, Github, Laptop, Monitor } from "lucide-react";
import { useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.anyprofile";
import { Button } from "~/components/ui/button";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { ANYPROFILE_RELEASES, ANYPROFILE_REPO, downloadsFor, latestRelease } from "~/lib/tools/anyprofile.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { pagesT, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, clampMetaDescription, pageMeta } from "~/lib/tools/seo";

export async function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const t = pagesT(locale);
  return {
    locale,
    origin: APP_URL,
    pages: pagesMessages(locale),
    downloads: downloadsFor(await latestRelease()),
    // From the loader, because the component may not import a .server module.
    releasesUrl: ANYPROFILE_RELEASES,
    repoUrl: ANYPROFILE_REPO,
    seo: { title: t("anyprofile.metaTitle"), description: clampMetaDescription(t("anyprofile.metaDescription")) },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo } = data;
  const path = (l: string) => `/${l}/anyprofile`;
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
  ];
}

type Feature = { title: string; body: string };
type InstallBlock = { os: string; steps: string[] };

/** A `returnObjects` list from the bundle, or nothing if the key is not one. */
function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function AnyProfilePage() {
  const { locale, pages, downloads, releasesUrl, repoUrl } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");
  const { release, links } = downloads;

  const buttons = [
    { platform: "mac", href: links.mac.url, label: t("anyprofile.downloadMac"), note: t("anyprofile.downloadMacNote"), Icon: Laptop },
    { platform: "windows", href: links.windows.url, label: t("anyprofile.downloadWindows"), note: t("anyprofile.downloadWindowsNote"), Icon: Monitor },
  ] as const;
  const checksums = buttons.flatMap((b) => {
    const sha = links[b.platform].sha256;
    return sha ? [{ label: b.label, sha }] : [];
  });

  return (
    <div>
      {/* The cover: AnyProfile leads the tools appendix, so its own page opens
          the way its feature card does, in ink. */}
      <header className="bg-foreground text-background">
        <div className="lp-layout grid gap-10 px-4 py-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-6 lg:py-16">
          <div className="lp-page-enter min-w-0">
            <div className="flex items-center gap-4">
              <img src="/apps/anyprofile-icon.png" alt="" width={72} height={72} className="size-16 rounded-xl sm:size-18" />
              <p className="text-xs font-semibold tracking-label uppercase opacity-80">{t("anyprofile.badge")}</p>
            </div>
            <h1 className="mt-6 font-serif text-5xl leading-tight tracking-display sm:text-6xl">{t("anyprofile.title")}</h1>
            <p className="mt-3 font-serif text-2xl leading-snug italic opacity-95">{t("anyprofile.tagline")}</p>
            <p className="mt-6 max-w-[62ch] leading-prose opacity-90">{t("anyprofile.intro")}</p>
          </div>

          <div className="flex min-w-0 flex-col gap-3 lg:justify-end">
            {buttons.map(({ platform, href, label, note, Icon }) => (
              <a
                key={platform}
                href={href}
                rel="noopener"
                className="flex items-center gap-4 rounded-lg border border-background bg-background px-5 py-4 text-foreground transition-colors hover:bg-transparent hover:text-background focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground focus-visible:outline-none"
              >
                <Icon className="size-6 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="inline-flex items-center gap-1.5 text-base font-semibold">
                    <Download className="size-4" aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-sm opacity-80">{note}</span>
                </span>
              </a>
            ))}
            <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {release && (
                <span className="opacity-80">
                  {release.date ? t("anyprofile.latest", { version: release.version, date: release.date }) : release.version}
                </span>
              )}
              <a
                href={releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80"
              >
                {t("anyprofile.allReleases")}
              </a>
              <a href="#ap-install" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80">
                {t("anyprofile.howToInstall")}
              </a>
            </p>
          </div>
        </div>
      </header>

      <div className="lp-layout px-4 py-12 lg:px-6">
        <section aria-labelledby="ap-features">
          <h2 id="ap-features" className="lp-section text-2xl">
            {t("anyprofile.featuresTitle")}
          </h2>
          <ul className="mt-5 grid gap-x-10 border-t md:grid-cols-2">
            {list<Feature>(t("anyprofile.features", { returnObjects: true })).map((f) => (
              <li key={f.title} className="border-b py-5">
                <h3 className="font-serif text-lg font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-prose text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ap-install" className="mt-14">
          <h2 id="ap-install" className="lp-section text-2xl">
            {t("anyprofile.installTitle")}
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {list<InstallBlock>(t("anyprofile.install", { returnObjects: true })).map((block) => (
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
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            <div>
              <h3 className="font-serif text-lg font-semibold">{t("anyprofile.requirementsTitle")}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-prose text-muted-foreground">
                {list<string>(t("anyprofile.requirements", { returnObjects: true })).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            {checksums.length > 0 && (
              <section aria-labelledby="ap-checksums">
                <h3 id="ap-checksums" className="font-serif text-lg font-semibold">
                  {t("anyprofile.checksums")}
                </h3>
                <dl className="mt-2 border-t text-sm">
                  {checksums.map((c) => (
                    <div key={c.label} className="border-b py-2">
                      <dt className="text-muted-foreground">{c.label}</dt>
                      <dd className="font-mono text-xs break-all">{c.sha}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>
        </section>

        <div className="mt-14 grid gap-10 md:grid-cols-2">
          <section aria-labelledby="ap-privacy">
            <h2 id="ap-privacy" className="lp-section text-2xl">
              {t("anyprofile.privacyTitle")}
            </h2>
            {list<string>(t("anyprofile.privacy", { returnObjects: true })).map((para) => (
              <p key={para} className="mt-3 text-sm leading-prose text-muted-foreground">
                {para}
              </p>
            ))}
          </section>
          <section aria-labelledby="ap-source">
            <h2 id="ap-source" className="lp-section text-2xl">
              {t("anyprofile.openSourceTitle")}
            </h2>
            <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("anyprofile.openSource")}</p>
            <Button asChild variant="outline" className="mt-4">
              <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                <Github className="size-4" aria-hidden="true" />
                {t("anyprofile.sourceLink")}
              </a>
            </Button>
          </section>
        </div>

        <p className="mt-14 max-w-(--lp-measure-read) border-t pt-6 text-xs leading-prose text-muted-foreground">
          {t("anyprofile.responsibility")}
        </p>
      </div>
    </div>
  );
}
