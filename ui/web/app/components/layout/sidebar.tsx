import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Backdrop, useDrawer } from "~/components/layout/drawer";
import { NAV_TREE, sectionOf, TOP_NAV, type NavGroup, type NavPage } from "~/lib/nav-tree";
import { PARTS, partOf, type PartId } from "~/lib/parts";
import { cn } from "~/lib/utils";

/**
 * The sidebar's rows as the flat list the rail used to export, kept for the
 * pages that still read it (Today's parts list, a few tests). The tree in
 * lib/nav-tree.ts is the source; this is a view of its top-level pages.
 */
export const NAV_ITEMS: { to: string; labelKey: string; end: boolean; phone: boolean; part: PartId }[] = NAV_TREE.flatMap(
  (g) => g.items,
)
  .filter((p) => !p.external && (p.to === "/settings" || !p.to.startsWith("/settings/")) && p.to !== "/toolkit")
  .map((p) => ({
    to: p.to,
    labelKey: p.to === "/settings" ? "nav.settings" : p.labelKey,
    end: !!p.end && p.to === "/home",
    phone: TOP_NAV.some((n) => n.to === p.to),
    part: partOf(p.to),
  }));

/** /more, the page listing every destination (routes/more.tsx). */
export const MORE_ITEM = { to: "/more", labelKey: "nav.more" } as const;

/** The tools appendix; `/tools` redirects to the tools home (routes/tools.ts). */
export const TOOLS_ITEM = { to: "/tools", labelKey: "tools:nav.tools" } as const;

/** True when `page` or one of its children is the current entry. */
function contains(page: NavPage, current: string | undefined): boolean {
  return !!current && (page.to === current || !!page.items?.some((c) => contains(c, current)));
}

/**
 * Open/closed state of every foldable group and item, VitePress's rules: a
 * folded one opens when the page it holds becomes current; otherwise what
 * the learner chose stays, for this visit only.
 */
function useFolds(current: string | undefined) {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!current) return;
    const open: Record<string, boolean> = {};
    for (const group of NAV_TREE) {
      if (group.items.some((p) => contains(p, current))) open[group.id] = true;
      for (const page of group.items) if (page.items && contains(page, current)) open[page.to] = true;
    }
    setChosen((c) => ({ ...c, ...open }));
  }, [current]);

  function isOpen(key: string, collapsed: boolean | undefined, holdsCurrent: boolean) {
    if (collapsed === undefined) return true;
    return chosen[key] ?? (!collapsed || holdsCurrent);
  }
  const toggle = (key: string, now: boolean) => setChosen((c) => ({ ...c, [key]: !now }));
  return { isOpen, toggle };
}

/*
 * One row shape for every page and for the folded groups' titles: 30 high,
 * a 16px icon, a rounded hover, and the current row filled in navy tint on
 * all four sides (never a one-sided bar). Owner, 2026-10-21: the VitePress
 * rows (32 high, no icons, groups split by rules) read as sparse.
 */
const ROW =
  "-mx-2 flex min-h-[30px] items-center gap-2.5 rounded-md px-2 py-[5px] text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const ROW_IDLE = "text-foreground hover:bg-hover";
const ROW_CURRENT = "bg-selected font-semibold text-selected-foreground";
const ICON = "size-4 shrink-0";
const CARET = "size-4 transition-transform duration-200 motion-reduce:transition-none";

function PageLink({ page, current, hasActive, nested }: { page: NavPage; current?: string; hasActive?: boolean; nested?: boolean }) {
  const { t } = useTranslation("common");
  const active = page.to === current;
  const Icon = page.icon;
  const className = cn(
    ROW,
    "min-w-0 flex-1 font-medium",
    active ? ROW_CURRENT : ROW_IDLE,
    // A child row sits on the guide line; it is a step quieter than its parent.
    nested && !active && "text-muted-foreground hover:text-foreground",
    hasActive && "font-semibold",
  );
  const label = (
    <>
      {Icon ? <Icon aria-hidden="true" className={cn(ICON, active ? "text-selected-foreground" : "text-deco")} /> : null}
      <span className="min-w-0 truncate">{t(page.labelKey)}</span>
      {active ? <span className="sr-only"> {t("nav.current")}</span> : null}
    </>
  );
  if (page.external) {
    return (
      <a href={page.to} className={className}>
        {label}
      </a>
    );
  }
  return (
    <Link to={page.to} aria-current={active ? "page" : undefined} className={className}>
      {label}
    </Link>
  );
}

