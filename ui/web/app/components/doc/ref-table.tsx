import type { ReactNode } from "react";
import { useOverflowTabStop } from "~/components/doc/scroll-box";

/**
 * A reference table (P5), as every table in up: a header row on the soft
 * fill, zebra rows, a 1px rule round every cell, and sideways scrolling
 * inside its own box so a wide table never widens a phone's page.
 */
export function RefTable({
  columns,
  rows,
  caption,
  rowHeaders = true,
}: {
  columns: ReactNode[];
  rows: ReactNode[][];
  /** Read by a screen reader; up's tables sit under a heading that says the same. */
  caption: string;
  /** The first cell of each row names the row. */
  rowHeaders?: boolean;
}) {
  const [scrollTable, tableTabIndex] = useOverflowTabStop<HTMLTableElement>();
  return (
    <table ref={scrollTable} tabIndex={tableTabIndex} className="lp-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) =>
              c === 0 && rowHeaders ? (
                <th key={c} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={c}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
