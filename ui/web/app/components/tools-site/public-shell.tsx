import { useEffect, type ReactNode } from "react";
import { Form, Link, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";
import { ThemeToggle } from "~/components/layout/theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";
import { StudyBand } from "./anyprofile-feature";

/** Source of the open-source repository (phase 5 publishes it). */
export const SOURCE_URL = "https://github.com/D0bby999/anytools";

/**
 * The footer's links. Each one must resolve: the continuity test renders
 * every internal one through the router.
 */
export const FOOTER_LINKS: readonly { to: (locale: PublicLng) => string; labelKey: string; external?: boolean }[] = [
  { to: (l) => `/${l}/guides`, labelKey: "footer.guides" },
  { to: (l) => `/${l}/anyprofile`, labelKey: "footer.anyprofile" },
  { to: (l) => `/${l}/about`, labelKey: "footer.about" },
  { to: (l) => `/${l}/privacy`, labelKey: "footer.privacy" },
  { to: (l) => `/${l}/terms`, labelKey: "footer.terms" },
  { to: (l) => `/${l}/contact`, labelKey: "footer.contact" },
  { to: () => SOURCE_URL, labelKey: "site.sourceCode", external: true },
];

/** The element the shortcut focuses: the page's own search if it has one. */
export const SEARCH_ATTR = "data-tools-search";

/**
 * "/" and Ctrl/Cmd+K focus the search box, which is what the old site's
 * Cmd+K palette was for. Focusing the box already on the page keeps one search
 * and no dialog to trap focus in.
 */
function useSearchShortcut() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target instanceof Element ? e.target : null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']");
      const palette = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!palette && (e.key !== "/" || typing)) return;
      const boxes = document.querySelectorAll<HTMLInputElement>(`[${SEARCH_ATTR}]`);
      const box = boxes[boxes.length - 1];
      if (!box) return;
      e.preventDefault();
      box.focus();
      box.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The frame of every public page: wordmark, search, language and theme, the
 * page, and a footer. A route whose page carries its own search (the tools
 * home) sets `handle = { ownSearch: true }` and the header leaves its box out,
 * so a page never shows two.
 */
export function PublicShell({ locale, children }: { locale: PublicLng; children: ReactNode }) {
  const { t } = useTranslation("tools");
  const ownSearch = useMatches().some((m) => (m.handle as { ownSearch?: boolean } | undefined)?.ownSearch);
  useSearchShortcut();

  return (
    // The tools are the book's appendix: everything here sits in its part.
    <div data-part="tools" className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-background">
        <div className="lp-layout flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-6">
          <Link
            to={`/${locale}`}
            translate="no"
            aria-label={t("site.home")}
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-serif text-xl font-semibold tracking-display">AnyTools</span>
            <span aria-hidden="true" className="lp-tab hidden sm:inline-flex">
              {t("feature.appendix")}
            </span>
          </Link>

          <nav aria-label={t("feature.appendix")} className="hidden items-center gap-1 md:flex">
            <Link to={`/${locale}/guides`} className={NAV_LINK}>
              {t("nav.guides")}
            </Link>
            <Link to={`/${locale}/anyprofile`} className={NAV_LINK}>
              {t("footer.anyprofile")}
            </Link>
          </nav>

          {/* Phone: the wordmark and the study app on the first row; search,
              language and theme on the second. */}
          <div className="ml-auto sm:order-last sm:ml-0">
            <ThemeToggle labels={{ useLight: t("site.useLight"), useDark: t("site.useDark") }} />
          </div>
          <a
            href="/"
            className="inline-flex min-h-11 items-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold whitespace-nowrap text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:order-last"
          >
            {t("site.openApp")}
          </a>
          <span aria-hidden="true" className="basis-full sm:hidden" />

          {!ownSearch && (
            <Form method="get" action={`/${locale}`} role="search" className="min-w-0 flex-1 sm:max-w-xs">
              <label className="relative block">
                <span className="sr-only">{t("site.search")}</span>
                <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  name="q"
                  {...{ [SEARCH_ATTR]: "" }}
                  placeholder={t("site.search")}
                  aria-describedby="tools-search-hint"
                  className="h-11 w-full rounded-md border bg-card pr-3 pl-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              <span id="tools-search-hint" className="sr-only">
                {t("site.searchHint")}
              </span>
            </Form>
          )}

          {/* The study app is the product; the tools are its appendix. So the
              one filled button on every tools page (above) leads back to it. */}
          <div className="flex items-center gap-1 sm:ml-auto">
            <LocaleSwitcher locale={locale} />
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <StudyBand />

      <footer className="border-t">
        <div className="lp-layout flex flex-col gap-3 px-4 py-6 text-sm text-muted-foreground lg:px-6">
          <p className="max-w-(--lp-measure-read)">{t("site.footerNote")}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {FOOTER_LINKS.map((l) => (
              <li key={l.labelKey}>
                {l.external ? (
                  <a href={l.to(locale)} rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                    {t(l.labelKey)}
                  </a>
                ) : (
                  <Link to={l.to(locale)} className="inline-flex min-h-11 items-center underline-offset-4 hover:text-foreground hover:underline">
                    {t(l.labelKey)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </div>
  );
}

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
