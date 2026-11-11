/**
 * public.anyprofile.tsx
 * `/{locale}/anyprofile`: the download page of AnyProfile, the author's
 * open-source desktop app, ported from the old site with the same copy and
 * no ads. The buttons point at the build named in the release's latest.json
 * when it can be read, with its version and checksums, and at GitHub's
 * "latest" redirect when it cannot (lib/tools/anyprofile.server.ts). With no
 * release published, a "coming soon" note takes the buttons' place.
 */
import { Clock, Download, Github, Laptop, Monitor } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/public.anyprofile";
import { Button } from "~/components/ui/button";
import { publicLngs } from "~/lib/i18n";
import { APP_URL } from "~/lib/env.server";
import { ANYPROFILE_RELEASES, ANYPROFILE_REPO, downloadsFor, latestRelease } from "~/lib/tools/anyprofile.server";
import { addPagesBundle } from "~/lib/tools/i18n";
import { pagesMessages } from "~/lib/tools/messages.server";
import { pagesT, publicLocale } from "~/lib/tools/route.server";
import { alternateLinks, breadcrumbSchema, clampMetaDescription, faqSchema, pageMeta } from "~/lib/tools/seo";

type FaqItem = { q: string; a: string };
type DemoChapter = { name: string; startOffset: number; endOffset: number; label: string };

const DEMO_CHAPTERS: Record<"en" | "vi", DemoChapter[]> = {
  en: [
    { name: "Local-first vs Cloud SaaS", startOffset: 0, endOffset: 11, label: "0:00" },
    { name: "Isolated Fingerprints & Live Checks", startOffset: 11, endOffset: 26, label: "0:11" },
    { name: "New Profile & Engine Selector", startOffset: 26, endOffset: 38, label: "0:26" },
    { name: "Arrange Windows Multi-Browser Tiling", startOffset: 38, endOffset: 49, label: "0:38" },
    { name: "Keychain Proxies & Provider Hub", startOffset: 49, endOffset: 62, label: "0:49" },
    { name: "Native Android 15 VM on Apple Silicon", startOffset: 62, endOffset: 75, label: "1:02" },
    { name: "Local REST API & AI Agent MCP", startOffset: 75, endOffset: 87, label: "1:15" },
  ],
  vi: [
    { name: "Chạy cục bộ thay vì trình duyệt đám mây", startOffset: 0, endOffset: 8, label: "0:00" },
    { name: "Tách biệt vân tay & kiểm tra IP", startOffset: 8, endOffset: 18, label: "0:08" },
    { name: "Tạo profile mới & chọn nhân trình duyệt", startOffset: 18, endOffset: 27, label: "0:18" },
    { name: "Arrange Windows xếp đa cửa sổ", startOffset: 27, endOffset: 36, label: "0:27" },
    { name: "Proxy mã hóa Keychain & nhà cung cấp", startOffset: 36, endOffset: 46, label: "0:36" },
    { name: "Máy ảo Android 15 trên Apple Silicon", startOffset: 46, endOffset: 57, label: "0:46" },
    { name: "Local API & AI Agent MCP", startOffset: 57, endOffset: 66, label: "0:57" },
  ],
};

function videoMedia(locale: string) {
  const isVi = locale === "vi";
  return {
    isVi,
    videoPath: isVi ? "/apps/anyprofile-demo-vi.mp4" : "/apps/anyprofile-demo-en.mp4",
    posterPath: isVi ? "/apps/anyprofile-demo-poster-vi.jpg" : "/apps/anyprofile-demo-poster.jpg",
    captionPath: isVi ? "/apps/anyprofile-demo-vi.vtt" : "/apps/anyprofile-demo-en.vtt",
    durationIso: isVi ? "PT1M14S" : "PT1M38S",
    chapters: isVi ? DEMO_CHAPTERS.vi : DEMO_CHAPTERS.en,
  };
}

