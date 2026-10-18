/**
 * evaluation-extras.tsx
 * What an AI evaluation's results show beyond the served kind (plans/261017-
 * 1828-up-f13ff2d-upgrade, phase 2): beside each version's stored rates, the
 * rates its case rows give right now, counted as the learner edits the rows
 * (lib/ai-evaluation.ts). The API refuses results whose rates disagree with
 * the rows; a case added after the results were saved is not refused, so the
 * column also says when a stored rate has gone out of date.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Answers, TableRow, WorksheetKind } from "~/lib/worksheet-types";
import type { SectionValues } from "~/lib/worksheet-values";
import {
  AI_EVALUATION_KIND,
  CASES_SECTION,
  CASES_TABLE,
  FIRST_PASS,
  RATES_TABLE,
  RESULTS_SECTION,
  REVISED,
  agrees,
  ratesOf,
} from "~/lib/ai-evaluation";
import type { FormExtras } from "~/components/worksheet/worksheet-form";

const rowsOf = (v: unknown): TableRow[] => (Array.isArray(v) ? (v as TableRow[]) : []);

/**
 * The evaluation's extras and the form's onValues that feeds them, or
 * nothing for any other kind.
 */
export function useEvaluationExtras(
  kind: WorksheetKind,
  answers: Answers,
): { extras?: FormExtras; onValues?: (section: string, values: SectionValues) => void } {
  const { t } = useTranslation("toolkit");
  const [cases, setCases] = useState<TableRow[]>(() => rowsOf(answers[CASES_SECTION]?.[CASES_TABLE]));
  if (kind.kind !== AI_EVALUATION_KIND) return {};
  const counted = ratesOf(cases);
  return {
    onValues: (section, values) => {
      if (section === CASES_SECTION) setCases(rowsOf(values[CASES_TABLE]));
    },
    extras: (section, field) =>
      section === RESULTS_SECTION && field.key === RATES_TABLE
        ? {
            column: {
              label: t("evaluation.counted"),
              cell: (row) => {
                const r = counted[row.row] ?? { firstPass: 0, revised: 0, attempts: 0 };
                if (r.attempts === 0) return <span className="text-faint">{t("evaluation.noAttempts")}</span>;
                const stale =
                  !agrees(row.cells[FIRST_PASS], r.firstPass, r.attempts) ||
                  !agrees(row.cells[REVISED], r.revised, r.attempts);
                return (
                  <span className="block text-sm">
                    <span className="block font-mono">
                      {t("evaluation.rates", {
                        first: `${r.firstPass}/${r.attempts}`,
                        revised: `${r.revised}/${r.attempts}`,
                      })}
                    </span>
                    {stale ? <span className="block text-warning">{t("evaluation.differs")}</span> : null}
                  </span>
                );
              },
            },
          }
        : undefined,
  };
}
