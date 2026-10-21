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

const LINK = "block py-1 text-sm leading-6 font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function PageLink({ page, current, hasActive, nested }: { page: NavPage; current?: string; hasActive?: boolean; nested?: boolean }) {
  const { t } = useTranslation("common");
  const active = page.to === current;
  const className = cn(LINK, active ? "text-primary" : hasActive ? "text-foreground" : "text-muted-foreground");
  const label = (
    <>
      {/* VitePress marks a current child with a 2px bar on the guide line; a
          one-sided accent is against this project's rules, so a 6px dot sits
          on the line instead (plan decision 4). */}
      {active && nested ? (
        <span aria-hidden="true" className="absolute top-1/2 -left-[19.5px] size-1.5 -translate-y-1/2 rounded-full bg-primary" />
      ) : null}
      {t(page.labelKey)}
      {active ? <span className="sr-only"> {t("nav.current")}</span> : null}
    </>
  );
  if (page.external) {
    return (
      <a href={page.to} className={cn(className, "relative")}>
        {label}
      </a>
    );
  }
  return (
    <Link to={page.to} aria-current={active ? "page" : undefined} className={cn(className, "relative")}>
      {label}
    </Link>
  );
}

function Item({ page, current, folds }: { page: NavPage; current?: string; folds: ReturnType<typeof useFolds> }) {
  const { t } = useTranslation("common");
  const childrenId = useId();
  const hasActive = !!page.items && contains(page, current) && page.to !== current;
  if (!page.items) return <PageLink page={page} current={current} />;
  const open = folds.isOpen(page.to, page.collapsed, contains(page, current));
  return (
    <div>
      <div className="flex items-center justify-between">
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
            className="-mr-[7px] flex size-8 shrink-0 items-center justify-center text-faint transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronRight aria-hidden="true" className={cn("size-[18px] transition-transform duration-250 motion-reduce:transition-none", open && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {/* The guide line is a neutral tree rule, not an accent. */}
      <ul id={childrenId} hidden={!open} className="border-l pl-4">
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
  // Parts I to IV carry their numeral tab before the name, like the edge tab
  // of a textbook's chapter; the colour is wayfinding only (DESIGN.md).
  const part = PARTS.find((p) => p.id === group.id);
  const label = part ? (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="lp-tab min-w-7 justify-center px-1.5">
        {part.numeral}
      </span>
      <span>
        <span className="sr-only">{t("parts.part", { numeral: part.numeral })}:</span>{" "}
        {t(part.labelKey)}
      </span>
    </span>
  ) : (
    t(group.labelKey)
  );
  return (
    // A group, not a landmark (DESIGN.md): a labelled <section> is a region,
    // and the page often has a region with the same name (Today's guide paths,
    // /more), which axe flags as landmark-unique.
    <div
      role="group"
      data-part={part?.id}
      aria-labelledby={headingId}
      className={cn("[&+&]:border-t [&+&]:pt-2.5 min-[960px]:w-[calc(var(--lp-rail-w)-64px)]", open ? "pb-6" : "pb-2.5")}
    >
      <h2 id={headingId} className="font-sans text-sm leading-6 font-bold text-foreground">
        {foldable ? (
          // The whole title row toggles, as up's patch makes it; a real
          // button, so Enter and Space work without a key handler.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={itemsId}
            onClick={() => folds.toggle(group.id, open)}
            className="group flex w-full items-center justify-between py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {label}
            <span aria-hidden="true" className="-mr-[7px] flex size-8 items-center justify-center text-faint group-hover:text-muted-foreground">
              <ChevronRight className={cn("size-[18px] transition-transform duration-250 motion-reduce:transition-none", open && "rotate-90")} />
            </span>
          </button>
        ) : (
          <span className="block py-1">{label}</span>
        )}
      </h2>
      <ul id={itemsId} hidden={!open}>
        {group.items.map((page) => (
          <li key={page.to}>
            <Item page={page} current={current} folds={folds} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The sidebar, VitePress's VPSidebar: the whole NAV_TREE, groups titled
 * 14/700, pages 14/500 in ink-2, the current one in brand, no icons.
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
  const aside = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const { narrow } = useDrawer({ open, onClose, layer, initial: nav, returnTo });

  // Bring the current row into view once, inside the sidebar's own scroll
  // (scrollIntoView would also scroll the page behind it).
  useEffect(() => {
    const el = aside.current;
    const row = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !row || el.scrollHeight <= el.clientHeight) return;
    el.scrollTop = row.offsetTop - el.clientHeight / 2;
  }, []);

  return (
    <div ref={layer} className="contents">
      <Backdrop show={open} onClick={onClose} />
      <aside
        ref={aside}
        id="lp-sidebar"
        // Closed below 960: out of the tab order and the accessibility tree.
        inert={narrow && !open ? true : undefined}
        className={cn(
          "fixed top-0 bottom-0 left-0 z-(--lp-z-sidebar) w-[min(calc(100vw-64px),320px)] overflow-x-hidden overflow-y-auto overscroll-contain bg-muted px-8 pt-8 pb-24 shadow-md",
          "transition-[opacity,translate] duration-500 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-opacity",
          open ? "visible translate-x-0 opacity-100" : "invisible -translate-x-full opacity-0",
          "min-[960px]:visible min-[960px]:static min-[960px]:z-auto min-[960px]:w-(--lp-shell-rail) min-[960px]:shrink-0 min-[960px]:translate-x-0 min-[960px]:pt-0 min-[960px]:pl-(--lp-shell-gutter) min-[960px]:opacity-100 min-[960px]:shadow-none min-[960px]:transition-none",
        )}
      >
        <nav ref={nav} tabIndex={-1} aria-labelledby="lp-sidebar-title" className="outline-none">
          <span id="lp-sidebar-title" className="sr-only">
            {t("nav.sidebarNavigation")}
          </span>
          {NAV_TREE.map((group) => (
            <Group key={group.id} group={group} current={current} folds={folds} />
          ))}
        </nav>
      </aside>
    </div>
  );
}
