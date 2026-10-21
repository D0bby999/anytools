import { cn } from "~/lib/utils";

/**
 * The look of a page's own sections (Settings, Mastery), drawn like a
 * VitePress nav link (VPNavBarMenuLink): 14px at 500 in body ink, the action
 * ink on hover, and the current one only changes its colour to the action
 * ink. No fill and never an underline: a one-sided rule is refused by the
 * world (DESIGN.md). NavLink sets `aria-current="page"` on the current one,
 * so the state is not carried by colour alone.
 */
export function sectionTabClass({ isActive }: { isActive: boolean }) {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-[250ms]",
    isActive ? "text-primary" : "text-foreground hover:text-primary",
  );
}

/** The row the tabs sit in, under the page header. */
export const SECTION_TABS_ROW = "mb-8 flex flex-wrap gap-1 border-b pb-2";
