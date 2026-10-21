import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { DateText } from "~/components/ui/date-text";
import type { KBSummary } from "~/lib/kb-types";
import { NOTE_JOIN } from "~/lib/sentence";

/**
 * kb-card.tsx
 *
 * One knowledge base as one line of a dated list (pattern P4, up's "recent
 * updates"): **name** · documents · updated — what is ready. It renders an
 * `<li>` for the `ul` in `.lp-doc` the index page puts round it.
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
    summary.ready > 0 ? t("card.ready", { count: summary.ready }) : null,
    summary.working > 0 ? t("card.working", { count: summary.working }) : null,
    summary.failed > 0 ? t("card.failed", { count: summary.failed }) : null,
  ].filter(Boolean);

  return (
    <li>
      <strong>
        <Link to={`/knowledge/${kb.id}`}>{kb.name}</Link>
      </strong>
      {" · "}
      {summary.documents === 0 ? t("card.none") : t("card.documents", { count: summary.documents })}
      {" · "}
      {t("card.updated")} <DateText iso={kb.updated_at} />
      {facts.length > 0 ? <>{NOTE_JOIN}{facts.join(", ")}</> : null}
      {kb.needs_reembed ? (
        // Amber, which in this world means "needs your attention" and is
        // deliberately not red: nothing is broken, but queries are blocked
        // until it is dealt with. The word carries it too, so the meaning
        // survives a colour-blind read.
        <span className="text-warning"> · {t("card.needsReembed")}</span>
      ) : null}
    </li>
  );
}
