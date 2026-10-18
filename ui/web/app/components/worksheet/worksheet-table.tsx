/**
 * worksheet-table.tsx
 * One of up's small tables as a real <table> of inputs: fixed rows labelled
 * as up labels them, or free rows the learner adds and removes up to the
 * kind's limit. On a narrow screen the table scrolls inside its own box,
 * never the page. A column's help (its hint) is listed under the table.
 *
 * A kind's page may add to a table without the form knowing the kind
 * (TableExtras): one read-only column after the kind's own, and what a label
 * column's cell shows — the English diagnostic's row totals and its evidence
 * card buttons (diagnostic-extras.tsx) — and, for a free table, the order
 * its rows are shown in (the grammar error map's priority,
 * grammar-extras.tsx). The rows are still saved in the order they were added.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useContext } from "react";
import { Link } from "react-router";
import type { CellValue, TableRow, WorksheetField } from "~/lib/worksheet-types";
import { columnApplies, labelText } from "~/lib/worksheet-values";
import { FieldInput } from "~/components/worksheet/field-input";
import { WorksheetMediaContext } from "~/components/worksheet/audio-cell";
import { Button } from "~/components/ui/button";

/** What a page adds to one table: rows are the table's current, unsaved values. */
export type TableExtras = {
  column?: { label: string; cell: (row: TableRow) => ReactNode };
  /** A label column's cell; undefined keeps the kind's text. */
  labelCell?: (column: WorksheetField, row: TableRow) => ReactNode | undefined;
  /** A free table's display order: indexes into rows. Undefined keeps the saved order. */
  order?: (rows: TableRow[]) => number[];
};

type Props = {
  field: WorksheetField;
  id: string;
  rows: TableRow[];
  /** commit saves the section now (a kept recording), instead of on blur. */
  onChange: (rows: TableRow[], commit?: boolean) => void;
  extras?: TableExtras;
};

export function WorksheetTable({ field, id, rows, onChange, extras }: Props) {
  const { t } = useTranslation("toolkit");
  const fixed = field.rows ?? [];
  const columns = field.columns ?? [];
  const free = fixed.length === 0;
  const max = field.max_rows ?? 0;
  const related = useContext(WorksheetMediaContext)?.related ?? {};
  const helped = columns.filter((c) => c.hint);

  // A fixed table shows every row up lists, filled or not.
  const shown: TableRow[] = free
    ? rows
    : fixed.map((r) => rows.find((x) => x.row === r.key) ?? { row: r.key, cells: {} });

  // Free rows may be shown in another order than they are saved; each one
  // keeps its saved index, which is also its React key, so a row that moves
  // takes its inputs (and the focus) with it.
  const order = free && extras?.order ? extras.order(shown) : shown.map((_, i) => i);

  const setCell = (index: number, col: string, v: CellValue | undefined, commit?: boolean) => {
    const next = shown.map((r, i) => {
      if (i !== index) return r;
      const cells = { ...r.cells };
      if (v === undefined) delete cells[col];
      else cells[col] = v;
      return { ...r, cells };
    });
    onChange(next, commit);
  };

  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">{field.label}</caption>
          <thead className="bg-muted">
            <tr>
              {!free ? (
                <th scope="col" className="border-b px-3 py-2 text-left font-medium">
                  {field.row_header ?? ""}
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} scope="col" className="border-b px-3 py-2 text-left font-medium">
                  {c.label}
                </th>
              ))}
              {extras?.column ? (
                <th scope="col" className="border-b px-3 py-2 text-left font-medium">
                  {extras.column.label}
                </th>
              ) : null}
              {free ? (
                <th scope="col" className="border-b px-3 py-2">
                  <span className="sr-only">{t("form.rowActions")}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {order.map((i, place) => {
              const r = shown[i];
              if (!r) return null;
              const rowLabel = free ? t("form.rowNumber", { n: place + 1 }) : (fixed[i]?.label ?? r.row);
              const see = free ? undefined : fixed[i]?.see;
              const seeId = see ? related[see.kind] : undefined;
              return (
                <tr key={free ? i : r.row} className="border-b last:border-b-0 align-top">
                  {!free ? (
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {rowLabel}
                      {see && seeId ? (
                        <Link
                          to={`/toolkit/${seeId}#ws-${see.section}`}
                          className="mt-1 block text-xs font-normal text-primary underline underline-offset-4"
                        >
                          {t("recordings.see")}
                        </Link>
                      ) : null}
                    </th>
                  ) : null}
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2">
                      {c.type === "label" ? (
                        (extras?.labelCell?.(c, r) ?? <span className="text-muted-foreground">{labelText(c, r)}</span>)
                      ) : !free && !columnApplies(c, r.row) ? (
                        <span className="text-faint" aria-label={t("recordings.notUsed")}>
                          –
                        </span>
                      ) : (
                        <FieldInput
                          field={c}
                          id={`${id}-${i}-${c.key}`}
                          value={r.cells[c.key]}
                          options={c.row_options?.[r.row]}
                          ariaLabel={`${rowLabel}: ${c.label}`}
                          onChange={(v, commit) => setCell(i, c.key, v, commit)}
                        />
                      )}
                    </td>
                  ))}
                  {extras?.column ? <td className="px-3 py-2">{extras.column.cell(r)}</td> : null}
                  {free ? (
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onChange(shown.filter((_, j) => j !== i))}
                      >
                        {t("form.removeRow")}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {helped.length > 0 ? (
        <dl className="mt-2 space-y-1 text-xs text-faint">
          {helped.map((c) => (
            <div key={c.key}>
              <dt className="inline font-medium">{c.label}: </dt>
              <dd className="inline whitespace-pre-line">{c.hint}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {free ? (
        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={shown.length >= max}
            onClick={() => onChange([...shown, { row: "", cells: {} }])}
          >
            {t("form.addRow")}
          </Button>
          <span className="text-xs text-faint">{t("form.rowsLeft", { count: Math.max(0, max - shown.length) })}</span>
        </div>
      ) : null}
    </div>
  );
}