function Caret({ open }: { open: boolean }) {
  return <ChevronRight aria-hidden="true" className={cn(CARET, open && "rotate-90")} />;
}

function Item({ page, current, folds }: { page: NavPage; current?: string; folds: ReturnType<typeof useFolds> }) {
  const { t } = useTranslation("common");
  const childrenId = useId();
  const hasActive = !!page.items && contains(page, current) && page.to !== current;
  if (!page.items) return <PageLink page={page} current={current} />;
  const open = folds.isOpen(page.to, page.collapsed, contains(page, current));
  return (
    <div>
      <div className="flex items-center gap-1">
        <PageLink page={page} current={current} hasActive={hasActive} />
        {page.collapsed !== undefined ? (
          // A link that also folds: the text goes to the page, the caret
          // folds (VitePress's VPSidebarItem with a link and children).
          <button
            type="button"
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={t("nav.toggleSection", { section: t(page.labelKey) })}
            onClick={() => folds.toggle(page.to, open)}
            className="-mr-2 flex size-[30px] shrink-0 items-center justify-center rounded-md text-deco transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Caret open={open} />
          </button>
        ) : null}
      </div>
      {/* The guide line runs under the parent's icon; a neutral tree rule, not an accent. */}
      <ul id={childrenId} hidden={!open} className="my-0.5 ml-[7px] border-l pl-[11px]">
        {page.items.map((child) => (
          <li key={child.to}>
            <PageLink page={child} current={current} nested />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Group({ group, current, folds }: { group: NavGroup; current?: string; folds: ReturnType<typeof useFolds> }) {
  const { t } = useTranslation("common");
  const headingId = useId();
  const itemsId = useId();
  const holdsCurrent = group.items.some((p) => contains(p, current));
  const open = folds.isOpen(group.id, group.collapsed, holdsCurrent);
  const foldable = group.collapsed !== undefined;
  // Parts I to IV: a quiet caption with the part's numeral tab, so the pages
  // under it, not the part's name, carry the weight (DESIGN.md, sidebar).
  const part = PARTS.find((p) => p.id === group.id);
  const GroupIcon = group.icon;
  const items = (
    <ul id={itemsId} hidden={!open} className={cn(GroupIcon && "my-0.5 ml-[7px] border-l pl-[11px]")}>
      {group.items.map((page) => (
        <li key={page.to}>
          <Item page={page} current={current} folds={folds} />
        </li>
      ))}
    </ul>
  );
  return (
    // A group, not a landmark (DESIGN.md): a labelled <section> is a region,
    // and the page often has a region with the same name (Today's guide paths,
    // /more), which axe flags as landmark-unique.
    <div
      role="group"
      data-part={part?.id}
      data-group={group.id}
      aria-labelledby={group.untitled ? undefined : headingId}
      aria-label={group.untitled ? t(group.labelKey) : undefined}
      className={cn(
        "min-[960px]:w-[calc(var(--lp-rail-w)-64px)]",
        part && "mt-5",
        group.id === "appendix" && "mt-5",
      )}
    >
      {group.untitled ? null : part ? (
        <h2 id={headingId} className="mb-1 flex items-center gap-2 font-sans text-xs leading-5 font-semibold text-muted-foreground">
          <span aria-hidden="true" className="lp-tab h-[18px] min-w-6 justify-center px-1 text-[11px] leading-none">
            {part.numeral}
          </span>
          <span>
            <span className="sr-only">{t("parts.part", { numeral: part.numeral })}:</span> {t(part.labelKey)}
          </span>
        </h2>
      ) : (
        <h2 id={headingId} className="font-sans text-sm leading-5 font-medium">
          {foldable ? (
            // The whole row toggles, as up's patch makes it; a real button, so
            // Enter and Space work without a key handler.
            <button type="button" aria-expanded={open} aria-controls={itemsId} onClick={() => folds.toggle(group.id, open)} className={cn(ROW, ROW_IDLE, "w-[calc(100%+16px)] text-left")}>
              {GroupIcon ? <GroupIcon aria-hidden="true" className={cn(ICON, "text-deco")} /> : null}
              <span className="flex-1">{t(group.labelKey)}</span>
              <span className="text-deco">
                <Caret open={open} />
              </span>
            </button>
          ) : (
            <span className="block py-1">{t(group.labelKey)}</span>
          )}
        </h2>
      )}
      {items}
    </div>
  );
}

/**
 * The sidebar, after VitePress's VPSidebar: the whole NAV_TREE, as compact
 * icon rows under the parts' captions, the current row filled in navy tint.
 *
 * From 960 it is a column 272 wide on the alt surface, scrolling on its own
 * (from 1440 it widens to fill the left margin of a 1480 layout, never below
 * 272). Below 960 the same element is the drawer: fixed at the left,
 * `min(100vw - 64px, 320px)` wide, hidden (and so out of the tab order)
 * until the local nav's Menu opens it.
 */
export function Sidebar({
  open = false,
  onClose = () => {},
  returnTo,
}: {
  open?: boolean;
  onClose?: () => void;
  returnTo?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const current = sectionOf(pathname)?.page.to;
  const folds = useFolds(current);
  const layer = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const { narrow } = useDrawer({ open, onClose, layer, initial: nav, returnTo });

  // Bring the current row into view once, inside the sidebar's own scroll
  // (scrollIntoView would also scroll the page behind it).
  useEffect(() => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !row || el.scrollHeight <= el.clientHeight) return;
    el.scrollTop = row.offsetTop - el.clientHeight / 2;
  }, []);

  return (
    <div ref={layer} className="contents">
      <Backdrop show={open} onClick={onClose} />
      <aside
        id="lp-sidebar"
        // Closed below 960: out of the tab order and the accessibility tree.
        inert={narrow && !open ? true : undefined}
        className={cn(
          "fixed top-0 bottom-0 left-0 z-(--lp-z-sidebar) flex w-[min(calc(100vw-64px),320px)] flex-col overflow-hidden bg-muted shadow-md",
          "transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-opacity",
          open ? "visible translate-x-0 opacity-100" : "invisible -translate-x-full opacity-0",
          "min-[960px]:visible min-[960px]:static min-[960px]:z-auto min-[960px]:w-(--lp-shell-rail) min-[960px]:shrink-0 min-[960px]:translate-x-0 min-[960px]:opacity-100 min-[960px]:shadow-none min-[960px]:transition-none",
        )}
      >
        <nav ref={nav} tabIndex={-1} aria-labelledby="lp-sidebar-title" className="flex min-h-0 flex-1 flex-col outline-none">
          <span id="lp-sidebar-title" className="sr-only">
            {t("nav.sidebarNavigation")}
          </span>
          {/* The book scrolls; Settings stays at the foot (owner, 2026-10-21),
              where an app's settings are looked for. The scrollbar shows while
              the pointer is over the list. */}
          <div
            ref={scroller}
            className="lp-scroll-quiet relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-6 pt-6 pb-6 min-[960px]:pt-3 min-[960px]:pl-(--lp-shell-gutter)"
          >
            {NAV_TREE.filter((g) => g.id !== "settings").map((group) => (
              <Group key={group.id} group={group} current={current} folds={folds} />
            ))}
          </div>
          <div className="lp-scroll-quiet max-h-[50%] shrink-0 overflow-y-auto border-t px-6 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] min-[960px]:pl-(--lp-shell-gutter)">
            {NAV_TREE.filter((g) => g.id === "settings").map((group) => (
              <Group key={group.id} group={group} current={current} folds={folds} />
            ))}
          </div>
        </nav>
      </aside>
    </div>
  );
}
