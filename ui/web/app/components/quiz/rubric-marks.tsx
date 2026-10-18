import { useTranslation } from "react-i18next";
import type { Criterion, CriterionResult } from "~/lib/study-types";

/** A number of points as the learner reads it: 2, 1.5, 0.25. */
export function points(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A written answer's marking, criterion by criterion: what each earned of what
 * it was worth, and the marker's one-line reason. Plain rows, not a table: on
 * a phone a criterion's text needs the whole width.
 */
export function RubricMarks({ criteria }: { criteria: CriterionResult[] }) {
  const { t } = useTranslation("study");
  const awarded = criteria.reduce((sum, c) => sum + c.awarded, 0);
  const total = criteria.reduce((sum, c) => sum + c.points, 0);
  return (
    <div>
      <p className="font-medium">{t("rubric.scored", { awarded: points(awarded), total: points(total) })}</p>
      <ul className="mt-1 divide-y border-y">
        {criteria.map((c, i) => (
          <li key={i} className="py-2">
            <p className="flex items-baseline justify-between gap-3">
              <span>{c.criterion}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                {t("rubric.of", { awarded: points(c.awarded), total: points(c.points) })}
              </span>
            </p>
            {c.comment ? <p className="text-muted-foreground">{c.comment}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A rubric before any answer is marked against it: what a full answer does. */
export function RubricList({ rubric }: { rubric: Criterion[] }) {
  const { t } = useTranslation("study");
  return (
    <div>
      <p className="font-medium">{t("rubric.title")}</p>
      <ul className="mt-1 divide-y border-y">
        {rubric.map((c, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 py-2">
            <span>{c.criterion}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">{t("rubric.points", { count: c.points })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
