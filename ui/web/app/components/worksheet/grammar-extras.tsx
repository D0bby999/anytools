/**
 * grammar-extras.tsx
 * What the grammar error map (up methods, phase 6) shows beyond its served
 * kind, on its own table of errors:
 *   - the rows sorted by priority, which the kind derives from each row's
 *     impact and never stores (lib/grammar.ts);
 *   - "Start a contrast card" on each row: a grammar evidence worksheet
 *     prefilled from the row's sample, impact, meaning decision and what the
 *     learner meant (grammar.server.ts).
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { TableRow, WorksheetKind } from "~/lib/worksheet-types";
import { GRAMMAR_MAP_KIND, MAP_ERRORS, MAP_SECTION, errorRow, priorityOrder } from "~/lib/grammar";
import type { FormExtras } from "~/components/worksheet/worksheet-form";
import { Button } from "~/components/ui/button";

/** The error map's table extras, or undefined for any other kind. */
export function useGrammarExtras({ kind }: { kind: WorksheetKind }): FormExtras | undefined {
  const { t } = useTranslation("toolkit");
  if (kind.kind !== GRAMMAR_MAP_KIND) return undefined;
  return (section, field) =>
    section === MAP_SECTION && field.key === MAP_ERRORS
      ? {
          order: (rows) => priorityOrder(field, rows),
          column: { label: t("grammar.cardColumn"), cell: (row) => <ContrastCardButton row={row} /> },
        }
      : undefined;
}

function ContrastCardButton({ row }: { row: TableRow }) {
  const { t } = useTranslation("toolkit");
  // The row's current values, saved or not, are what is carried.
  const r = errorRow(row);
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="contrastCard" />
      <input type="hidden" name="sample" value={r.sample} />
      <input type="hidden" name="meant" value={r.meant} />
      <input type="hidden" name="decision" value={r.decision} />
      <input type="hidden" name="impact" value={r.impact} />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={!r.sample}
        title={r.sample ? undefined : t("grammar.needsSample")}
        aria-label={r.sample ? t("grammar.startFor", { sample: r.sample }) : t("grammar.start")}
      >
        {t("grammar.start")}
      </Button>
    </Form>
  );
}
