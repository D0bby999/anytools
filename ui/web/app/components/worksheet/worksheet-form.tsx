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
 *
 * A kind with a quick version opens on it (the private design notes,
 * phase 5): its three to five fields, each section's shown alone, and a
 * button to the full worksheet, remembered per worksheet. The two are never
 * on screen together: a full section holding an older copy of a quick field
 * would save it back over the newer one. A section save sends only the fields
 * it shows, and the API merges by field, so the quick form never clears the
 * rest.
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
import { ScrollBox } from "~/components/doc/scroll-box";
import { Button } from "~/components/ui/button";

/** "22:14" in the learner's own clock. */
function clockTime(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

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
  /** Number the sections' headings "1. …", as up's worksheets do (the default). */
  numbered?: boolean;
  /** Open on the full worksheet even when the kind has a quick version. */
  fullOnly?: boolean;
};

const FULL_KEY = (id: string) => `anytools.worksheet.full.${id}`;

/** The kind's quick fields, grouped into their sections, in the kind's order. */
export function quickSections(kind: WorksheetKind): WorksheetSection[] {
  const quick = kind.quick ?? [];
  return kind.sections
    .map((s) => ({ ...s, fields: s.fields.filter((f) => quick.some((q) => q.section === s.key && q.field === f.key)) }))
    .filter((s) => s.fields.length > 0);
}

export function WorksheetForm({
  worksheetId,
  kind,
  answers,
  revision: loaded,
  action,
  renderSectionExtra,
  extras,
  onValues,
  numbered = true,
  fullOnly = false,
}: FormProps) {
  const { t } = useTranslation("toolkit");
  // The newest revision any section's save returned. A section written by
  // someone else is still refused: the API compares per section.
  const [revision, setRevision] = useState(loaded);
  useEffect(() => setRevision((r) => (loaded > r ? loaded : r)), [loaded]);
  const quick = fullOnly ? [] : quickSections(kind);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem(FULL_KEY(worksheetId)) === "1") setFull(true);
  }, [worksheetId]);
  const showFull = (on: boolean) => {
    setFull(on);
    if (on) window.localStorage.setItem(FULL_KEY(worksheetId), "1");
    else window.localStorage.removeItem(FULL_KEY(worksheetId));
  };

  if (quick.length > 0 && !full) {
    const count = quick.reduce((n, s) => n + s.fields.length, 0);
    return (
      <div className="lp-quick-worksheet">
        <h2>{t("quick.title")}</h2>
        <p className="text-muted-foreground">{t("quick.lead", { count })}</p>
        {quick.map((s) => (
          <SectionForm
            key={s.key}
            number={0}
            heading="h3"
            worksheetId={worksheetId}
            section={s}
            stored={answers[s.key]}
            revision={revision}
            onSaved={(r) => setRevision((cur) => (r > cur ? r : cur))}
            action={action}
            extras={extras}
            onValues={onValues}
          />
        ))}
        <Button type="button" variant="outline" onClick={() => showFull(true)}>
          {t("quick.openFull", { count: kind.sections.length })}
        </Button>
      </div>
    );
  }
  return (
    <div>
      {quick.length > 0 ? (
        <Button type="button" variant="ghost" size="sm" className="mb-2" onClick={() => showFull(false)}>
          {t("quick.backToQuick")}
        </Button>
      ) : null}
      {kind.sections.map((s, i) => (
        <SectionForm
          key={s.key}
          number={numbered ? i + 1 : 0}
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
  /** The heading's number; 0 for none. */
  number: number;
  /** h3 inside the quick version, under its own h2. */
  heading?: "h2" | "h3";
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
  number,
  heading: Heading = "h2",
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
  // When this section was last saved, for its status line ("Saved · 22:14").
  const [savedAt, setSavedAt] = useState("");
  useEffect(() => {
    if (!result || result.section !== section.key) return;
    setSavedAt("ok" in result ? clockTime(new Date()) : "");
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

  // A section's own lines are one input table (I2), a row per line; each of
  // its tables follows as a table of its own, in the kind's order.
  const blocks: (WorksheetField | WorksheetField[])[] = [];
  for (const f of section.fields.filter((x) => shown(x, values))) {
    const last = blocks[blocks.length - 1];
    if (f.type === "table") blocks.push(f);
    else if (Array.isArray(last)) last.push(f);
    else blocks.push([f]);
  }

  return (
    <section aria-labelledby={headingId}>
      <Heading id={headingId}>{number ? `${number}. ${section.title}` : section.title}</Heading>
      {section.hint ? <p className="whitespace-pre-line text-muted-foreground">{section.hint}</p> : null}
      <fieldset onBlur={save} aria-labelledby={headingId}>
        {blocks.map((block) => {
          if (!Array.isArray(block)) {
            const f = block;
            const id = `ws-${section.key}-${f.key}`;
            return (
              <div key={f.key}>
                <p className="mb-0! font-medium">{f.label}</p>
                {f.hint ? <p className="mt-1! mb-0! text-sm text-muted-foreground">{f.hint}</p> : null}
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
          return (
            <div key={block[0]?.key} className="lp-field-table">
              <ScrollBox>
                <table>
                  <tbody>
                    {block.map((f) => {
                      const id = `ws-${section.key}-${f.key}`;
                      const boxed = ["text", "long", "choice", "date"].includes(f.type);
                      return (
                        <tr key={f.key}>
                          <th scope="row" className="w-[34%]">
                            <label htmlFor={id}>{f.label}</label>
                            {f.hint ? (
                              <span className="mt-1 block text-[13px] font-normal whitespace-pre-line">{f.hint}</span>
                            ) : null}
                          </th>
                          <td className={boxed ? undefined : "px-4! py-1!"}>
                            <FieldInput
                              field={f}
                              id={id}
                              value={values[f.key] as never}
                              onChange={(v, commit) => set(f.key, v, commit)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ScrollBox>
            </div>
          );
        })}
      </fieldset>
      {extra}
      {/* Drawn as the status line (I11), but a polite live region rather
          than role="status": a page holding a worksheet (the listening
          practice) has its own status, and every section has one of these. */}
      <p className="lp-status-line" aria-live="polite">
        {fetcher.state !== "idle" ? t("form.saving") : savedAt ? t("up.savedAt", { time: savedAt }) : ""}
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
