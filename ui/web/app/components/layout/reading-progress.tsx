import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/**
 * The hairline across the top edge that says how far through a long page you
 * are. Ported from `up`'s `ReadingProgress.vue` (MIT, see
 * the private design notes) and
 * rewritten for React: 2px, fixed at the top above everything, in the
 * `progress` colour, scaled on the next frame with an 80ms linear ease.
 *
 * Like `up`, it measures the article (`[data-lp-content]`, VitePress's
 * .content-container) rather than the whole page, and shows only when there
 * are more than 160px of it to travel. One change, forced by the shell: the
 * app scrolls inside `[data-lp-scroll]`, not the window, so the distances are
 * taken against that region.
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
  const { pathname } = useLocation();

  useEffect(() => {
    setProgress(0);
    const scroller = document.querySelector<HTMLElement>(containerSelector);
    const content = document.querySelector<HTMLElement>("[data-lp-content]");

    function measure() {
      frame.current = undefined;
      if (!scroller || !content) {
        setActive(false);
        setProgress(0);
        return;
      }
      const contentTop = scroller.scrollTop + content.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const start = Math.max(0, contentTop);
      const end = contentTop + content.scrollHeight - scroller.clientHeight;
      const distance = end - start;
      setActive(distance > MIN_DISTANCE);
      setProgress(distance > 0 ? Math.min(1, Math.max(0, (scroller.scrollTop - start) / distance)) : 1);
    }

    function schedule() {
      if (frame.current === undefined) frame.current = window.requestAnimationFrame(measure);
    }

    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    if (content) observer?.observe(content);
    schedule();

    return () => {
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
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
  }, [containerSelector, pathname]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      data-reading-progress
      data-progress={(progress * 100).toFixed(1)}
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      <span
        className="block h-full w-full origin-left bg-[var(--lp-progress)] transition-transform duration-80 ease-linear motion-reduce:transition-none"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
