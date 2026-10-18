import { useEffect, type ReactNode } from "react";
import { Form, Link, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";
import { ThemeToggle } from "~/components/layout/theme-toggle";
import { LocaleSwitcher } from "./locale-switcher";

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
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="lp-layout flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 lg:px-6">
          <Link
            to={`/${locale}`}
            translate="no"
            aria-label={t("site.home")}
            className="font-serif text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            AnyTools
          </Link>

          {!ownSearch && (
            <Form method="get" action={`/${locale}`} role="search" className="order-last w-full sm:order-none sm:w-auto sm:flex-1 sm:max-w-sm">
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

          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher locale={locale} />
            <ThemeToggle labels={{ useLight: t("site.useLight"), useDark: t("site.useDark") }} />
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-primary-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("site.openApp")}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="border-t">
        <div className="lp-layout flex flex-col gap-3 px-4 py-6 text-sm text-muted-foreground lg:px-6">
          <p className="max-w-(--lp-measure-read)">{t("site.footerNote")}</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {FOOTER_LINKS.map((l) => (
              <li key={l.labelKey}>
                {l.external ? (
                  <a href={l.to(locale)} rel="noopener noreferrer" className="underline-offset-4 hover:text-foreground hover:underline">
                    {t(l.labelKey)}
                  </a>
                ) : (
                  <Link to={l.to(locale)} className="underline-offset-4 hover:text-foreground hover:underline">
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
