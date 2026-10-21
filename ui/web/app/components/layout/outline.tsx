import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

export type OutlineEntry = { id: string; text: string; level: 2 | 3 };

/**
 * A heading's id from its text: lower case, Vietnamese and other accents
 * dropped (NFD), đ as d, anything else a hyphen. Stable across renders, so a
 * `#link` to a section keeps working.
 */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** The outline is read from these; a heading opts out with data-outline-ignore. */
const HEADINGS = "h2, h3";

/**
 * Reads the page's h2 and h3 from `#lp-main` (VitePress's outline: [2, 3]),
 * giving each one without an id an id from its text. Not the headings of a
 * panel (`aside`), which is furniture rather than the page. Re-reads on
 * navigation and whenever the page's content changes (data arriving, a
 * section opening), on the next frame.
 */
export function useOutline(): OutlineEntry[] {
  const { pathname } = useLocation();
  const [entries, setEntries] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    const main = document.getElementById("lp-main");
    if (!main) return;
    let frame: number | undefined;

    function read() {
      frame = undefined;
      const seen = new Set<string>();
      const next: OutlineEntry[] = [];
      for (const el of main!.querySelectorAll<HTMLElement>(HEADINGS)) {
        if (el.closest("[data-outline-ignore], aside, [hidden], dialog")) continue;
        const text = (el.textContent ?? "").trim();
        if (!text) continue;
        if (!el.id) {
          let id = slugify(text);
          for (let n = 2; document.getElementById(id) && document.getElementById(id) !== el; n++) id = `${slugify(text)}-${n}`;
          el.id = id;
        }
        if (seen.has(el.id)) continue;
        seen.add(el.id);
        next.push({ id: el.id, text, level: el.tagName === "H3" ? 3 : 2 });
      }
      setEntries((prev) =>
        prev.length === next.length && prev.every((e, i) => e.id === next[i]!.id && e.text === next[i]!.text) ? prev : next,
      );
    }
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(read);
    };
    read();
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  return entries;
}

/**
 * The entry being read: the last heading whose top has passed the top of the
 * scroll region (plus the doc's 48px top padding), or the last one once the
 * region is scrolled to its end. VitePress's useActiveAnchor, measured
 * against this app's scroll region rather than the window.
 */
export function useActiveEntry(entries: OutlineEntry[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>("[data-lp-scroll]");
    if (!scroller || entries.length === 0) {
      setActive(undefined);
      return;
    }
    let frame: number | undefined;
    function measure() {
      frame = undefined;
      const top = scroller!.getBoundingClientRect().top + 48 + 1;
      const atEnd = Math.abs(scroller!.scrollTop + scroller!.clientHeight - scroller!.scrollHeight) < 1;
      if (atEnd && scroller!.scrollTop > 0) {
        setActive(entries[entries.length - 1]!.id);
        return;
      }
      let current: string | undefined;
      for (const entry of entries) {
        const el = document.getElementById(entry.id);
        if (el && el.getBoundingClientRect().top <= top) current = entry.id;
      }
      setActive(current);
    }
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [entries]);
  return active;
}

/**
 * The outline's links, VPDocOutlineItem: 14/32/400 in ink-2 on one line with
 * an ellipsis, h3 indented 13px, the one being read in ink. Along a neutral
 * 1px rail; VitePress slides a 2px brand bar along it, this slides a 6px dot
 * instead (no one-sided accents, plan decision 4).
 */
export function OutlineList({
  entries,
  active,
  onNavigate,
  className,
}: {
  entries: OutlineEntry[];
  active?: string;
  onNavigate?: () => void;
  className?: string;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [markerTop, setMarkerTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
    const link = active ? links.find((a) => a.getAttribute("href") === `#${active}`) : undefined;
    setMarkerTop(link ? link.offsetTop + link.offsetHeight / 2 - 3 : null);
  }, [active, entries]);

  return (
    <ul ref={list} className={cn("relative border-l pl-4", className)}>
      {markerTop !== null ? (
        <li
          aria-hidden="true"
          className="pointer-events-none absolute -left-[3.5px] size-1.5 rounded-full bg-primary transition-[top] duration-250 ease-[cubic-bezier(0,1,0.5,1)] motion-reduce:transition-none"
          style={{ top: markerTop }}
        />
      ) : null}
      {entries.map((entry) => (
        <li key={entry.id} className={entry.level === 3 ? "pl-3" : undefined}>
          <a
            href={`#${entry.id}`}
            onClick={onNavigate}
            aria-current={entry.id === active ? "location" : undefined}
            className={cn(
              "block truncate text-sm leading-8 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              entry.id === active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "On this page" in the aside (from 1280), VPDocAsideOutline. */
export function Outline({ entries, active }: { entries: OutlineEntry[]; active?: string }) {
  const { t } = useTranslation("common");
  if (entries.length === 0) return null;
  return (
    <nav aria-labelledby="lp-outline-title">
      <div id="lp-outline-title" className="text-sm leading-8 font-semibold">
        {t("shell.onThisPage")}
      </div>
      <OutlineList entries={entries} active={active} />
    </nav>
  );
}
