import { Link, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Dumbbell,
  GraduationCap,
  Home,
  Languages,
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
import { PARTS, partOf, type PartId } from "~/lib/parts";

/**
 * Navigation is a data array rather than inline JSX so a destination is added
 * by appending one entry, and so a test can assert every `to` resolves to a
 * registered route. `part` places the row in the textbook's table of contents
 * (lib/parts.ts); front matter (Today, Settings) has none.
 */
export const NAV_ITEMS = [
  { to: "/home", labelKey: "nav.home", icon: Home, end: true, phone: true, part: "home" },
  { to: "/knowledge", labelKey: "nav.knowledge", icon: BookOpen, end: false, phone: true, part: "read" },
  { to: "/notebooks", labelKey: "nav.notebooks", icon: NotebookPen, end: false, phone: false, part: "read" },
  { to: "/chat", labelKey: "nav.chat", icon: MessageSquare, end: false, phone: true, part: "ask" },
  { to: "/solve", labelKey: "nav.solve", icon: Sigma, end: false, phone: false, part: "ask" },
  { to: "/research", labelKey: "nav.research", icon: Telescope, end: false, phone: false, part: "ask" },
  { to: "/quiz", labelKey: "nav.quiz", icon: ListChecks, end: false, phone: false, part: "practise" },
  { to: "/mastery", labelKey: "nav.mastery", icon: GraduationCap, end: false, phone: false, part: "practise" },
  { to: "/languages", labelKey: "nav.languages", icon: Languages, end: false, phone: false, part: "practise" },
  { to: "/body", labelKey: "nav.body", icon: Dumbbell, end: false, phone: false, part: "practise" },
  { to: "/loop", labelKey: "nav.loop", icon: Repeat, end: false, phone: true, part: "reflect" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, end: false, phone: false, part: "home" },
] as const satisfies ReadonlyArray<{ part: PartId; [k: string]: unknown }>;

/**
 * The phone bar's last slot: a link to /more, a plain page listing every
 * destination. Ten destinations do not fit a 390px bar, and a drawer costs a
 * focus trap; a page keeps every destination two taps away at most.
 */
export const MORE_ITEM = { to: "/more", labelKey: "nav.more", icon: MoreHorizontal } as const;

/**
 * The tools are the book's appendix, not one of its parts: they sit after the
 * parts on the rail and beside More on the phone bar. `/tools` redirects to
 * the tools home in the visitor's language (routes/tools.ts). AnyProfile is
 * not on the rail: it is a browser for sellers, not part of studying, and it
 * stays on the tools site (owner's call, 2026-10-19).
 */
export const TOOLS_ITEM = { to: "/tools", labelKey: "tools:nav.tools", icon: Wrench } as const;

/** One rail row. The current row takes its part's tint and a full outline. */
const RAIL_ROW =
  "flex min-h-10 items-center gap-3 rounded-md border border-transparent px-3 text-sm transition-colors";

function railRowClass(isActive: boolean) {
  return cn(
    RAIL_ROW,
    isActive
      ? "border-part-line bg-part-soft font-semibold text-foreground [&_svg]:text-part"
      : "text-muted-foreground hover:bg-hover hover:text-foreground",
  );
}

/** One phone slot: icon over label. */
const PHONE_SLOT =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-2xs transition-colors";

function phoneSlotClass(isActive: boolean) {
  return cn(
    PHONE_SLOT,
    isActive ? "bg-part-soft font-semibold text-foreground [&_svg]:text-part" : "text-muted-foreground hover:bg-hover",
  );
}

type Item = (typeof NAV_ITEMS)[number];

function RailLink({ item }: { item: Item }) {
  const { t } = useTranslation("common");
  const { to, labelKey, icon: Icon, end } = item;
  return (
    <NavLink to={to} end={end} className={({ isActive }) => railRowClass(isActive)}>
      {({ isActive }) => (
        <>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{t(labelKey)}</span>
          {/* The current row is carried by tint, outline and weight; this makes
              it survive a colour-blind read and forced high-contrast mode. */}
          {isActive && <span className="sr-only">{t("nav.current")}</span>}
        </>
      )}
    </NavLink>
  );
}

/**
 * The rail from `lg` up: a textbook's table of contents. Today first, then the
 * four numbered parts, each under its coloured tab, then Settings, then the
 * tools appendix.
 */
function Rail() {
  const { t } = useTranslation("common");
  const front = NAV_ITEMS.filter((n) => n.part === "home");
  const today = front.filter((n) => n.to !== "/settings");
  const settings = front.filter((n) => n.to === "/settings");

  return (
    <div className="hidden h-full flex-col overflow-y-auto lg:flex">
      <div className="px-5 pt-6 pb-4">
        <Link to="/home" translate="no" className="font-serif text-2xl font-semibold tracking-display">
          {t("app.name")}
        </Link>
      </div>

      <ul className="flex flex-col gap-0.5 px-3">
        {today.map((item) => (
          <li key={item.to} data-part="home">
            <RailLink item={item} />
          </li>
        ))}
      </ul>

      {PARTS.map((part) => {
        const items = NAV_ITEMS.filter((n) => n.part === part.id);
        const headingId = `lp-rail-${part.id}`;
        return (
          // A group, not a region: five landmarks inside one nav is noise.
          <div key={part.id} role="group" data-part={part.id} aria-labelledby={headingId} className="mt-5 px-3">
            <h2 id={headingId} className="flex items-center gap-2 px-3 pb-1.5 font-sans text-xs font-semibold text-part">
              <span aria-hidden="true" className="lp-tab min-w-7 justify-center px-1.5">
                {part.numeral}
              </span>
              <span className="sr-only">{t("parts.part", { numeral: part.numeral })}: </span>
              {t(part.labelKey)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <RailLink item={item} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <ul className="mt-5 flex flex-col gap-0.5 border-t px-3 pt-3">
        {settings.map((item) => (
          <li key={item.to} data-part="home">
            <RailLink item={item} />
          </li>
        ))}
      </ul>

      <div role="group" data-part="tools" aria-labelledby="lp-rail-appendix" className="mt-auto px-3 pt-6 pb-5">
        <h2 id="lp-rail-appendix" className="px-3 pb-2 font-sans text-xs font-semibold text-part">
          {t("appendix.title")}
        </h2>
        <a href={TOOLS_ITEM.to} className={railRowClass(false)}>
          <TOOLS_ITEM.icon aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{t("appendix.all")}</span>
        </a>
      </div>
    </div>
  );
}

/**
 * Below `lg`, a bar along the bottom edge: the four destinations marked
 * `phone`, Tools, and More. Not a drawer behind a hamburger: a collapsed nav
 * is how a shell ends up looking empty on a phone.
 */
function PhoneBar() {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const moreActive =
    pathname === MORE_ITEM.to ||
    NAV_ITEMS.some((n) => !n.phone && (pathname === n.to || pathname.startsWith(n.to + "/")));

  return (
    <ul className="flex lg:hidden">
      {NAV_ITEMS.filter((n) => n.phone).map(({ to, labelKey, icon: Icon, end, part }) => (
        <li key={to} data-part={part} className="flex flex-1">
          <NavLink to={to} end={end} className={({ isActive }) => phoneSlotClass(isActive)}>
            {({ isActive }) => (
              <>
                <Icon aria-hidden="true" className="size-5" />
                <span className="truncate">{t(labelKey)}</span>
                {isActive && <span className="sr-only">{t("nav.current")}</span>}
              </>
            )}
          </NavLink>
        </li>
      ))}
      <li data-part="tools" className="flex flex-1">
        <a href={TOOLS_ITEM.to} className={phoneSlotClass(false)}>
          <TOOLS_ITEM.icon aria-hidden="true" className="size-5" />
          <span className="truncate">{t(TOOLS_ITEM.labelKey)}</span>
        </a>
      </li>
      <li data-part={partOf(pathname)} className="flex flex-1">
        <NavLink to={MORE_ITEM.to} className={phoneSlotClass(moreActive)}>
          <MORE_ITEM.icon aria-hidden="true" className="size-5" />
          <span className="truncate">{t(MORE_ITEM.labelKey)}</span>
          {moreActive && <span className="sr-only">{t("nav.current")}</span>}
        </NavLink>
      </li>
    </ul>
  );
}

export function Sidebar() {
  const { t } = useTranslation("common");
  return (
    <nav
      aria-label={t("nav.label")}
      className={cn(
        // Phone: a fixed bar along the bottom edge, above the home indicator.
        "fixed inset-x-0 bottom-0 z-sticky shrink-0 border-t bg-muted [padding-bottom:env(safe-area-inset-bottom)]",
        // Desktop: the rail, the second neutral layer of the page.
        "lg:static lg:h-full lg:w-(--lp-rail-w) lg:border-t-0 lg:border-r lg:[padding-bottom:0]",
      )}
    >
      <Rail />
      <PhoneBar />
    </nav>
  );
}
