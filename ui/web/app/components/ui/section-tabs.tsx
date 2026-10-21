import { cn } from "~/lib/utils";

/**
 * The look of a page's own sections (Settings, Mastery, Quiz, Body,
 * Languages): tabs drawn like the sidebar's rows, so the two read as one
 * system. Each is 36 high and rounded; the current one is filled in the
 * selected tint on all four sides (never a one-sided rule, DESIGN.md), the
 * others are body ink with a hover fill. NavLink sets `aria-current="page"`
 * on the current one, so the state is not carried by colour alone.
 * Owner, 2026-10-21: plain coloured text did not read as tabs.
 */
export function sectionTabClass({ isActive }: { isActive: boolean }) {
  return cn(
    "inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm transition-colors",
    isActive ? "bg-selected font-semibold text-selected-foreground" : "font-medium text-muted-foreground hover:bg-hover hover:text-foreground",
  );
}

/** The row the tabs sit in, under the page header; a neutral rule closes it. */
export const SECTION_TABS_ROW = "lp-tabs-row mb-6 flex flex-wrap gap-1 border-b pb-2";
