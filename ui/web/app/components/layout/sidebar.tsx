import { Link, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  GraduationCap,
  Home,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Repeat,
  Settings,
  Sigma,
  Telescope,
  Wrench,
} from "lucide-react";
import { cn } from "~/lib/utils";

/**
 * Navigation is a data array rather than inline JSX so later phases add a
 * destination by appending one entry — and so a test can assert every `to`
 * resolves to a registered route.
 */
export const NAV_ITEMS = [
  { to: "/home", labelKey: "nav.home", icon: Home, end: true, phone: true },
  { to: "/knowledge", labelKey: "nav.knowledge", icon: BookOpen, end: false, phone: true },
  { to: "/chat", labelKey: "nav.chat", icon: MessageSquare, end: false, phone: true },
  { to: "/notebooks", labelKey: "nav.notebooks", icon: NotebookPen, end: false, phone: false },
  { to: "/quiz", labelKey: "nav.quiz", icon: ListChecks, end: false, phone: false },
  { to: "/mastery", labelKey: "nav.mastery", icon: GraduationCap, end: false, phone: false },
  { to: "/solve", labelKey: "nav.solve", icon: Sigma, end: false, phone: false },
  { to: "/research", labelKey: "nav.research", icon: Telescope, end: false, phone: false },
  { to: "/loop", labelKey: "nav.loop", icon: Repeat, end: false, phone: true },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, end: false, phone: false },
] as const;

/**
 * The phone bar's last slot: a link to /more, a plain page listing every
 * destination. Ten destinations do not fit a 390px bar (each shrank to 46px
 * and Loop and Settings fell off the edge, unreachable), and DESIGN.md rules
 * out a drawer. A page needs no focus trap and keeps every destination two
 * taps away at most.
 */
export const MORE_ITEM = { to: "/more", labelKey: "nav.more", icon: MoreHorizontal } as const;

/**
 * AnyTools phase 2: the public tools, a section of the site rather than of
 * the app, so it is not in NAV_ITEMS (and /more): it sits after them on the
 * rail and beside More on the phone bar. `/tools` redirects to the tools home
 * in the visitor's language (routes/tools.ts). Its label lives in the tools
 * namespace, which the public pages translate.
 */
export const TOOLS_ITEM = { to: "/tools", labelKey: "tools:nav.tools", icon: Wrench } as const;

// Every row, enabled or not, keeps the same box so the rail does not reflow
// as phases 4-6 switch entries on.
const ROW =
  "flex flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-2xs " +
  "lg:flex-row lg:justify-start lg:gap-3 lg:rounded-md lg:px-3 lg:py-2 lg:text-sm " +
  "min-h-11 transition-colors";

/** Destinations not yet implemented render as disabled rather than as links
 *  that 404 — phases 4-6 replace this list as they land. */
const AVAILABLE: readonly string[] = [
  "/home",
  "/knowledge",
  "/chat",
  "/quiz",
  "/mastery",
  "/solve",
  "/research",
  "/loop",
  "/notebooks",
  "/settings",
];

/**
 * One nav, two shapes: a left rail from `lg` up, a bottom bar below it.
 *
 * It is deliberately not a drawer behind a hamburger. A collapsed nav that
 * only opens on a button press is how an admin shell ends up looking empty on
 * a phone (design-world references/modes.md logs exactly that failure), and it
 * costs a focus trap to do correctly. A bottom bar keeps every destination
 * visible and keeps DOM order equal to visual order at both sizes.
 */
export function Sidebar() {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  // On a phone, "More" is the current slot for every destination not in the bar.
  const moreActive =
    pathname === MORE_ITEM.to ||
    NAV_ITEMS.some((n) => !n.phone && (pathname === n.to || pathname.startsWith(n.to + "/")));

  return (
    <nav
      aria-label={t("nav.label")}
      className={cn(
        // Phone: a fixed bar along the bottom edge, above the home indicator.
        "fixed inset-x-0 bottom-0 z-sticky flex shrink-0 border-t bg-muted [padding-bottom:env(safe-area-inset-bottom)]",
        // Desktop: the rail. The rail is the second neutral layer of the
        // world, one step away from the page rather than a card on top of it.
        "lg:static lg:h-full lg:w-(--lp-rail-w) lg:flex-col lg:border-t-0 lg:border-r lg:[padding-bottom:0]",
      )}
    >
      <div className="hidden px-5 py-5 lg:block">
        <span translate="no" className="font-serif text-lg font-semibold">
          {t("app.name")}
        </span>
      </div>

      <ul className="flex flex-1 lg:flex-col lg:gap-1 lg:px-3">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon, end, phone }) => {
          const enabled = AVAILABLE.includes(to);
          const label = t(labelKey);

          const row = ROW;

          if (!enabled) {
            return (
              <li key={to} className={cn("flex-1 lg:flex-none lg:block", phone ? "flex" : "hidden")}>
                <span aria-disabled="true" className={cn(row, "cursor-not-allowed text-faint")}>
                  <Icon aria-hidden="true" className="size-5 lg:size-4" />
                  <span className="truncate">{label}</span>
                  {/* Greyed out says "unavailable" to the eye and nothing at
                      all to a screen reader: aria-disabled on a span nobody can
                      focus is inert. */}
                  <span className="sr-only">{t("nav.comingSoon")}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={to} className={cn("flex-1 lg:flex-none lg:block", phone ? "flex" : "hidden")}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    row,
                    isActive
                      ? "bg-selected font-medium text-selected-foreground"
                      : "text-muted-foreground hover:bg-primary-soft hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon aria-hidden="true" className="size-5 lg:size-4" />
                    <span className="truncate">{label}</span>
                    {/* The current row is already carried by colour and weight;
                        this makes it survive a colour-blind read and a forced
                        high-contrast mode, where the tint disappears. */}
                    {isActive && <span className="sr-only">{t("nav.current")}</span>}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
        <li className="flex flex-1 lg:block lg:flex-none">
          <Link to={TOOLS_ITEM.to} className={cn(ROW, "text-muted-foreground hover:bg-primary-soft hover:text-foreground")}>
            <TOOLS_ITEM.icon aria-hidden="true" className="size-5 lg:size-4" />
            <span className="truncate">{t(TOOLS_ITEM.labelKey)}</span>
          </Link>
        </li>
        <li className="flex flex-1 lg:hidden">
          <NavLink
            to={MORE_ITEM.to}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-2xs transition-colors",
              moreActive
                ? "bg-selected font-medium text-selected-foreground"
                : "text-muted-foreground hover:bg-primary-soft hover:text-foreground",
            )}
          >
            <MORE_ITEM.icon aria-hidden="true" className="size-5" />
            <span className="truncate">{t(MORE_ITEM.labelKey)}</span>
            {moreActive && <span className="sr-only">{t("nav.current")}</span>}
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
