/**
 * app-layout.tsx
 * The authenticated shell, in the structure of `up` (VitePress 1.6.4): the top
 * nav, the sidebar, the local nav below 1280, the article with its pager, and
 * the aside with "On this page".
 *
 * Its loader is the guard for every child route. A feature route nested here
 * inherits authentication rather than remembering to ask for it, so the failure
 * mode "new page forgot to check the session" is not reachable.
 *
 * Geometry (plan 261020-2246, phases 03 to 05, numbers from VitePress): nav
 * 64; from 960 the sidebar is a 272 column, below it a drawer opened from the
 * local nav's Menu; the article holds 688 beside an aside and 780 without one;
 * the aside (224, from 1280) holds the outline and the page's panel. The nav
 * and sidebar sit outside the one scroll region rather than fixed over it,
 * which places them where VitePress's fixed elements are.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useFetcher, useLocation, useMatches } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/app-layout";
import { requireUser } from "~/lib/auth.server";
import { apiFetch } from "~/lib/api.server";
import { isSupportedLng, loadLanguage, type SupportedLng } from "~/lib/i18n";
import { visitorLanguage } from "~/lib/language.server";
import { Sidebar } from "~/components/layout/sidebar";
import { TopNav } from "~/components/layout/top-nav";
import { LocalNav } from "~/components/layout/local-nav";
import { OutlineDropdown } from "~/components/layout/outline-dropdown";
import { useActiveEntry, useOutline } from "~/components/layout/outline";
import { DocAside } from "~/components/layout/doc-aside";
import { DocPager, usePager } from "~/components/layout/doc-pager";
import { PANEL_END_SLOT } from "~/components/layout/right-panel";
import { ReadingProgress } from "~/components/layout/reading-progress";
import { SearchModal } from "~/components/layout/search-modal";
import { partOf } from "~/lib/parts";
import { PWA_LINKS, useServiceWorker } from "~/lib/pwa";

/** AnyLearn is installable from any page of the study app (lib/pwa.ts). */
export const links: Route.LinksFunction = () => PWA_LINKS;

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  // The account's language. An account that never had one takes the
  // language its sign-in page was shown in (language.server.ts), once.
  let language: SupportedLng = isSupportedLng(user.language ?? "") ? (user.language as SupportedLng) : "en";
  if (!user.language_set) {
    language = await visitorLanguage(request);
    await apiFetch("/v1/me/language", user.id, { method: "PUT", body: { language, only_if_unset: true } }).catch(() => {
      // Not saved this time: the page is still in that language, and the
      // next page load tries again.
    });
  }
  await loadLanguage(language);
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
    // root.tsx picks the i18n instance and <html lang> from this.
    language,
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

/**
 * `layout: "page"`, VitePress's `layout: page`: a page that needs the whole
 * height and width (chat, solve, research, a mastery session) loses the
 * article measure and the pager, keeping the sidebar and, with `ownsPanel`,
 * the aside. Its content gets the padding the old shell gave every page, which
 * those pages' own negative margins are measured against.
 */
/**
 * `measure: "read"` keeps the 780 reading measure beside an aside: the
 * reader (documents/:docId) owns its tutor panel, but it is the one page that
 * is read for an hour, and up's 780 is the measure the plan keeps for reading.
 */
export type LayoutHandle = { layout?: "doc" | "page"; measure?: "read" };

/**
 * VitePress's has-aside: the article narrows to 688 when the aside carries
 * something of the page's own (its outline, from two headings, or its panel),
 * unless a route keeps the reading measure.
 */
