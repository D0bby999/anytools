import { useEffect, useRef, useState } from "react";

/**
 * The hairline across the top edge that says how far through a long page you
 * are. Ported from `up`'s `ReadingProgress.vue` (MIT, see
 * plans/.../reports/design-ref-up/LICENSE-CODE.md) and rewritten for React.
 *
 * Two changes from the original, both forced by this app rather than by taste:
 *
 * 1. `up` measures window scroll. AnyTools' shell scrolls INSIDE the layout,
 *    and which element scrolls depends on the viewport: the workspace has its
 *    own scroll region from `lg` up, while below that the whole content column
 *    scrolls as one. Rather than encode a breakpoint here and have it drift
 *    from the CSS, the component measures every candidate on each frame and
 *    uses whichever one is actually scrollable.
 * 2. It hides itself unless there is a meaningful distance to travel (the same
 *    160px floor `up` uses), so a short Operate page does not get a progress
 *    bar for two screenfuls of nothing.
 *
 * Marked aria-hidden: the position is already conveyed by the scrollbar and by
 * the content itself, and announcing a value that changes on every frame is
 * noise, not information.
 */
const MIN_DISTANCE = 160;

export function ReadingProgress({ containerSelector }: { containerSelector: string }) {
  const [progress, setProgress] = useState(0);
  const [active, setActive] = useState(false);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    function measure() {
      frame.current = undefined;

      // Every element carrying the marker, then the document scroller as the
      // fallback for a page that scrolls normally. The first one that is
      // genuinely scrollable wins, which is how this stays correct across a
      // breakpoint that moves the overflow from one element to another.
      const candidates: Array<HTMLElement | null> = [
        ...document.querySelectorAll<HTMLElement>(containerSelector),
        document.scrollingElement as HTMLElement | null,
      ];
      const scroller = candidates.find(
        (el): el is HTMLElement => !!el && el.scrollHeight - el.clientHeight > MIN_DISTANCE,
      );

      if (!scroller) {
        setActive(false);
        setProgress(0);
        return;
      }

      const distance = scroller.scrollHeight - scroller.clientHeight;
      setActive(true);
      setProgress(Math.min(1, Math.max(0, scroller.scrollTop / distance)));
    }

    function schedule() {
      if (frame.current === undefined) frame.current = window.requestAnimationFrame(measure);
    }

    // Scroll events do not bubble, but they do capture, so one listener on the
    // document catches whichever element is doing the scrolling.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);

    const observer = new ResizeObserver(schedule);
    for (const el of document.querySelectorAll<HTMLElement>(containerSelector)) observer.observe(el);

    schedule();

    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (frame.current !== undefined) {
        window.cancelAnimationFrame(frame.current);
        // Clearing the handle is what makes the next schedule() work. Without
        // it, StrictMode's mount-unmount-remount leaves a stale frame id here,
        // every later schedule() sees a pending frame that was already
        // cancelled, and the bar never measures again. Measured: the track
        // element was absent on a page with 802px of scroll.
        frame.current = undefined;
      }
    };
  }, [containerSelector]);

  if (!active) return null;

  return (
    <div className="lp-progress-track" aria-hidden="true" data-reading-progress>
      <span className="lp-progress-value" style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}
