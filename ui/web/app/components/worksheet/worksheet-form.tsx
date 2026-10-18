/**
 * worksheet-form.tsx
 * A worksheet rendered from its served kind: each section a fieldset of its
 * lines and tables. Nothing here knows any kind.
 *
 * Autosave: when a field loses focus and its section has changed, that one
 * section is posted, with the revision the page holds. The API merges it
 * without touching any other section. If someone else wrote this section
 * since (another tab, a row added from the reader), the API refuses, and the
 * section is reloaded from what the server now holds.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type {
  Answers,
  CellValue,
  FieldValue,
  TableRow,
  WorksheetField,
  WorksheetKind,
  WorksheetSection,
} from "~/lib/worksheet-types";
import { initialValues, sectionPayload, shown, type SectionValues } from "~/lib/worksheet-values";
import { FieldInput } from "~/components/worksheet/field-input";
import { WorksheetTable, type TableExtras } from "~/components/worksheet/worksheet-table";

/** What a kind's page adds to its tables, by section and table field. */
export type FormExtras = (section: string, field: WorksheetField) => TableExtras | undefined;

/** What the page's action answers a section save with. */
export type SectionResult =
  | { section: string; ok: true; revision: string }
  | { section: string; error: string }
  | { section: string; conflict: true; values: Record<string, FieldValue>; revision: string };

/**
 * A section's table cells, for something a kind adds beside its section
 * (the writing card's diagnosis, phase 4). A set is saved at once, as a blur
 * would save it.
 */
export type SectionEditor = {
  cell: (field: string, row: string, column: string) => CellValue | undefined;
  setCell: (field: string, row: string, column: string, value: CellValue) => void;
};

type FormProps = {
  worksheetId: string;
  kind: WorksheetKind;
  answers: Answers;
  revision: string;
  /** The page's action URL; defaults to the current route. */
  action?: string;
  extras?: FormExtras;
  /** Each section's values as the learner edits them, before they are saved. */
  onValues?: (section: string, values: SectionValues) => void;
  /** Shown after a section's fields, when it returns something. */
  renderSectionExtra?: (section: WorksheetSection, editor: SectionEditor) => ReactNode;
};

export function WorksheetForm({
  worksheetId,
  kind,
  answers,
  revision: loaded,
  action,
  renderSectionExtra,
  extras,
  onValues,
}: FormProps) {
  // The newest revision any section's save returned. A section written by
  // someone else is still refused: the API compares per section.
  const [revision, setRevision] = useState(loaded);
  useEffect(() => setRevision((r) => (loaded > r ? loaded : r)), [loaded]);
  return (
    <div className="mt-6 space-y-10">
      {kind.sections.map((s) => (
        <SectionForm
          key={s.key}
          worksheetId={worksheetId}
          section={s}
          stored={answers[s.key]}
          revision={revision}
          onSaved={(r) => setRevision((cur) => (r > cur ? r : cur))}
          action={action}
          extras={extras}
          renderExtra={renderSectionExtra}
          onValues={onValues}
        />
      ))}
    </div>
  );
}

type SectionProps = {
  worksheetId: string;
  section: WorksheetSection;
  stored: Record<string, FieldValue> | undefined;
  revision: string;
  onSaved: (revision: string) => void;
  action?: string;
  extras?: FormExtras;
  onValues?: (section: string, values: SectionValues) => void;
  renderExtra?: (section: WorksheetSection, editor: SectionEditor) => ReactNode;
};

