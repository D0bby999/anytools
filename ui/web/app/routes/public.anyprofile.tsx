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
    <div className="lp-measure px-4 py-8 lg:py-12">
      <header className="flex flex-col gap-4 border-b pb-10">
        <img src="/apps/anyprofile-icon.png" alt="" width={72} height={72} className="size-18" />
        <div className="lp-prose">
          <h1>{t("anyprofile.title")}</h1>
          <p className="text-lg">{t("anyprofile.tagline")}</p>
        </div>
        <p className="text-sm text-muted-foreground">{t("anyprofile.badge")}</p>
        <p className="leading-prose">{t("anyprofile.intro")}</p>

        <div className="flex flex-col gap-3 sm:flex-row">
          {buttons.map(({ platform, href, label, note, Icon }) => (
            <Button key={platform} asChild size="lg" className="h-auto justify-start py-3">
              <a href={href} rel="noopener">
                <Icon className="size-5" aria-hidden="true" />
                <span className="flex flex-col items-start text-left">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Download className="size-4" aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-xs font-normal">{note}</span>
                </span>
              </a>
            </Button>
          ))}
        </div>

        {release && (
          <p className="text-sm text-muted-foreground">
            {release.date ? t("anyprofile.latest", { version: release.version, date: release.date }) : release.version}
          </p>
        )}
        <a href={releasesUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline underline-offset-4">
          {t("anyprofile.allReleases")}
        </a>

        {checksums.length > 0 && (
          <section aria-labelledby="ap-checksums">
            <h2 id="ap-checksums" className="lp-kicker">
              {t("anyprofile.checksums")}
            </h2>
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
      </header>

      <section aria-labelledby="ap-features" className="mt-10">
        <h2 id="ap-features" className="lp-kicker">
          {t("anyprofile.featuresTitle")}
        </h2>
        <ul className="mt-4 border-t">
          {list<Feature>(t("anyprofile.features", { returnObjects: true })).map((f) => (
            <li key={f.title} className="border-b py-4">
              <h3 className="font-sans text-base font-medium">{f.title}</h3>
              <p className="mt-1 text-sm leading-prose text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="ap-install" className="mt-12">
        <h2 id="ap-install" className="lp-kicker">
          {t("anyprofile.installTitle")}
        </h2>
        <div className="mt-4 grid gap-8 md:grid-cols-2">
          {list<InstallBlock>(t("anyprofile.install", { returnObjects: true })).map((block) => (
            <div key={block.os}>
              <h3 className="font-sans text-base font-medium">{block.os}</h3>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-prose text-muted-foreground">
                {block.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <h3 className="mt-8 font-sans text-base font-medium">{t("anyprofile.requirementsTitle")}</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-prose text-muted-foreground">
          {list<string>(t("anyprofile.requirements", { returnObjects: true })).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <section aria-labelledby="ap-privacy">
          <h2 id="ap-privacy" className="lp-kicker">
            {t("anyprofile.privacyTitle")}
          </h2>
          {list<string>(t("anyprofile.privacy", { returnObjects: true })).map((para) => (
            <p key={para} className="mt-3 text-sm leading-prose text-muted-foreground">
              {para}
            </p>
          ))}
        </section>
        <section aria-labelledby="ap-source">
          <h2 id="ap-source" className="lp-kicker">
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

      <p className="mt-12 border-t pt-6 text-xs leading-prose text-muted-foreground">{t("anyprofile.responsibility")}</p>
    </div>
  );
}
