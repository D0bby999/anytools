/**
 * self-estimate.tsx
 * The language diagnostic's own levels in one line at the top of the page
 * (the private design notes, phase 5): "Your own estimate: Listening
 * B1 · Reading B2". The walkthrough's learner finished the quick version
 * and asked what level they were; the answer was a table eight sections
 * down. It is labelled as their estimate, never as a test result.
 */
import { useTranslation } from "react-i18next";
import type { Answers, TableRow, WorksheetKind } from "~/lib/worksheet-types";

export function SelfEstimate({ kind, answers }: { kind: WorksheetKind; answers: Answers }) {
  const { t } = useTranslation("toolkit");
  const field = kind.sections.find((s) => s.key === "cefr")?.fields.find((f) => f.key === "levels");
  const rows = answers.cefr?.levels;
  if (!field || !Array.isArray(rows)) return null;
  const parts = (rows as TableRow[])
    .map((r) => {
      const level = r.cells?.level;
      const label = field.rows?.find((row) => row.key === r.row)?.label ?? r.row;
      return typeof level === "string" && level !== "not sure" ? `${label} ${level}` : null;
    })
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  return (
    <p className="mt-2 text-sm leading-prose">
      <span className="font-medium">{t("selfEstimate.label")}</span> {parts.join(" · ")}
      <span className="block text-xs text-muted-foreground">{t("selfEstimate.note")}</span>
    </p>
  );
}
