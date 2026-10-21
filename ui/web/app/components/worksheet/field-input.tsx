/**
 * field-input.tsx
 * One worksheet value, rendered from its served field: a line, prose, an
 * option list, a 0–2 score, a yes/no gate, a date or a checklist item. Used
 * for a section's own lines and for a table's cells alike; a cell passes its
 * row's options and an accessible name instead of a visible label.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { optionLabel, type CellValue, type WorksheetField } from "~/lib/worksheet-types";
import { AudioCell } from "~/components/worksheet/audio-cell";

export const inputBox =
  "w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

// The input table (I2) stretches every input in a cell to the cell's size;
// a box or a radio keeps its own, so these win over that rule.
const tick = "min-h-0! p-0! accent-primary";

type Props = {
  field: WorksheetField;
  id: string;
  value: CellValue | undefined;
  /** commit saves the section now (a kept recording), instead of on blur. */
  onChange: (v: CellValue | undefined, commit?: boolean) => void;
  /** A cell's own options, where they differ per row. */
  options?: string[];
  /** A table cell's accessible name; a section line is named by its label. */
  ariaLabel?: string;
};

const OTHER = "__other";

/**
 * Something a page puts beside one of its fields, found by the input's id
 * (`ws-<section>-<field>`, or `ws-<section>-<field>-<row>-<column>` in a
 * table): the video page's Play and Now beside a timestamp (up-methods
 * phase 2). Null leaves the field as it is.
 */
export type FieldAddon = (
  id: string,
  field: WorksheetField,
  value: CellValue | undefined,
  onChange: Props["onChange"],
) => ReactNode;

export const FieldAddonContext = createContext<FieldAddon | null>(null);

export function FieldInput(props: Props) {
  const addon = useContext(FieldAddonContext)?.(props.id, props.field, props.value, props.onChange);
  if (!addon) return <FieldControl {...props} />;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 grow">
        <FieldControl {...props} />
      </div>
      {addon}
    </div>
  );
}

function FieldControl({ field, id, value, onChange, options, ariaLabel }: Props) {
  const { t } = useTranslation("toolkit");
  const opts = options ?? field.options ?? [];
  const named = ariaLabel ? { "aria-label": ariaLabel } : {};

  switch (field.type) {
    case "text":
      return (
        <input
          id={id}
          type="text"
          maxLength={500}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputBox}
          {...named}
        />
      );
    case "long":
      return (
        <textarea
          id={id}
          rows={field.max_len ? 12 : 3}
          maxLength={field.max_len ?? 5000}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputBox}
          {...named}
        />
      );
    case "date":
      return (
        <input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={`${inputBox} max-w-48`}
          {...named}
        />
      );
    case "check":
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className={`size-5! ${tick}`}
          {...named}
        />
      );
    case "choice":
      return <ChoiceInput field={field} id={id} value={value} onChange={onChange} options={opts} ariaLabel={ariaLabel} />;
    case "multi": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <fieldset id={id} className="flex flex-wrap gap-x-4 gap-y-1" {...named}>
          {opts.map((o) => (
            <label key={o} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(o)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...chosen, o] : chosen.filter((c) => c !== o))
                }
                className={`size-4 ${tick}`}
              />
              {optionLabel(field, o)}
            </label>
          ))}
          {field.other ? (
            <input
              type="text"
              maxLength={500}
              placeholder={t("form.other")}
              aria-label={t("form.other")}
              value={chosen.find((c) => !opts.includes(c)) ?? ""}
              onChange={(e) => {
                const kept = chosen.filter((c) => opts.includes(c));
                onChange(e.target.value ? [...kept, e.target.value] : kept);
              }}
              className={`${inputBox} max-w-64`}
            />
          ) : null}
        </fieldset>
      );
    }
    case "score": {
      const labels = field.score_labels ?? [];
      return (
        <fieldset id={id} className="flex flex-wrap gap-x-4 gap-y-1" {...named}>
          {[0, 1, 2].map((n) => (
            <label key={n} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                checked={value === n}
                onChange={() => onChange(n)}
                className={`size-4 ${tick}`}
              />
              <span className="font-mono tabular-nums">{n}</span>
              {labels[n] ? <span className="text-muted-foreground">{labels[n]}</span> : null}
            </label>
          ))}
        </fieldset>
      );
    }
    case "yesno":
      return (
        <fieldset id={id} className="flex gap-x-4" {...named}>
          {[true, false].map((b) => (
            <label key={String(b)} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name={id}
                checked={value === b}
                onChange={() => onChange(b)}
                className={`size-4 ${tick}`}
              />
              {b ? t("form.yes") : t("form.no")}
            </label>
          ))}
        </fieldset>
      );
    case "audio":
      return (
        <AudioCell
          value={typeof value === "string" ? value : undefined}
          onChange={onChange}
          label={ariaLabel ?? field.label}
        />
      );
    default:
      return null;
  }
}

function ChoiceInput({ field, id, value, onChange, options, ariaLabel }: Props & { options: string[] }) {
  const { t } = useTranslation("toolkit");
  const current = typeof value === "string" ? value : "";
  const [otherMode, setOtherMode] = useState(current !== "" && !options.includes(current));
  const hint = otherMode ? undefined : field.option_hints?.[current];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        id={id}
        value={otherMode ? OTHER : current}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOtherMode(true);
            onChange(undefined);
            return;
          }
          setOtherMode(false);
          onChange(e.target.value || undefined);
        }}
        className={`${inputBox} w-auto min-w-40`}
        {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
        {...(hint ? { "aria-describedby": `${id}-hint` } : {})}
      >
        <option value="">{t("form.choose")}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(field, o)}
          </option>
        ))}
        {field.other ? <option value={OTHER}>{t("form.otherOption")}</option> : null}
      </select>
      {otherMode ? (
        <input
          type="text"
          maxLength={500}
          aria-label={t("form.other")}
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputBox} max-w-64`}
        />
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="basis-full text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