export function narrowsBesideAside(handles: unknown[], showOutline: boolean): boolean {
  const own = handles.some((h) => (h as PanelHandle | undefined)?.ownsPanel);
  const read = handles.some((h) => (h as LayoutHandle | undefined)?.measure === "read");
  return (showOutline || own) && !read;
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const matches = useMatches();
  const ownsPanel = matches.some((m) => (m.handle as PanelHandle | undefined)?.ownsPanel);
  const pageLayout = matches.some((m) => (m.handle as LayoutHandle | undefined)?.layout === "page");
  // The textbook part this page belongs to (lib/parts.ts). Everything inside
  // takes its colour for wayfinding: a page's key-concept boxes, the reading
  // progress, the numeral tabs in the sidebar.
  const part = partOf(useLocation().pathname);
  const entries = useOutline();
  const active = useActiveEntry(entries);
  const pager = usePager();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const menuButton = useRef<HTMLButtonElement>(null);
  const showOutline = entries.length >= 2;
  const outline = showOutline ? entries : [];
  const narrowMeasure = narrowsBesideAside(
    matches.map((m) => m.handle),
    showOutline,
  );
  useReportTimezone(loaderData.timezoneSet);
  useServiceWorker();

  return (
    // relative, here and on the scroll region, is load-bearing. An absolute
    // element (every sr-only label) is placed against its nearest positioned
    // ancestor, and overflow clips it only if that ancestor is inside the
    // clipping box. With none, the labels of /home's four parts sat at their
    // place in the scrolled content, 1966px down, against <body>: the document
    // grew past the screen and scrolled the whole shell off it (2026-10-20).
    //
    // The arbitrary properties are the shell's two derived measures. From 1440
    // VitePress centres a 1480 layout and widens the sidebar to fill the left
    // margin: --lp-shell-rail is that width (never under 272, so 1440 itself
    // keeps 272 where VitePress would give 252), --lp-shell-gutter the
    // sidebar's left padding.
    <div
      data-part={part}
      className="relative flex h-dvh flex-col overflow-hidden [--lp-shell-gutter:2rem] [--lp-shell-rail:var(--lp-rail-w)] min-[1440px]:[--lp-shell-gutter:max(2rem,calc((100vw-var(--lp-layout-max)+64px)/2))] min-[1440px]:[--lp-shell-rail:max(var(--lp-rail-w),calc((100vw-var(--lp-layout-max)+64px)/2+var(--lp-rail-w)-2rem))]"
    >
      <ReadingProgress containerSelector="[data-lp-scroll]" />

      {/* First thing in the tab order, invisible until it has focus. Without
          it a keyboard user walks the whole nav on every page. */}
      <a
        href="#lp-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-toast focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        {t("actions.skipToContent")}
      </a>

      <TopNav displayName={loaderData.displayName} email={loaderData.email} />
      <LocalNav drawerOpen={drawerOpen} onMenu={() => setDrawerOpen((o) => !o)} menuRef={menuButton}>
        {pageLayout ? null : <OutlineDropdown entries={outline} active={active} />}
      </LocalNav>

      {/* min-h-0 is load-bearing, not decoration. A flex item defaults to
          min-height:auto along the main axis, so in the column direction this
          element refuses to shrink below its content: the scroll region inside
          it then grows past the viewport and the root's overflow-hidden clips
          the rest away (measured at 390px, 2026-10-20). */}
      <div className="flex min-h-0 flex-1">
        <Sidebar open={drawerOpen} onClose={closeDrawer} returnTo={menuButton} />

        {/* ONE scroll region, at every breakpoint: one tab stop for axe's
            scrollable-region-focusable, one thing for the progress hairline
            and the outline's scroll-spy to measure. The aside stays in view by
            sticking, not by owning its own overflow. Its scrollbar's room is
            kept on every page (scrollbar-gutter), or where scrollbars take
            space the centred column moves by half of one between a long page
            and a short one. */}
        <div data-lp-scroll tabIndex={0} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
          {pageLayout ? (
            <div className="flex flex-1 flex-col lg:flex-row">
              <main id="lp-main" className="flex min-w-0 flex-1 flex-col px-4 py-6 lg:px-8 lg:py-8">
                <Outlet />
                <div id={PANEL_END_SLOT} />
              </main>
              {ownsPanel ? <DocAside entries={[]} ownsPanel /> : null}
            </div>
          ) : (
            // After VPDoc, tightened (owner, 2026-10-21: the first screen
            // should hold the page, not its margins): 24 24 64 on a phone,
            // 32 32 64 from 768, 32 32 0 from 960 (the article's own 64
            // bottom takes over); from 1440 the right margin of a centred
            // 1480 layout.
            <div className="flex justify-center px-6 pt-6 pb-16 md:px-8 md:pt-8 md:pb-16 min-[960px]:pb-0 min-[1440px]:pr-[max(2rem,calc((100vw-var(--lp-layout-max))/2+2rem))]">
              <main id="lp-main" className="w-full min-w-0 min-[960px]:px-8 min-[960px]:pb-16 xl:min-w-[640px] xl:flex-1">
                <div
                  data-lp-content
                  className={narrowMeasure ? "mx-auto max-w-(--lp-measure-read) xl:max-w-(--lp-measure-aside)" : "mx-auto max-w-(--lp-measure-read)"}
                >
                  <Outlet />
                  <div id={PANEL_END_SLOT} />
                  <DocPager pager={pager} />
                </div>
              </main>
              <DocAside entries={outline} active={active} ownsPanel={ownsPanel} />
            </div>
          )}
        </div>
      </div>

      <SearchModal />
    </div>
  );
}
