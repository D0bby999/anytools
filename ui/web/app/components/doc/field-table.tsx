import type { ReactNode } from "react";
import { ScrollBox } from "~/components/doc/scroll-box";

export type FieldColumn = { key: string; label: string; hint?: ReactNode; multiline?: boolean };
export type FieldRow = { key: string; label: string };

/**
 * A table of inputs (I2), how up's worksheets lay out a form: the row labels
 * in a header column on the soft fill, every other cell an input with no box
 * of its own (the table's rules are its outline; focus draws a 2px ring
 * inside the cell). The table scrolls sideways in its own box, and each
 * column's help is listed under it rather than crowding the header.
 *
 * Generalised from worksheet/worksheet-table.tsx; phase 12 moves the
 * worksheet onto it. Each input is labelled "row, column" for a screen reader.
 */
export function FieldTable({
  caption,
  rowHeader,
  columns,
  rows,
  values,
  onChange,
  onBlur,
  disabled = false,
}: {
  caption: string;
  /** The label column's own header ("Area", "Day"); empty when it needs none. */
  rowHeader?: string;
  columns: FieldColumn[];
  rows: FieldRow[];
  values: Record<string, Record<string, string>>;
  onChange: (row: string, column: string, value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}) {
  const hinted = columns.filter((c) => c.hint);
  return (
    <div className="lp-field-table">
      <ScrollBox>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {/* The corner names the row labels when the table has a name for
                them; otherwise it is an empty data cell, not an empty header (axe). */}
              {rowHeader ? <th scope="col">{rowHeader}</th> : <td />}
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                {columns.map((c) => {
                  const common = {
                    "aria-label": `${row.label}, ${c.label}`,
                    value: values[row.key]?.[c.key] ?? "",
                    disabled,
                    onBlur,
                  };
                  return (
                    <td key={c.key}>
                      {c.multiline ? (
                        <textarea rows={2} {...common} onChange={(e) => onChange(row.key, c.key, e.target.value)} />
                      ) : (
                        <input type="text" {...common} onChange={(e) => onChange(row.key, c.key, e.target.value)} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      {hinted.length > 0 ? (
        <ul className="lp-field-table-hints">
          {hinted.map((c) => (
            <li key={c.key}>
              <strong>{c.label}</strong>: {c.hint}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
