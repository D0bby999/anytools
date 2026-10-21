import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Search } from "lucide-react";
import { Flyout, FlyoutGroup, FlyoutLink, FlyoutTitle } from "~/components/doc/flyout";
import { AccountItems, AccountMenu } from "~/components/layout/account-menu";
import { LanguageList, LanguageMenu } from "~/components/layout/language-menu";
import { NavScreen } from "~/components/layout/nav-screen";
import { AppearanceSwitch } from "~/components/layout/theme-toggle";
import { isTopActive, TOP_NAV } from "~/lib/nav-tree";
import { cn } from "~/lib/utils";

/** The event the search button, ⌘K and `/` all raise; search-modal.tsx listens. */
export const OPEN_SEARCH_EVENT = "lp:open-search";

export function openSearch() {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH_EVENT));
}

/** "⌘" on a Mac, "Ctrl" elsewhere; "Ctrl" until mount, when the platform is known. */
export function useModKey(): string {
  const [key, setKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setKey("⌘");
  }, []);
  return key;
}

/**
 * The search button, VPNavBarSearchButton: below 768 a bare icon (48×55);
 * from 768 a 40px field-like button on the alt surface, radius 8, a 1px
 * border that is clear until hover turns it brand; from 1024 it adds "Search"
 * (13/500) and the shortcut keys.
 */
