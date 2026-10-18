/**
 * worksheet-list.tsx
 * Worksheets as hairline rows: title, kind, status and the next review.
 * Used by /toolkit (per kind) and by a learning state's page.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { DueReview, WorksheetSummary } from "~/lib/worksheet-types";

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
    <ul className="mt-2 border-t">
      {worksheets.map((w) => {
        const next = nextReview(w);
        return (
          <li key={w.id} className="border-b">
            <Link
              to={`/toolkit/${w.id}`}
              className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-2 text-sm transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <span className="font-medium">{w.title}</span>
              {kindNames?.[w.kind] ? <span className="text-muted-foreground">{kindNames[w.kind]}</span> : null}
              <span className="font-mono text-2xs uppercase tracking-wide text-faint">
                {w.status === "done" ? t("list.done") : t("list.open")}
              </span>
              {next ? <span className="text-xs text-faint">{t("list.nextReview", { date: next })}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** "To revisit": reviews due on the learner's day or earlier. */
export function DueReviewList({ due }: { due: DueReview[] }) {
  const { t } = useTranslation("toolkit");
  if (due.length === 0) return <p className="mt-3 text-sm text-muted-foreground">{t("due.none")}</p>;
  return (
    <ul className="mt-3 border-t">
      {due.map((d) => (
        <li key={`${d.id}:${d.review}`} className="border-b">
          <Link
            to={`/toolkit/${d.id}`}
            className="flex min-h-11 flex-wrap items-baseline gap-x-3 gap-y-1 px-1 py-2 text-sm transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <span className="font-medium">{d.title}</span>
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-mono text-2xs tabular-nums text-faint">{d.due}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
