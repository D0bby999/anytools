import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "~/components/layout/theme-toggle";
import { AccountMenu } from "~/components/layout/account-menu";
import { NAV_ITEMS, TOOLS_ITEM } from "~/components/layout/sidebar";
import { PARTS, partOf } from "~/lib/parts";

/**
 * The running head: what a textbook prints at the top of every page. Which
 * part you are in (its tab) and which section, then the account. It replaces
 * a breadcrumb: the part is the one piece of wayfinding a deep page needs.
 *
 * Not the site header (site-header.tsx), on purpose (2026-10-19): the app's
 * places are the rail's ten rows in four parts and an appendix, which three header links
 * cannot hold, and the phone already has its bar at the bottom. It ends the
 * same way, though: the wordmark in the same face and size where the rail is
 * hidden, Free tools (the tools appendix, moved here from the rail on the
 * owner's call, 2026-10-20), the theme switch, and the account
 * (account-menu.tsx).
 */
/**
 * Pages with no rail row of their own, named by the section they are opened
 * from: a document and a book from Knowledge, a worksheet from the Loop.
 * Without this the running head showed the part's tab and nothing after it.
 */
const SECTION_OF: Record<string, string> = {
  documents: "/knowledge",
  books: "/knowledge",
  feeds: "/knowledge",
  toolkit: "/loop",
};

export function Topbar({ displayName, email }: { displayName: string; email: string }) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const part = PARTS.find((p) => p.id === partOf(pathname));
  const alias = SECTION_OF[pathname.split("/")[1] ?? ""];
  const section = alias
    ? NAV_ITEMS.find((n) => n.to === alias)
    : NAV_ITEMS.find((n) => pathname === n.to || pathname.startsWith(n.to + "/"));

  return (
    <header className="flex h-(--lp-topbar-h) shrink-0 items-center gap-3 border-b bg-background px-4 lg:px-8">
      {/* The rail carries the wordmark from `lg` up; below that the rail is a
          bottom bar with no room for it, so the running head holds it. */}
      <Link to="/home" translate="no" className="rounded-md font-serif text-2xl font-semibold tracking-display focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden">
        {t("app.name")}
      </Link>

      <p className="flex min-w-0 items-center gap-2 text-sm">
        {part ? (
          <span className="lp-tab">
            <span aria-hidden="true">{part.numeral}</span>
            <span className="sr-only">{t("parts.part", { numeral: part.numeral })}:</span>
            <span className="hidden sm:inline">{t(part.labelKey)}</span>
          </span>
        ) : null}
        {section ? <span className="hidden truncate font-medium lg:inline">{t(section.labelKey)}</span> : null}
      </p>

      <div className="ml-auto flex items-center gap-2">
        {/* A plain link: /tools is the tools site, outside this app's router. */}
        <a
          href={TOOLS_ITEM.to}
          data-part="tools"
          aria-label={t("appendix.free")}
          className="inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <TOOLS_ITEM.icon aria-hidden="true" className="size-4 shrink-0 text-part" />
          <span className="hidden sm:inline">{t("appendix.free")}</span>
        </a>
        <ThemeToggle />
        <AccountMenu displayName={displayName} email={email} />
      </div>
    </header>
  );
}
