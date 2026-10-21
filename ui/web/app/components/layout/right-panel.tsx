import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { partOf } from "~/lib/parts";

/**
 * The margin: the column a textbook keeps beside its text for sources and
 * notes. It is the activity rail of earlier phases, set as a margin.
 *
 * It renders whether or not a feature has filled it yet, because this is the
 * one piece of furniture that states what the product is: an answer here is
 * only worth as much as the passage it came from. A rail that appears once
 * there happens to be a citation reads as optional chrome; a rail that is
 * always there, explaining itself while empty, reads as the point.
 *
 * Phase 6 passes children into it (citations, stream activity). Until then the
 * empty state below is the content, and it teaches rather than apologises.
 *
 * Since the up shell (plan 261020-2246, phase 05) it lives in the aside column
 * under "On this page". A page that draws its own panel (`ownsPanel`) renders
 * it where it likes; after mount the panel moves itself, through a portal,
 * into the aside's slot from 1280 and to the end of the page below that. The
 * server and the first client render keep it in place, so hydration matches.
 */
export const PANEL_ASIDE_SLOT = "lp-aside-slot";
export const PANEL_END_SLOT = "lp-panel-end";

function usePanelTarget(inline: boolean): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (inline) return;
    const wide = typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1280px)") : null;
    const pick = () => setTarget(document.getElementById(wide?.matches ? PANEL_ASIDE_SLOT : PANEL_END_SLOT));
    pick();
    wide?.addEventListener("change", pick);
    return () => wide?.removeEventListener("change", pick);
  }, [inline]);
  return target;
}

export function RightPanel({ title, children, inline = false }: { title?: string; children?: ReactNode; inline?: boolean }) {
  const { t } = useTranslation("common");
  const { pathname } = useLocation();
  const part = partOf(pathname);
  // With nothing passed in, the margin says what this part of the book is
  // for. Ask is about sources, so it explains citations there; Read pages
  // (a knowledge base, a notebook, a book) never cite anything themselves, and
  // "Nothing is cited yet" beside a chapter full of citations read as a fault.
  // Body sits in Practise but is not spaced review: its own note says why
  // training is beside the studying.
  const note =
    pathname === "/body" || pathname.startsWith("/body/")
      ? t("panel.margin.body")
      : part === "read"
      ? t("panel.margin.read")
      : part === "practise"
      ? t("panel.margin.practise")
      : part === "reflect"
        ? t("panel.margin.reflect")
        : part === "home" || part === "tools"
          ? t("panel.margin.home")
          : null;
  const heading = title ?? (note ? t("panel.margin.title") : t("panel.sources.title"));
  const target = usePanelTarget(inline);

  const panel = (
    <aside aria-labelledby="lp-panel-heading" className="mt-8 border-t pt-6 first:mt-0 first:border-t-0 first:pt-0">
      <h2 id="lp-panel-heading" data-outline-ignore className="text-sm leading-8 font-semibold">
        {children ? (title ?? t("panel.sources.title")) : heading}
      </h2>
      {children ?? <p className="mt-2 text-sm leading-6 text-muted-foreground">{note ?? t("panel.sources.empty")}</p>}
    </aside>
  );
  return target ? createPortal(panel, target) : panel;
}
