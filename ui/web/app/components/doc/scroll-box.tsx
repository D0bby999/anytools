/**
 * scroll-box.tsx
 * The box a wide table scrolls in (VitePress lets a table scroll inside
 * itself, never the page).
 *
 * Two things every such box needs, kept here so the ten tables that use one
 * cannot drift apart:
 * - It is a tab stop only while it overflows. A keyboard user has to be able
 *   to scroll it (axe: scrollable-region-focusable), but a table that fits
 *   should not add a stop that does nothing.
 * - It is positioned (`.lp-field-table-scroll` sets `position: relative`), so
 *   the sr-only labels inside its cells, which are absolute, are clipped by it
 *   instead of escaping to the page and widening it on a phone.
 */
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/**
 * A tab stop while the element scrolls sideways, none while it fits. For an
 * element that is its own scroll box (an `.lp-table`, which VitePress-style
 * scrolls inside itself) as well as for ScrollBox.
 */
export function useOverflowTabStop<T extends HTMLElement>(): [(el: T | null) => void, 0 | undefined] {
  // A callback ref, so a table drawn only after its data arrives is measured
  // when it appears, not missed by an effect that ran on mount.
  const [el, setEl] = useState<T | null>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    // jsdom has no ResizeObserver; there nothing ever overflows.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [el]);

  return [setEl, overflows ? 0 : undefined];
}

export function ScrollBox({ children, className }: { children: ReactNode; className?: string }) {
  const [box, tabIndex] = useOverflowTabStop<HTMLDivElement>();

  return (
    <div ref={box} tabIndex={tabIndex} className={cn("lp-field-table-scroll", className)}>
      {children}
    </div>
  );
}