function SearchButton() {
  const { t } = useTranslation("common");
  const mod = useModKey();
  return (
    <div className="flex items-center md:flex-1 md:pl-6 min-[960px]:pl-8">
      <button
        type="button"
        onClick={openSearch}
        aria-keyshortcuts="Meta+K Control+K /"
        className={cn(
          "flex h-[55px] w-12 items-center justify-center text-foreground",
          "md:h-10 md:w-auto md:justify-start md:rounded-md md:border md:border-transparent md:bg-muted md:pr-2.5 md:pl-3 md:transition-colors md:hover:border-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        )}
      >
        <Search aria-hidden="true" className="size-4 md:mr-2 md:size-3.5 md:text-muted-foreground" />
        <span className="sr-only lg:not-sr-only lg:pr-4 lg:text-[13px] lg:font-medium lg:text-muted-foreground">
          {t("nav.search")}
        </span>
        <span aria-hidden="true" className="hidden h-[22px] items-center gap-0.5 rounded-xs border px-1.5 text-xs font-medium text-muted-foreground lg:flex">
          <kbd className="font-sans">{mod}</kbd>
          <kbd className="font-sans">K</kbd>
        </span>
      </button>
    </div>
  );
}

const NAV_LINK = "flex h-(--lp-topbar-h) items-center px-3 text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset";

/** A 1px × 24 rule between the nav's groups of controls. */
function Rule({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("mx-2 h-6 w-px bg-border", className)} />;
}

/** The "…" menu from 768 to 1279, VPNavBarExtra: what the bar has no room for. */
function ExtraMenu({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  return (
    <Flyout
      className="hidden md:block xl:hidden"
      label={t("nav.extraNavigation")}
      hideChevron
      icon={<MoreHorizontal aria-hidden="true" className="size-5" />}
      menuClassName="w-64"
    >
      <FlyoutGroup>
        <FlyoutTitle>{t("nav.language")}</FlyoutTitle>
        <LanguageList />
      </FlyoutGroup>
      <FlyoutGroup>
        <div className="flex items-center justify-between px-3 text-sm leading-8 font-medium">
          <span>{t("nav.appearance")}</span>
          <AppearanceSwitch />
        </div>
      </FlyoutGroup>
      <FlyoutGroup>
        <FlyoutLink to="/tools" external>
          {t("appendix.free")}
        </FlyoutLink>
      </FlyoutGroup>
      <AccountItems displayName={displayName} email={email} />
    </Flyout>
  );
}

/**
 * The hamburger, VPNavBarHamburger: three bars 16×14 that shift on hover and
 * fold into an X when the nav screen is open.
 */
function Hamburger({ open, onClick, buttonRef }: { open: boolean; onClick: () => void; buttonRef: React.RefObject<HTMLButtonElement | null> }) {
  const { t } = useTranslation("common");
  const bar = "absolute left-0 h-0.5 bg-foreground transition-[top,translate,rotate,width] duration-250 motion-reduce:transition-none";
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls="lp-nav-screen"
      aria-label={t("nav.mobileNavigation")}
      onClick={onClick}
      className="group flex h-(--lp-topbar-h) w-12 items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset md:hidden"
    >
      <span aria-hidden="true" className="relative h-3.5 w-4 overflow-hidden">
        <span className={cn(bar, "top-0 w-4", open ? "top-1.5 rotate-[225deg]" : "group-hover:translate-x-1")} />
        <span className={cn(bar, "top-1.5 w-4", open ? "translate-x-4" : "group-hover:translate-x-0")} />
        <span className={cn(bar, "top-3 w-4", open ? "top-1.5 -rotate-[135deg]" : "group-hover:translate-x-2")} />
      </span>
    </button>
  );
}

/**
 * The top nav, VitePress's VPNavBar, 64 high: the wordmark in a column as
 * wide as the sidebar (on the sidebar's surface from 960), then search, the
 * four TOP_NAV links (from 768), and from 1280 the language flyout, the
 * appearance switch, Free tools and the account; between 768 and 1279 those
 * fold into "…", below 768 into the nav screen behind the hamburger.
 *
 * Its bottom hairline appears only once the scroll region has left the top,
 * as VitePress drops the `top` class.
 */
export function TopNav({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const header = useRef<HTMLElement>(null);
  const hamburger = useRef<HTMLButtonElement>(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const [atTop, setAtTop] = useState(true);

  useEffect(() => setScreenOpen(false), [pathname]);

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-lp-scroll]");
    if (!scroller) return;
    const onScroll = () => setAtTop(scroller.scrollTop <= 0);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  // The nav screen exists only below 768: widening the window closes it.
  useEffect(() => {
    if (!screenOpen || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia("(min-width: 768px)");
    const onChange = () => wide.matches && setScreenOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [screenOpen]);

  return (
    <header ref={header} className="relative z-(--lp-z-nav) shrink-0">
      <div className="flex h-(--lp-topbar-h)">
        <div className="flex shrink-0 items-center pl-6 md:pl-8 min-[960px]:w-(--lp-shell-rail) min-[960px]:bg-muted min-[960px]:pr-8 min-[960px]:pl-(--lp-shell-gutter)">
          <Link
            to="/home"
            translate="no"
            // The wordmark is set in the book face (DESIGN.md), at the size the
            // site header's footer uses beside its tiles.
            className="rounded-xs font-serif text-xl font-semibold tracking-display text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("app.name")}
          </Link>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-x-2 bg-background pr-2 md:gap-x-0 md:pr-8 min-[1440px]:pr-[calc(max(0px,(100vw-var(--lp-layout-max))/2)+32px)]">
          <SearchButton />

          <nav aria-label={t("nav.mainNavigation")} className="hidden md:flex">
            {TOP_NAV.map((item) => {
              const active = isTopActive(pathname, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(NAV_LINK, active ? "text-primary" : "text-foreground")}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center xl:flex">
            <Rule />
            <LanguageMenu />
            <Rule className="mr-4" />
            <AppearanceSwitch />
            <Rule className="ml-4" />
            {/* A plain link: /tools is the tools site, outside this app's router. */}
            <a href="/tools" className={cn(NAV_LINK, "text-foreground")}>
              {t("appendix.free")}
            </a>
            <AccountMenu displayName={displayName} email={email} />
          </div>

          <ExtraMenu displayName={displayName} email={email} />
          <Hamburger open={screenOpen} onClick={() => setScreenOpen((o) => !o)} buttonRef={hamburger} />
        </div>
      </div>

      <div
        aria-hidden="true"
        data-nav-divider
        className={cn(
          "absolute right-0 bottom-0 left-0 h-px bg-border transition-opacity duration-500 min-[960px]:left-(--lp-shell-rail)",
          atTop && !screenOpen ? "opacity-0" : "opacity-100",
        )}
      />

      <NavScreen
        open={screenOpen}
        onClose={() => setScreenOpen(false)}
        returnTo={hamburger}
        keep={header}
        displayName={displayName}
        email={email}
      />
    </header>
  );
}
