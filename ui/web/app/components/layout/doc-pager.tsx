import { Link, useLocation, useMatches, type UIMatch } from "react-router";
import { useTranslation } from "react-i18next";
import { pagerOf } from "~/lib/nav-tree";

export type PagerLink = { to: string; label: string };
export type Pager = { prev?: PagerLink; next?: PagerLink };

/**
 * A route can set its own pager (a book chapter pages through its chapters):
 * `handle.pager` returns it from the route's match, or `false` drops the pager.
 */
export type PagerHandle = { pager?: false | ((match: UIMatch) => Pager | null) };

/**
 * Previous and next in the reading order: the route's own pager if it gives
 * one, else the neighbours in NAV_TREE (lib/nav-tree.ts). A detail page that
 * is not in the tree has none, as a page outside VitePress's sidebar has none.
 */
export function usePager(): Pager | null {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const matches = useMatches();
  for (const match of [...matches].reverse()) {
    const own = (match.handle as PagerHandle | undefined)?.pager;
    if (own === false) return null;
    if (typeof own === "function") return own(match);
  }
  const found = pagerOf(pathname);
  if (!found) return null;
  const link = (p?: { to: string; labelKey: string }) => (p ? { to: p.to, label: t(p.labelKey) } : undefined);
  return { prev: link(found.prev), next: link(found.next) };
}

const CARD =
  "flex h-full flex-col rounded-md border px-4 pt-[11px] pb-[13px] transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * VPDocFooter's prev-next: 64px under the page, a 1px rule, then two cards
 * (one column below 640) with "Previous page" / "Next page" in 12/20/500 ink-2
 * over the title in 14/20/500 brand; the next card aligned right.
 */
export function DocPager({ pager }: { pager: Pager | null }) {
  const { t } = useTranslation("common");
  if (!pager || (!pager.prev && !pager.next)) return null;
  return (
    <nav aria-label={t("shell.pager")} className="mt-16 grid gap-y-2 border-t pt-6 sm:grid-cols-2 sm:gap-x-4">
      {pager.prev ? (
        <Link to={pager.prev.to} rel="prev" className={CARD}>
          <span className="text-xs leading-5 font-medium text-muted-foreground">{t("shell.previous")}</span>
          <span className="text-sm leading-5 font-medium text-primary">{pager.prev.label}</span>
        </Link>
      ) : null}
      {pager.next ? (
        <Link to={pager.next.to} rel="next" className={`${CARD} text-right sm:col-start-2`}>
          <span className="text-xs leading-5 font-medium text-muted-foreground">{t("shell.next")}</span>
          <span className="text-sm leading-5 font-medium text-primary">{pager.next.label}</span>
        </Link>
      ) : null}
    </nav>
  );
}
