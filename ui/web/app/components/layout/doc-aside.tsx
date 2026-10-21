import { Outline, type OutlineEntry } from "~/components/layout/outline";
import { PANEL_ASIDE_SLOT, RightPanel } from "~/components/layout/right-panel";

/**
 * The aside column from 1280, VPDocAside: 256 wide with 32 of it as the gap,
 * its 224px content sticking under the nav and scrolling on its own with no
 * scrollbar, a 32px curtain fading the bottom edge into the page. On top
 * "On this page"; under it the page's own panel (`ownsPanel`, which portals
 * into the slot) or the margin note of the part the page is in.
 */
export function DocAside({
  entries,
  active,
  ownsPanel,
}: {
  entries: OutlineEntry[];
  active?: string;
  ownsPanel: boolean;
}) {
  return (
    // -mt-8 cancels the 32 top padding the column sits in: the sticky
    // container below carries that 32 itself, so the outline title lines up
    // with the h1 at rest (y = 96) and stays 32 below the nav when scrolled.
    <div className="relative -mt-8 hidden w-64 shrink-0 pl-8 xl:block">
      <div className="sticky top-0 flex max-h-[calc(100dvh-var(--lp-topbar-h))] w-(--lp-aside-w) flex-col overflow-x-hidden overflow-y-auto pt-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col pb-8">
          <Outline entries={entries} active={active} />
          <div id={PANEL_ASIDE_SLOT} className={entries.length > 0 ? "mt-8" : undefined}>
            {ownsPanel ? null : <RightPanel inline />}
          </div>
        </div>
        <div aria-hidden="true" className="pointer-events-none sticky bottom-0 mt-auto h-8 w-(--lp-aside-w) shrink-0 bg-linear-to-b from-transparent to-background to-70%" />
      </div>
    </div>
  );
}
