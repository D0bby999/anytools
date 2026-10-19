import type { ReactNode } from "react";
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
 */
export function RightPanel({ title, children }: { title?: string; children?: ReactNode }) {
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

  return (
    <aside
      aria-labelledby="lp-panel-heading"
      className="shrink-0 border-t bg-muted lg:w-(--lp-panel-w) lg:border-t-0 lg:border-l lg:bg-background"
    >
      {/* The aside stretches so its hairline runs the full height of the
          workspace; the content inside it sticks to the top as the single
          scroll region moves underneath. */}
      <div className="px-5 py-6 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto lg:px-6 lg:py-8">
        <h2 id="lp-panel-heading" className="font-serif text-xl font-semibold">
          {children ? (title ?? t("panel.sources.title")) : heading}
        </h2>
        {children ?? <p className="mt-3 lp-margin-note">{note ?? t("panel.sources.empty")}</p>}
      </div>
    </aside>
  );
}