export async function loader({ params }: Route.LoaderArgs) {
  const locale = publicLocale(params);
  const t = pagesT(locale);
  const faqs = list<FaqItem>(t("anyprofile.faqs", { returnObjects: true }));
  return {
    locale,
    origin: APP_URL,
    pages: pagesMessages(locale),
    downloads: downloadsFor(await latestRelease()),
    // From the loader, because the component may not import a .server module.
    releasesUrl: ANYPROFILE_RELEASES,
    repoUrl: ANYPROFILE_REPO,
    faqs,
    seo: { title: t("anyprofile.metaTitle"), description: clampMetaDescription(t("anyprofile.metaDescription")) },
  };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [];
  const { origin, locale, seo, downloads, faqs, repoUrl } = data;
  const path = (l: string) => `/${l}/anyprofile`;
  const url = `${origin}${path(locale)}`;
  const media = videoMedia(locale);
  const posterUrl = `${origin}${media.posterPath}`;
  const ogPosterUrl = `${posterUrl}?v=20261111`;

  const softwareLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "AnyProfile",
    applicationCategory: "BrowserApplication",
    operatingSystem: "macOS 13+ (Apple Silicon), Windows 10/11",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    isAccessibleForFree: true,
    inLanguage: locale,
    description: seo.description,
    url,
    sameAs: [repoUrl, `${origin}/${locale}/guides/anyprofile`],
    image: ogPosterUrl,
    screenshot: ogPosterUrl,
    softwareVersion: downloads?.release?.version ?? "0.2.2",
    downloadUrl: downloads?.links?.mac?.url ?? url,
    license: "https://github.com/D0bby999/anyprofile/blob/master/LICENSE",
    featureList: [
      "Isolated Chromium browser profiles with persistent per-profile fingerprints",
      "Per-profile HTTP/HTTPS/SOCKS5 proxy relay with automatic timezone & geolocation",
      "macOS Keychain / Windows Credential Manager encrypted secrets vault",
      "Native Apple Silicon Android 15 VM with Hypervisor.framework KVM & Fast Start",
      "Local REST API and MCP server for Claude Code, Codex, and Playwright",
    ],
    author: {
      "@type": "Person",
      name: "Nguyen Minh Chau",
      url: "https://github.com/D0bby999",
    },
    publisher: {
      "@type": "Organization",
      name: "AnyProfile",
      url,
    },
  };

  const videoLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: media.isVi
      ? "AnyProfile — Trình duyệt Antidetect miễn phí & Máy ảo Android 15 (Demo)"
      : "AnyProfile — Free Open-Source Antidetect Browser & Android VM Walkthrough",
    description: seo.description,
    thumbnailUrl: [ogPosterUrl],
    uploadDate: "2026-11-11T12:40:00+07:00",
    contentUrl: `${origin}${media.videoPath}`,
    embedUrl: `${url}#ap-demo`,
    duration: media.durationIso,
    inLanguage: media.isVi ? "vi" : "en",
    encodingFormat: "video/mp4",
    width: 1920,
    height: 1080,
    caption: `${origin}${media.captionPath}`,
    publisher: {
      "@type": "Organization",
      name: "AnyTools",
      url: origin,
    },
    hasPart: media.chapters.map((c) => ({
      "@type": "Clip",
      name: c.name,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      url: `${url}#t=${c.startOffset}`,
    })),
  };

  const breadcrumbsLd = breadcrumbSchema([
    { name: "AnyTools", url: `${origin}/${locale}` },
    { name: "AnyProfile", url },
  ]);

  const tags = [
    ...pageMeta({
      title: seo.title,
      description: seo.description,
      url,
      image: ogPosterUrl,
      locale,
      indexable: true,
      alternateLocales: publicLngs,
    }),
    ...alternateLinks(origin, path, locale, publicLngs),
    { "script:ld+json": softwareLd },
    { "script:ld+json": videoLd },
    { "script:ld+json": breadcrumbsLd },
  ];

  if (Array.isArray(faqs) && faqs.length > 0) {
    tags.push({ "script:ld+json": faqSchema(faqs) });
  }

  return tags;
}

type Feature = { title: string; body: string };
type CompareRow = { label: string; anyprofile: string; commercial: string };
type InstallBlock = { os: string; steps: string[] };

