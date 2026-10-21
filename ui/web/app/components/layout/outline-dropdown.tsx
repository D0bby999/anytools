import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { OutlineList, type OutlineEntry } from "~/components/layout/outline";
import { cn } from "~/lib/utils";

/**
 * "On this page" below 1280, VPLocalNavOutlineDropdown: a 12/500 button in
 * the local nav opening a panel (surface, 1px border, radius 8, raised
 * shadow) with "Return to top" and the outline. A link, Escape, a click
 * outside or a navigation closes it.
 */
export function OutlineDropdown({ entries, active }: { entries: OutlineEntry[]; active?: string }) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (entries.length === 0) return null;

  function toTop() {
    setOpen(false);
    document.querySelector<HTMLElement>("[data-lp-scroll]")?.scrollTo({ top: 0 });
  }

  return (
    <div ref={root} className="h-full">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-full items-center gap-1 px-6 text-xs leading-6 font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset md:px-8"
      >
        {t("shell.onThisPage")}
        <ChevronRight aria-hidden="true" className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full right-4 left-4 mt-2 max-h-[calc(100dvh-var(--lp-topbar-h)-var(--lp-localnav-h)-16px)] overflow-y-auto rounded-md border bg-card shadow-md min-[960px]:left-[calc(var(--lp-shell-rail)+16px)]"
      >
        <div className="border-b px-6 py-2">
          <button type="button" onClick={toTop} className="text-sm leading-8 font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {t("shell.returnToTop")}
          </button>
        </div>
        <nav aria-label={t("shell.onThisPage")} className="px-6 py-3">
          <OutlineList entries={entries} active={active} onNavigate={() => setOpen(false)} />
        </nav>
      </div>
    </div>
  );
}
