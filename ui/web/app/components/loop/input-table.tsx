/**
 * input-table.tsx
 * The loop's forms as up's worksheet tables (I2, plan 261020-2246 phase 12):
 * a row per line, the label and its hint in the header column on the soft
 * fill, the input filling the cell with no box of its own.
 *
 * The library's FieldTable (components/doc/field-table.tsx) is controlled
 * and unnamed, for a page that saves by script. The loop's forms are plain
 * posts with uncontrolled, named inputs, so this draws the same
 * `lp-field-table` markup around controls the caller builds. A control may
 * belong to a form elsewhere on the page through its `form` attribute, which
 * lets one form span several numbered sections.
 */
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { ScrollBox } from "~/components/doc/scroll-box";

export type InputRow = {
  /** The control's id; its label and hint point at it. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  /** One <input>, <textarea> or <select>, with `id` set to the row's id. */
  control: ReactElement<{ "aria-describedby"?: string }>;
  /** A control that is not a text box (a checkbox) keeps the cell's padding. */
  padded?: boolean;
};

export function InputTable({ caption, rows }: { caption: string; rows: InputRow[] }) {
  return (
    <div className="lp-field-table">
      <ScrollBox>
        <table>
          <caption className="sr-only">{caption}</caption>
          <tbody>
            {rows.map((row) => {
              const hintId = row.hint ? `${row.id}-hint` : undefined;
              return (
                <tr key={row.id}>
                  <th scope="row" className="w-[36%]">
                    <label htmlFor={row.id}>{row.label}</label>
                    {row.hint ? (
                      <span id={hintId} className="mt-1 block text-[13px] font-normal">
                        {row.hint}
                      </span>
                    ) : null}
                  </th>
                  <td className={row.padded ? "px-4! py-2!" : undefined}>
                    {hintId ? cloneElement(row.control, { "aria-describedby": hintId }) : row.control}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollBox>
    </div>
  );
}
