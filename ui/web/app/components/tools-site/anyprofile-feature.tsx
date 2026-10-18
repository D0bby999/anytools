import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";

/**
 * AnyProfile, first in the tools appendix (owner, 2026-10-18: "design
 * anyprofile lên đầu các tools để cho nổi bật"). Set like a book's cover in
 * ink, so it is the one block on the tools pages that is not paper. Its copy
 * is the AnyProfile page's own, in the visitor's language.
 */
export function AnyProfileFeature({ locale, compact = false }: { locale: PublicLng; compact?: boolean }) {
  const { t } = useTranslation("tools");
  const href = `/${locale}/anyprofile`;
  return (
    <section
      aria-labelledby="tools-anyprofile"
      className="lp-page-enter overflow-hidden rounded-xl bg-foreground text-background shadow-md"
    >
      <div className="grid gap-6 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end lg:px-10 lg:py-9">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-label uppercase opacity-80">
            {t("feature.anyprofile.kind")} · {t("feature.anyprofile.badge")}
          </p>
          <h2 id="tools-anyprofile" className="mt-2 font-serif text-4xl font-semibold tracking-display">
            {t("feature.anyprofile.title")}
          </h2>
          <p className="mt-2 font-serif text-xl leading-snug italic opacity-95">{t("feature.anyprofile.tagline")}</p>
          {compact ? null : (
            <p className="mt-4 max-w-[64ch] text-sm leading-prose opacity-90">{t("feature.anyprofile.body")}</p>
          )}
        </div>
        <Link
          to={href}
          className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-md border border-background bg-background px-6 text-base font-semibold text-foreground transition-colors hover:bg-transparent hover:text-background focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-foreground focus-visible:outline-none lg:self-end"
        >
          {t("feature.anyprofile.cta")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  );
}

/**
 * The study app, from inside the tools appendix: the product's main part, so
 * every tools page ends by pointing back to it.
 */
export function StudyBand() {
  const { t } = useTranslation("tools");
  return (
    <section aria-labelledby="tools-study" className="border-t bg-muted">
      <div className="lp-layout flex flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <div className="max-w-[62ch]">
          <h2 id="tools-study" className="font-serif text-2xl font-semibold">
            {t("feature.study.title")}
          </h2>
          <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("feature.study.body")}</p>
        </div>
        <a
          href="/"
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover"
        >
          {t("feature.study.cta")}
          <ArrowRight aria-hidden="true" className="size-4" />
        </a>
      </div>
    </section>
  );
}
