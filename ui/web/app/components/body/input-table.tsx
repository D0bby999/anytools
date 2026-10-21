import type { ReactNode } from "react";
import { RefTable } from "~/components/doc/ref-table";

/** Worksheet cells with native numeric, select and completion controls. */
export function InputTable({ caption, columns, rows }: { caption: string; columns: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="lp-field-table">
      <RefTable caption={caption} columns={columns} rows={rows} />
    </div>
  );
}
