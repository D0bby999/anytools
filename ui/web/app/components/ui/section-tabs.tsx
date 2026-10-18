import { cn } from "~/lib/utils";

/**
 * The look of a page's own sections (Settings, Mastery): the current one is a
 * tinted tab with a full outline, the others are quiet text. Never an
 * underline: a one-sided rule is refused by the world (DESIGN.md).
 */
export function sectionTabClass({ isActive }: { isActive: boolean }) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors",
    isActive
      ? "border-primary-line bg-selected font-semibold text-selected-foreground"
      : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
  );
}

/** The row the tabs sit in, under the page header. */
export const SECTION_TABS_ROW = "mb-8 flex flex-wrap gap-1 border-b pb-2";
