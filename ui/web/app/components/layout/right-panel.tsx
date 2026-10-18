import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/**
 * The activity rail.
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

  return (
    <aside
      aria-labelledby="lp-panel-heading"
      className="shrink-0 border-t bg-muted lg:w-(--lp-panel-w) lg:border-t-0 lg:border-l"
    >
      {/* The aside stretches so its hairline runs the full height of the
          workspace; the content inside it sticks to the top as the single
          scroll region moves underneath. */}
      <div className="p-5 lg:sticky lg:top-0 lg:max-h-dvh lg:overflow-y-auto">
        {/* The mono label is the region's real heading, not an eyebrow floating
            above someone else's title. */}
        <h2 id="lp-panel-heading" className="lp-kicker">
          {title ?? t("panel.sources.title")}
        </h2>

        {children ?? (
          <p className="mt-3 text-sm leading-prose text-muted-foreground">
            {t("panel.sources.empty")}
          </p>
        )}
      </div>
    </aside>
  );
}
