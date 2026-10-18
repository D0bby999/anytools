/**
 * writing-diagnosis.tsx
 * The writing evidence card's per-pass diagnosis (up-methods phase 4), shown
 * under its five-pass table (up: docs/en/templates/writing-evidence.md §6).
 *
 * up's process for AI in writing (threads/part-1/6-writing.md §8): the
 * learner's own draft first, then a diagnosis before any rewrite, then the
 * learner rewrites. So a diagnosis here is at most three issues, each quoting
 * the draft with its basis, its confidence and how it might be wrong — and
 * nothing else. "Use this quote as before" copies a quote into that pass's
 * Before cell; nothing ever copies model text into After.
 *
 * The model's words are rendered as plain text.
 */
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { WorksheetKind, WorksheetSection, WritingDiagnosis as Diagnosis } from "~/lib/worksheet-types";
import type { SectionEditor } from "~/components/worksheet/worksheet-form";
import { Button } from "~/components/ui/button";

export const WRITING_EVIDENCE = "writing_evidence";
// The card's §6 table, and the cell a quote may be copied into.
const PASSES_SECTION = "passes";
const PASSES_FIELD = "passes";
const BEFORE = "before";

/** What the page's action answers a diagnose request with. */
export type DiagnoseResult = { pass: number; diagnosis: Diagnosis } | { pass: number; diagnoseError: string };

/**
 * The form's section extra for a writing evidence card: the diagnosis under
 * §6, nothing elsewhere. Undefined for any other kind.
 */
export function writingDiagnosisExtra(kind: WorksheetKind, worksheetId: string, diagnoses: Diagnosis[]) {
  if (kind.kind !== WRITING_EVIDENCE) return undefined;
  return (section: WorksheetSection, editor: SectionEditor) =>
    section.key === PASSES_SECTION ? (
      <WritingDiagnosisPanel worksheetId={worksheetId} section={section} diagnoses={diagnoses} editor={editor} />
    ) : null;
}

type PanelProps = {
  worksheetId: string;
  section: WorksheetSection;
  diagnoses: Diagnosis[];
  editor: SectionEditor;
};

export function WritingDiagnosisPanel({ worksheetId, section, diagnoses, editor }: PanelProps) {
  const { t } = useTranslation("toolkit");
  const passes = section.fields.find((f) => f.key === PASSES_FIELD)?.rows ?? [];
  return (
    <section aria-labelledby="ws-diagnosis" className="mt-6">
      <h3 id="ws-diagnosis" className="lp-kicker">
        {t("writingDiagnosis.title")}
      </h3>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("writingDiagnosis.lead")}</p>
      <ol className="mt-3 border-t">
        {passes.map((row, i) => (
          <PassDiagnosis
            key={row.key}
            worksheetId={worksheetId}
            pass={i + 1}
            row={row.key}
            label={row.label}
            stored={diagnoses.find((d) => d.pass === i + 1)}
            editor={editor}
          />
        ))}
      </ol>
    </section>
  );
}

type PassProps = {
  worksheetId: string;
  pass: number;
  row: string;
  label: string;
  stored: Diagnosis | undefined;
  editor: SectionEditor;
};

function PassDiagnosis({ worksheetId, pass, row, label, stored, editor }: PassProps) {
  const { t } = useTranslation("toolkit");
  const fetcher = useFetcher<DiagnoseResult>({ key: `diagnose-${worksheetId}-${pass}` });
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const diagnosis = result && "diagnosis" in result ? result.diagnosis : stored;
  const error = result && "diagnoseError" in result ? result.diagnoseError : null;

  const copyQuote = (quote: string) => {
    const before = editor.cell(PASSES_FIELD, row, BEFORE);
    const current = typeof before === "string" ? before.trim() : "";
    // A quote is added to what the learner wrote there, never over it.
    editor.setCell(PASSES_FIELD, row, BEFORE, current ? `${current}\n\n${quote}` : quote);
  };

  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("writingDiagnosis.pass", { n: pass, label })}</span>
        {!diagnosis ? (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="diagnose" />
            <input type="hidden" name="pass" value={pass} />
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {busy ? t("writingDiagnosis.working") : t("writingDiagnosis.diagnose")}
            </Button>
          </fetcher.Form>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {diagnosis ? (
        <div className="mt-2">
          <p className="font-mono text-xs text-faint">
            {t("writingDiagnosis.by", {
              model: diagnosis.model || t("writingDiagnosis.unknownModel"),
              date: diagnosis.created_at.slice(0, 10),
            })}
          </p>
          {diagnosis.issues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("writingDiagnosis.none")}</p>
          ) : (
            <ul className="mt-2 space-y-4" aria-label={t("writingDiagnosis.issues", { n: pass })}>
              {diagnosis.issues.map((issue, i) => (
                <li key={i} className="rounded-md border p-3">
                  <blockquote className="whitespace-pre-wrap break-words bg-muted px-2 py-1 font-serif text-sm">
                    {issue.quote}
                  </blockquote>
                  <p className="mt-2 text-sm">{issue.problem}</p>
                  <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
                    <dt className="font-mono text-xs uppercase text-faint">{t("writingDiagnosis.basis")}</dt>
                    <dd>{issue.basis}</dd>
                    <dt className="font-mono text-xs uppercase text-faint">{t("writingDiagnosis.confidence")}</dt>
                    <dd>{t(`writingDiagnosis.levels.${issue.confidence}`, { defaultValue: issue.confidence })}</dd>
                    <dt className="font-mono text-xs uppercase text-faint">{t("writingDiagnosis.mightBeWrong")}</dt>
                    <dd>{issue.might_be_wrong}</dd>
                  </dl>
                  <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => copyQuote(issue.quote)}>
                    {t("writingDiagnosis.useQuote")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}