/** A `returnObjects` list from the bundle, or nothing if the key is not one. */
function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export default function AnyProfilePage() {
  const { locale, pages, downloads, releasesUrl, repoUrl } = useLoaderData<typeof loader>();
  addPagesBundle(locale, pages);
  const { t } = useTranslation("pages");
  const { release, unreleased, links } = downloads;
  const media = videoMedia(locale);

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
            {unreleased && (
              <div className="flex items-start gap-4 rounded-lg border border-background px-5 py-4">
                <Clock className="mt-0.5 size-6 shrink-0" aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-semibold">{t("anyprofile.comingSoon")}</span>
                  <span className="text-sm opacity-80">{t("anyprofile.comingSoonNote")}</span>
                </span>
              </div>
            )}
            {!unreleased && buttons.map(({ platform, href, label, note, Icon }) => (
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
                href={unreleased ? repoUrl : releasesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80"
              >
                {unreleased ? t("anyprofile.sourceLink") : t("anyprofile.allReleases")}
              </a>
              <a href="#ap-install" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:opacity-80">
                {t("anyprofile.howToInstall")}
              </a>
            </p>
          </div>
        </div>
      </header>

      <div className="lp-layout px-4 py-12 lg:px-6">
        <section aria-labelledby="ap-demo" className="mb-14">
          <h2 id="ap-demo" className="lp-section text-2xl">
            {t("anyprofile.demoTitle")}
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-prose text-muted-foreground">{t("anyprofile.demoSubtitle")}</p>
          <div className="mt-5 overflow-hidden rounded-2xl border bg-black shadow-lg">
            <video
              controls
              playsInline
              preload="metadata"
              poster={media.posterPath}
              className="aspect-video w-full"
            >
              <source src={media.videoPath} type="video/mp4" />
              <track
                kind="captions"
                src={media.captionPath}
                srcLang={media.isVi ? "vi" : "en"}
                label={media.isVi ? "Tiếng Việt" : "English"}
                default
              />
              Your browser does not support the video tag.
            </video>
          </div>
          <ol className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
            {media.chapters.map((ch) => (
              <li key={ch.name} className="rounded-md border px-3 py-2">
                <span className="font-mono font-semibold text-foreground">{ch.label}</span>{" "}
                <span>{ch.name}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <Link
              to={`/${locale}/guides/anyprofile`}
              className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
            >
              {t("anyprofile.guideCta")} →
            </Link>
            <span>
              {!unreleased && (
                <>
                  {t("anyprofile.demoShortsLabel")}{" "}
                  <a
                    href="https://github.com/D0bby999/anyprofile/releases/latest/download/anyprofile-short-en.mp4"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    EN (9:16)
                  </a>
                  {" · "}
                  <a
                    href="https://github.com/D0bby999/anyprofile/releases/latest/download/anyprofile-short-vi.mp4"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    VI (9:16)
                  </a>
                </>
              )}
            </span>
          </div>
        </section>

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

        <section aria-labelledby="ap-compare" className="mt-14">
          <h2 id="ap-compare" className="lp-section text-2xl">
            {t("anyprofile.compareTitle")}
          </h2>
          <p className="mt-2 max-w-[70ch] text-sm leading-prose text-muted-foreground">{t("anyprofile.compareSubtitle")}</p>
          <div className="mt-5 overflow-hidden rounded-lg border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="hidden border-b bg-muted/40 text-sm text-muted-foreground sm:table-header-group">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("anyprofile.compareColCriteria")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-foreground">{t("anyprofile.compareColAnyProfile")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("anyprofile.compareColCommercial")}</th>
                </tr>
              </thead>
              <tbody className="block divide-y sm:table-row-group">
                {list<CompareRow>(t("anyprofile.compareRows", { returnObjects: true })).map((row) => (
                  <tr key={row.label} className="block space-y-2 p-4 align-top sm:table-row sm:space-y-0 sm:p-0">
                    <th scope="row" className="block font-serif text-base font-semibold text-foreground sm:table-cell sm:px-4 sm:py-3.5 sm:font-sans sm:text-sm sm:font-medium">
                      {row.label}
                    </th>
                    <td className="block font-medium text-foreground sm:table-cell sm:px-4 sm:py-3.5">
                      <span className="text-muted-foreground sm:hidden">{t("anyprofile.compareColAnyProfile")}: </span>
                      {row.anyprofile}
                    </td>
                    <td className="block text-muted-foreground sm:table-cell sm:px-4 sm:py-3.5">
                      <span className="font-medium text-foreground sm:hidden">{t("anyprofile.compareColCommercial")}: </span>
                      {row.commercial}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

        <section aria-labelledby="ap-faqs" className="mt-14">
          <h2 id="ap-faqs" className="lp-section text-2xl">
            {t("anyprofile.faqTitle")}
          </h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {list<FaqItem>(t("anyprofile.faqs", { returnObjects: true })).map((faq) => (
              <div key={faq.q} className="lp-keybox p-5 sm:p-6">
                <h3 className="font-serif text-lg font-semibold">{faq.q}</h3>
                <p className="mt-2 text-sm leading-prose text-muted-foreground">{faq.a}</p>
              </div>
            ))}
          </div>
        </section>

        <nav aria-label={t("rankings.title")} className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link
            to={`/${locale}/rankings/proxies`}
            className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
          >
            {t("rankings.viewCategory")}: Proxies →
          </Link>
          <Link
            to={`/${locale}/rankings/antidetect-browsers`}
            className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
          >
            {t("rankings.viewCategory")}: Antidetect Browsers →
          </Link>
        </nav>

        <p className="mt-8 max-w-(--lp-measure-read) border-t pt-6 text-xs leading-prose text-muted-foreground">
          {t("anyprofile.responsibility")}
        </p>
      </div>
    </div>
  );
}
