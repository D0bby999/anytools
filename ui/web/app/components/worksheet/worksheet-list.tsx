/**
 * worksheet-list.tsx
 * Worksheets as up's dated list (P4): **date** · title — kind, status and
 * the next review.
 * Used by /toolkit (per kind) and by a learning state's page.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { DueReview, WorksheetSummary } from "~/lib/worksheet-types";
import { Badge } from "~/components/doc/badge";
import { DateText } from "~/components/ui/date-text";
import { NOTE_JOIN } from "~/lib/sentence";

/** The earliest review not yet done, if any is scheduled. */
export function nextReview(w: Pick<WorksheetSummary, "reviews">): string | null {
  const open = Object.values(w.reviews ?? {})
    .filter((r) => !r.done)
    .map((r) => r.due)
    .sort();
  return open[0] ?? null;
}

export function WorksheetList({
  worksheets,
  kindNames,
}: {
  worksheets: WorksheetSummary[];
  /** kind id → name, to say which kind each row is. */
  kindNames?: Record<string, string>;
}) {
  const { t } = useTranslation("toolkit");
  if (worksheets.length === 0) return null;
  return (
    <ul className="lp-dated-list">
      {worksheets.map((w) => {
        const next = nextReview(w);
        return (
          <li key={w.id}>
            {w.updated_at ? (
              <>
                <strong>
                  <DateText iso={w.updated_at} />
                </strong>
                {" · "}
              </>
            ) : null}
            <Link to={`/toolkit/${w.id}`}>{w.title}</Link>
            {NOTE_JOIN}
            {kindNames?.[w.kind] ? <span className="text-muted-foreground">{kindNames[w.kind]} </span> : null}
            <Badge type={w.status === "done" ? "tip" : "info"}>{w.status === "done" ? t("list.done") : t("list.open")}</Badge>
            {next ? <span className="text-sm text-muted-foreground"> {t("list.nextReview", { date: next })}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** "To revisit": reviews due on the learner's day or earlier, each line led by its date. */
export function DueReviewList({ due }: { due: DueReview[] }) {
  const { t } = useTranslation("toolkit");
  if (due.length === 0) return <p className="text-muted-foreground">{t("due.none")}</p>;
  return (
    <ul className="lp-dated-list">
      {due.map((d) => (
        <li key={`${d.id}:${d.review}`}>
          <strong>{d.due}</strong>
          {" · "}
          <Link to={`/toolkit/${d.id}`}>{d.title}</Link>
          {NOTE_JOIN}
          {d.label}
        </li>
      ))}
    </ul>
  );
}
