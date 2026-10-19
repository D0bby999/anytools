import { Form, Link, NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { Menu, Search } from "lucide-react";
import type { PublicLng } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { ThemeToggle } from "~/components/layout/theme-toggle";
import { LocaleSwitcher, useDisclosureMenu } from "~/components/tools-site/locale-switcher";

/** The element the "/" and Ctrl+K shortcut focuses (public-shell.tsx). */
export const SEARCH_ATTR = "data-tools-search";

/**
 * The landing page in a language, English included. Each language has one
 * address that always shows it; the bare `/` is the x-default, which follows
 * the visitor's last choice or their browser (routes/landing.tsx). A link that
 * pointed English at `/` sent a Vietnamese browser straight back to
 * Vietnamese (2026-10-19).
 */
export function homeHref(locale: PublicLng): string {
  return `/?lng=${locale}`;
}

/**
 * The site's one header (owner, 2026-10-19: every page's header follows the
 * home page's). The landing page, every public tool page and sign-in draw it;
 * the signed-in app keeps its rail and topbar, which is a workspace rather
 * than a site.
 *
 * Wordmark, the three places a visitor goes (Tools, Guides, AnyProfile), then
 * the controls: the tools search where a page wants it, the language menu, the
 * theme, and the way into the study app. On a phone the three places and
 * the way in fold into a menu, and the search drops to its own row.
 *
 * `languages: false` leaves the menu out on an English-only page (sign-in);
 * `languageHref` addresses a page whose language is not its first path
 * segment (the landing page).
 */
export function SiteHeader({
  locale,
  languages = true,
  languageHref,
  search = false,
  signIn = true,
}: {
  locale: PublicLng;
  languages?: boolean;
  languageHref?: (l: PublicLng) => string;
  search?: boolean;
  signIn?: boolean;
}) {
  const { t } = useTranslation("tools");
  const places = [
    { to: `/${locale}`, label: t("nav.tools"), end: true },
    { to: `/${locale}/guides`, label: t("nav.guides"), end: false },
    { to: `/${locale}/anyprofile`, label: t("footer.anyprofile"), end: false },
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="lp-layout flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5 lg:gap-x-3 lg:px-6">
        <Link
          to={homeHref(locale)}
          translate="no"
          aria-label={t("site.home")}
          className="mr-2 rounded-md font-serif text-2xl font-semibold tracking-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          AnyTools
        </Link>

        <nav aria-label={t("site.places")} className="hidden items-center gap-1 md:flex">
          {places.map((p) => (
            <NavLink
              key={p.to}
              to={p.to}
              end={p.end}
              className={({ isActive }) => cn(NAV_LINK, isActive && "bg-selected font-medium text-selected-foreground")}
            >
              {p.label}
            </NavLink>
          ))}
        </nav>

        <span aria-hidden="true" className="flex-1" />
        {/* A phone puts the search on a row of its own, under the controls. */}
        {search && <HeaderSearch locale={locale} className="order-last basis-full lg:order-none lg:basis-64 xl:basis-72" />}
        <div className="flex items-center gap-1">
          {languages && <LocaleSwitcher locale={locale} hrefFor={languageHref} />}
          <ThemeToggle labels={{ useLight: t("site.useLight"), useDark: t("site.useDark") }} />
          <PlacesMenu places={places} signIn={signIn} />
          {signIn && (
            <Link to="/login" className={cn(ACCOUNT_ACTION, "ml-1 hidden sm:inline-flex")}>
              {t("site.signIn")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** The three places, on a phone: the same links, behind one button, with the way in under them. */
function PlacesMenu({ places, signIn }: { places: { to: string; label: string; end: boolean }[]; signIn: boolean }) {
  const { t } = useTranslation("tools");
  const ref = useDisclosureMenu();
  return (
    <details ref={ref} className="group relative md:hidden">
      <summary
        aria-label={t("site.menu")}
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-open:bg-hover [&::-webkit-details-marker]:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </summary>
      <nav aria-label={t("site.places")} className="absolute right-0 z-50 mt-1 min-w-48 rounded-lg border bg-card p-1 shadow-md">
        <ul>
          {places.map((p) => (
            <li key={p.to}>
              <NavLink
                to={p.to}
                end={p.end}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center rounded-md px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isActive ? "bg-selected font-medium text-selected-foreground" : "hover:bg-hover",
                  )
                }
              >
                {p.label}
              </NavLink>
            </li>
          ))}
          {signIn && (
            <li className="mt-1 border-t pt-1 sm:hidden">
              <Link
                to="/login"
                className="flex min-h-11 items-center rounded-md px-3 text-sm font-semibold hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t("site.signIn")}
              </Link>
            </li>
          )}
        </ul>
      </nav>
    </details>
  );
}

/** The tools search: a plain GET form to the tools home, so it works before hydration. */
function HeaderSearch({ locale, className }: { locale: PublicLng; className?: string }) {
  const { t } = useTranslation("tools");
  return (
    <Form method="get" action={`/${locale}`} role="search" className={className}>
      <label className="relative block">
        <span className="sr-only">{t("site.search")}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          name="q"
          {...{ [SEARCH_ATTR]: "" }}
          placeholder={t("site.search")}
          aria-describedby="tools-search-hint"
          className="h-11 w-full rounded-md border bg-card pr-3 pl-9 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm"
        />
      </label>
      <span id="tools-search-hint" className="sr-only">
        {t("site.searchHint")}
      </span>
    </Form>
  );
}

/**
 * The way in (Sign in here) and the way out (Sign out in the app's topbar):
 * one outlined button, so the two headers end on the same control.
 */
export const ACCOUNT_ACTION =
  "inline-flex min-h-11 items-center rounded-md border border-control-border px-4 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

const NAV_LINK =
  "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
