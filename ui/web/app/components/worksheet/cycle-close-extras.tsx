/**
 * cycle-close-extras.tsx
 * What a cycle close's destinations table shows beyond its served kind (up
 * methods, phase 10): beside each row, what it still needs — a transfer's one
 * changed condition, a stop's three actions. The API refuses a transfer
 * without its condition, and a close marked done while a stop is unfinished;
 * this column says so before the learner gets there.
 */
import { useTranslation } from "react-i18next";
import type { WorksheetKind } from "~/lib/worksheet-types";
import { CYCLE_CLOSE_KIND, missingForRow } from "~/lib/cycle-close";
import type { FormExtras } from "~/components/worksheet/worksheet-form";

/** The close's table extras, or undefined for any other kind. */
export function useCycleCloseExtras(kind: WorksheetKind): FormExtras | undefined {
  const { t } = useTranslation("toolkit");
  if (kind.kind !== CYCLE_CLOSE_KIND) return undefined;
  return (section, field) => {
    if (section !== "destinations" || field.key !== "results") return undefined;
    return {
      column: {
        label: t("cycleClose.missing"),
        cell: (row) => {
          const missing = missingForRow(row);
          if (missing.length === 0) return <span className="text-faint">{t("cycleClose.none")}</span>;
          return (
            <span className="text-sm text-warning">{missing.map((key) => t(`cycleClose.need.${key}`)).join(", ")}</span>
          );
        },
      },
    };
  };
}
