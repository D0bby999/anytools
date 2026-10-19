import { useEffect, type ReactNode } from "react";
import { Link, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import type { PublicLng } from "~/lib/i18n";
import { SEARCH_ATTR, SiteHeader } from "~/components/layout/site-header";
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
export { SEARCH_ATTR };

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
 * The frame of every public page: the site header (the landing page's, with
 * the tools search), the page, the study app's band, and the site footer. A
 * route whose page carries its own search (the tools home) sets
 * `handle = { ownSearch: true }` and the header leaves its box out, so a page
 * never shows two.
 */
export function PublicShell({ locale, children }: { locale: PublicLng; children: ReactNode }) {
  const { t } = useTranslation("tools");
  const ownSearch = useMatches().some((m) => (m.handle as { ownSearch?: boolean } | undefined)?.ownSearch);
  useSearchShortcut();

  return (
    // The tools are the book's appendix: everything here sits in its part.
    <div data-part="tools" className="flex min-h-screen flex-col bg-background">
      <SiteHeader locale={locale} search={!ownSearch} />

      <main id="main" className="flex-1">
        {children}
      </main>

      <StudyBand />

      <SiteFooter locale={locale} note={t("site.footerNote")} />
    </div>
  );
}

/**
 * The site's one footer, under the landing page and every public page: the
 * wordmark and a sentence about the page's place in the site, then the links
 * to the rest of it.
 */
export function SiteFooter({ locale, note }: { locale: PublicLng; note: string }) {
  const { t } = useTranslation("tools");
  return (
    <footer className="border-t bg-muted">
      <div className="lp-layout grid gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16 lg:px-6">
        <div>
          <p translate="no" className="font-serif text-xl font-semibold tracking-display">
            AnyTools
          </p>
          <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-snug text-muted-foreground">{note}</p>
        </div>
        <nav aria-label={t("site.more")}>
          <ul className="grid grid-cols-2 gap-x-10 text-sm sm:grid-cols-3">
            {FOOTER_LINKS.map((l) => (
              <li key={l.labelKey}>
                {l.external ? (
                  <a href={l.to(locale)} rel="noopener noreferrer" className={FOOTER_LINK}>
                    {t(l.labelKey)}
                  </a>
                ) : (
                  <Link to={l.to(locale)} className={FOOTER_LINK}>
                    {t(l.labelKey)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

const FOOTER_LINK =
  "inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
