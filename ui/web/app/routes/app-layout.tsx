/**
 * app-layout.tsx
 * The authenticated shell: sidebar, topbar, main, right activity panel.
 *
 * Its loader is the guard for every child route. A feature route nested here
 * inherits authentication rather than remembering to ask for it, so the failure
 * mode "new page forgot to check the session" is not reachable.
 *
 * Geometry (ui/web/DESIGN.md): rail, workspace, activity panel. From `lg` up
 * those are three columns and the workspace scrolls on its own; below `lg` the
 * rail becomes a bottom bar and the workspace and panel share one scroll, in
 * that order, which is also their DOM order.
 */
import { useEffect } from "react";
import { Outlet, useFetcher, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/app-layout";
import { requireUser } from "~/lib/auth.server";
import { Sidebar } from "~/components/layout/sidebar";
import { Topbar } from "~/components/layout/topbar";
import { RightPanel } from "~/components/layout/right-panel";
import { ReadingProgress } from "~/components/layout/reading-progress";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  // Only what the shell renders: the API's user shape may grow, and leaking
  // extra fields into the client bundle is how internal data ends up in a page
  // source view.
  return {
    displayName: user.display_name,
    email: user.email,
    timezoneSet: user.timezone_set,
    // "Save to my Drive" beside each export shows only with Drive storage on
    // (drive-user-storage phase 2); see useFileStorage.
    fileStorage: user.file_storage === "drive" ? ("drive" as const) : ("server" as const),
  };
}

/**
 * Reports the browser's time zone once, while the account has none. The API
 * keeps a zone the learner chose in Settings (only_if_unset).
 */
function useReportTimezone(timezoneSet: boolean) {
  const fetcher = useFetcher();
  const { submit } = fetcher;
  useEffect(() => {
    if (timezoneSet) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) void submit({ timezone }, { method: "post", action: "/app/api/timezone" });
  }, [timezoneSet, submit]);
}

/**
 * A route that renders its own RightPanel (chat's sources, the reader's tutor)
 * exports `handle = { ownsPanel: true }`, and this layout then leaves the slot
 * to it. Without this every such page drew two panels, with two elements
 * carrying the panel heading's id.
 */
export type PanelHandle = { ownsPanel?: boolean };

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const ownsPanel = useMatches().some((m) => (m.handle as PanelHandle | undefined)?.ownsPanel);
  useReportTimezone(loaderData.timezoneSet);

  return (
    <div className="flex h-dvh flex-col overflow-hidden lg:flex-row">
      <ReadingProgress containerSelector="[data-lp-scroll]" />

      {/* First thing in the tab order, invisible until it has focus. Without
          it a keyboard user walks the whole nav on every page. */}
      <a
        href="#lp-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-toast focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {t("actions.skipToContent")}
      </a>

      <Sidebar />

      {/* min-h-0 is load-bearing, not decoration. A flex item defaults to
          min-height:auto along the main axis, so in the column direction this
          element refuses to shrink below its content: the scroll region inside
          it then grows past the viewport and the root's overflow-hidden clips
          the rest away. Measured at 390px before the fix: the scroll container
          reported scrollHeight 1379 and clientHeight 1379, meaning nothing
          below the first screen could be reached at all. Desktop hid the bug,
          because in the row direction it is min-width that applies. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar displayName={loaderData.displayName} email={loaderData.email} />

        {/* ONE scroll region, at every breakpoint. The workspace and the panel
            used to scroll separately from `lg` up, which meant the element
            that scrolls changed with the viewport: axe then flagged the mobile
            one as a scrollable region no keyboard user could reach
            (scrollable-region-focusable, serious), and fixing that would have
            put a tab stop on whichever element happened not to be scrolling.
            With a single region there is one tab stop, one thing for the
            progress hairline to measure, and the panel stays in view by
            sticking rather than by owning its own overflow. */}
        <div
          data-lp-scroll
          tabIndex={0}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row"
        >
          <main
            id="lp-main"
            // The bottom padding clears the mobile nav bar, which is fixed and
            // therefore out of flow: without it the last line of every page
            // sits underneath the bar.
            className="min-w-0 flex-1 px-4 py-6 [padding-bottom:calc(5rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-8"
          >
            <Outlet />
          </main>

          {ownsPanel ? null : <RightPanel />}
        </div>
      </div>
    </div>
  );
}
