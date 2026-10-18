import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import type { KBSummary } from "~/lib/kb-types";

/**
 * kb-card.tsx
 *
 * One row per knowledge base, as a hairline row rather than a card in a grid.
 *
 * DESIGN.md names "a grid of identical icon-and-heading cards as page
 * structure" as an anti-pattern for this project, and these really are a list:
 * the only thing that distinguishes one from another is its name and how much
 * of it is ready.
 */
export function KBCard({ summary }: { summary: KBSummary }) {
  const { t } = useTranslation("knowledge");
  const { kb } = summary;

  // Counts, not a progress bar. A bar implies a single job with an end; a
  // knowledge base is a set that grows, and "3 ready, 1 failed" is the fact.
  const facts = [
    summary.documents === 0 ? t("card.none") : null,
    summary.ready > 0 ? t("card.ready", { count: summary.ready }) : null,
    summary.working > 0 ? t("card.working", { count: summary.working }) : null,
    summary.failed > 0 ? t("card.failed", { count: summary.failed }) : null,
  ].filter(Boolean);

  return (
    <li className="border-b">
      <Link
        to={`/knowledge/${kb.id}`}
        className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        <span className="font-sans text-base font-medium">{kb.name}</span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {facts.join(" · ")}
          {kb.needs_reembed ? (
            // Amber, which in this world means "needs your attention" and is
            // deliberately not red: nothing is broken, but queries are blocked
            // until it is dealt with. The icon carries it too, so the meaning
            // survives a colour-blind read.
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle aria-hidden="true" className="size-4" />
              {t("card.needsReembed")}
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}