function SectionForm({
  worksheetId,
  section,
  stored,
  revision,
  onSaved,
  action,
  renderExtra,
  extras,
  onValues,
}: SectionProps) {
  const { t } = useTranslation("toolkit");
  const fetcher = useFetcher<SectionResult>({ key: `worksheet-${worksheetId}-${section.key}` });
  const [values, setValues] = useState<SectionValues>(() => initialValues(section, stored));
  const dirty = useRef(false);
  // Set by a change that saves at once (a kept recording): the save runs
  // once the new values have rendered.
  const commitPending = useRef(false);
  const headingId = `ws-${section.key}`;

  // A save's answer: a new revision, or the server's copy after a conflict.
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  useEffect(() => {
    if (!result || result.section !== section.key) return;
    if ("ok" in result) onSaved(result.revision);
    if ("conflict" in result) {
      setValues(initialValues(section, result.values));
      dirty.current = false;
      onSaved(result.revision);
    }
    // Only a new answer matters; section and onSaved are stable enough.
  }, [result]);

  const set = (key: string, v: FieldValue | undefined, commit?: boolean) => {
    dirty.current = true;
    if (commit) commitPending.current = true;
    setValues((cur) => ({ ...cur, [key]: v }));
  };

  const submit = (next: SectionValues) =>
    fetcher.submit(
      {
        intent: "section",
        section: section.key,
        values: JSON.stringify(sectionPayload(section, next)),
        revision,
      },
      { method: "post", ...(action ? { action } : {}) },
    );

  const save = () => {
    if (!dirty.current) return;
    dirty.current = false;
    submit(values);
  };

  useEffect(() => {
    onValues?.(section.key, values);
    // Only a change of values is news; onValues may be a new function each render.
  }, [values]);

  useEffect(() => {
    if (!commitPending.current) return;
    commitPending.current = false;
    save();
    // save reads the values this render holds.
  }, [values]);

  const rowsOf = (field: string) => (Array.isArray(values[field]) ? (values[field] as TableRow[]) : []);
  const editor: SectionEditor = {
    cell: (field, row, column) => rowsOf(field).find((r) => r.row === row)?.cells?.[column],
    setCell: (field, row, column, value) => {
      const rows = rowsOf(field);
      const next: TableRow[] = rows.some((r) => r.row === row)
        ? rows.map((r) => (r.row === row ? { ...r, cells: { ...r.cells, [column]: value } } : r))
        : [...rows, { row, cells: { [column]: value } }];
      const nextValues = { ...values, [field]: next };
      dirty.current = false;
      setValues(nextValues);
      submit(nextValues);
    },
  };
  const extra = renderExtra?.(section, editor);

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="font-serif text-xl font-semibold">
        {section.title}
      </h2>
      {section.hint ? (
        <p className="mt-1 whitespace-pre-line text-sm leading-prose text-muted-foreground">{section.hint}</p>
      ) : null}
      <fieldset className="mt-4 space-y-5" onBlur={save} aria-labelledby={headingId}>
        {section.fields.filter((f) => shown(f, values)).map((f) => {
          const id = `ws-${section.key}-${f.key}`;
          if (f.type === "table") {
            return (
              <div key={f.key}>
                <p className="mb-2 text-sm font-medium">{f.label}</p>
                {f.hint ? <p className="mb-2 text-xs text-faint">{f.hint}</p> : null}
                <WorksheetTable
                  field={f}
                  id={id}
                  rows={Array.isArray(values[f.key]) ? (values[f.key] as TableRow[]) : []}
                  onChange={(rows, commit) => set(f.key, rows, commit)}
                  extras={extras?.(section.key, f)}
                />
              </div>
            );
          }
          const inline = f.type === "check";
          return (
            <div key={f.key} className={inline ? "flex min-h-11 items-center gap-3" : ""}>
              {inline ? (
                <FieldInput field={f} id={id} value={values[f.key] as never} onChange={(v, commit) => set(f.key, v, commit)} />
              ) : null}
              <label htmlFor={id} className={inline ? "text-sm" : "block text-sm font-medium"}>
                {f.label}
              </label>
              {f.hint ? <p className="text-xs text-faint">{f.hint}</p> : null}
              {!inline ? (
                <div className="mt-1">
                  <FieldInput field={f} id={id} value={values[f.key] as never} onChange={(v, commit) => set(f.key, v, commit)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      {extra}
      <p className="mt-2 min-h-5 text-xs text-faint" aria-live="polite">
        {fetcher.state !== "idle"
          ? t("form.saving")
          : result && "ok" in result
            ? t("form.saved")
            : ""}
      </p>
      {result && "error" in result ? (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      ) : null}
      {result && "conflict" in result ? (
        <p role="alert" className="text-sm text-warning">
          {t("form.conflict")}
        </p>
      ) : null}
    </section>
  );
}
