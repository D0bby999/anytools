/**
 * diagnostic-extras.tsx
 * What up's English diagnostic shows beyond its served kind (up methods,
 * phase 1):
 *   - §4: each skill's total next to its row, as the scores change. The
 *     kind's own help says a total only compares a person with themselves.
 *   - §5: the "Evidence card" cell opens that skill's full evidence worksheet
 *     (listening_audit, reading_evidence, speaking_evidence,
 *     writing_evidence), prefilled with the barrier chosen in the row. A kind
 *     not served yet shows its name only; one that attaches to a document is
 *     started from that document.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { TableRow, WorksheetField, WorksheetKind } from "~/lib/worksheet-types";
import { DIAGNOSTIC_KIND, evidenceTarget, scoreTotal } from "~/lib/english-diagnostic";
import type { FormExtras } from "~/components/worksheet/worksheet-form";
import { Button } from "~/components/ui/button";

type Options = {
  /** The worksheet's kind. */
  kind: WorksheetKind;
  /** Every served kind: which evidence worksheets exist yet. */
  kinds: WorksheetKind[];
  /** The diagnostic's title, quoted in the prefill. */
  title: string;
};

/** The diagnostic's table extras, or undefined for any other kind. */
export function useDiagnosticExtras({ kind, kinds, title }: Options): FormExtras | undefined {
  const { t } = useTranslation("toolkit");
  if (kind.kind !== DIAGNOSTIC_KIND) return undefined;
  return (section, field) => {
    if (section === "scores" && field.key === "scores") {
      return { column: { label: t("diagnostic.total"), cell: (row) => <RowTotal field={field} row={row} /> } };
    }
    if (section === "barriers" && field.key === "barriers") {
      return {
        labelCell: (column, row) =>
          column.key === "card" ? (
            <EvidenceCell column={column} row={row} rowLabel={rowLabel(field, row)} kinds={kinds} title={title} />
          ) : undefined,
      };
    }
    return undefined;
  };
}

function rowLabel(field: WorksheetField, row: TableRow): string {
  return field.rows?.find((r) => r.key === row.row)?.label ?? row.row;
}

function RowTotal({ field, row }: { field: WorksheetField; row: TableRow }) {
  const { t } = useTranslation("toolkit");
  const { total, max, scored } = scoreTotal(field, row);
  if (scored === 0) return <span className="text-faint">—</span>;
  return (
    <span className="font-mono tabular-nums" aria-label={t("diagnostic.totalOf", { total, max })}>
      {total} / {max}
    </span>
  );
}

type CellProps = { column: WorksheetField; row: TableRow; rowLabel: string; kinds: WorksheetKind[]; title: string };

function EvidenceCell({ column, row, rowLabel, kinds, title }: CellProps) {
  const { t } = useTranslation("toolkit");
  const target = evidenceTarget(row.row, kinds);
  if (target.mode === "absent") {
    return <span className="text-muted-foreground">{column.text?.[row.row] ?? ""}</span>;
  }
  if (target.mode === "document") {
    return (
      <span className="text-muted-foreground">
        {target.kind.name}
        <span className="block text-xs text-faint">{t("diagnostic.fromDocument")}</span>
      </span>
    );
  }
  const barrier = typeof row.cells.barrier === "string" ? row.cells.barrier : "";
  const sample = typeof row.cells.sample === "string" ? row.cells.sample.trim() : "";
  const prefill = barrier
    ? t("diagnostic.prefill", { title, barrier }) + (sample ? ` ${t("diagnostic.prefillSample", { sample })}` : "")
    : "";
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="openEvidence" />
      <input type="hidden" name="skill" value={row.row} />
      <input type="hidden" name="prefill" value={prefill} />
      <Button type="submit" variant="outline" size="sm">
        {t("diagnostic.open", { skill: rowLabel.toLowerCase() })}
      </Button>
    </Form>
  );
}
