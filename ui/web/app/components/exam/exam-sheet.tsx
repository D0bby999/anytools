import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { ExamItemView, ExamView } from "~/lib/exam-types";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import { ExamTimer } from "~/components/exam/exam-timer";

export type SheetActionData = { ok: boolean; saved?: boolean; error?: string };

/** How long after the last keystroke an answer is saved. */
export const AUTOSAVE_MS = 1200;

const input =
  "mt-2 w-full rounded-md border border-control-border bg-card px-3 text-sm " +
  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

/**
 * The exam as one scrolling paper, answers saved as they are typed.
 *
 * Nothing is marked here: marking happens once, on submit, on the server. The
 * sheet only holds the answers, saves them a moment after each change, and
 * sends whatever is unsaved with the submit so the last keystroke counts.
 */
export function ExamSheet({ exam }: { exam: ExamView }) {
  const { t } = useTranslation("study");
  const saver = useFetcher<SheetActionData>();
  const submitter = useFetcher<SheetActionData>();
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(exam.items.map((it) => [it.id, it.answer])),
  );
  const [dirty, setDirty] = useState(false);

  // Every answer goes with every save: at most 60 of them, and a save that
  // failed is then made good by the next one.
  const payload = () =>
    JSON.stringify(exam.items.map((it) => ({ item_id: it.id, answer: answers[it.id] ?? "" })));

  // Save a moment after the last change, not on every keystroke: each change
  // restarts the wait.
  useEffect(() => {
    if (!dirty || saver.state !== "idle") return;
    const id = window.setTimeout(() => {
      saver.submit({ intent: "save", answers: payload() }, { method: "post" });
      setDirty(false);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(id);
    // payload reads the answers as they are when the wait ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, answers, saver.state]);

  const change = (id: string, value: string) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setDirty(true);
  };
  const unanswered = exam.items.filter((it) => (answers[it.id] ?? "").trim() === "").length;
  const submitting = submitter.state !== "idle";
  const partial = Boolean(exam.submitted_at);

  const submit = () => {
    if (!partial && unanswered > 0 && !window.confirm(t("exams.take.confirmUnanswered", { count: unanswered }))) return;
    setDirty(false);
    submitter.submit({ intent: "submit", answers: payload() }, { method: "post" });
  };

  const saveState =
    saver.data && !saver.data.ok
      ? t("exams.take.notSaved")
      : dirty || saver.state !== "idle"
        ? t("exams.take.saving")
        : t("exams.take.saved");

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-2 sm:mx-0 sm:px-0">
        {exam.deadline_at ? <ExamTimer deadline={exam.deadline_at} serverNow={exam.server_now} /> : <span />}
        <p role="status" className="text-xs text-muted-foreground">
          {partial ? t("exams.take.locked") : saveState}
        </p>
      </div>

      {partial ? (
        <p role="alert" className="mt-4 text-sm leading-prose text-warning">
          {t("exams.take.partial", { marked: exam.marked, total: exam.item_count })}
        </p>
      ) : null}

      <ol className="mt-2">
        {exam.items.map((item) => (
          <li key={item.id} className="border-b py-6">
            <SheetItem item={item} value={answers[item.id] ?? ""} disabled={partial} onChange={(v) => change(item.id, v)} />
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={submitting}>
          {submitting ? t("exams.take.marking") : partial ? t("exams.take.finishMarking") : t("exams.take.submit")}
        </Button>
        <p className="text-xs leading-snug text-muted-foreground">{t("exams.take.submitHint")}</p>
      </div>
      {submitter.data && !submitter.data.ok ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {submitter.data.error}
        </p>
      ) : null}
    </div>
  );
}

function SheetItem({
  item,
  value,
  disabled,
  onChange,
}: {
  item: ExamItemView;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation("study");
  const ids = useId();
  const q = item.question;
  const radio =
    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm " +
    "has-[:checked]:border-primary has-[:checked]:bg-primary-soft";

  return (
    <fieldset disabled={disabled} aria-labelledby={`${ids}-q`}>
      <p className="text-xs font-semibold text-faint">
        {t("exams.take.item", { number: item.number, count: item.points })}
      </p>
      <div id={`${ids}-q`} className="mt-2 font-serif text-lg leading-snug">
        <RichText text={q.prompt} sources={[]} />
      </div>
      {q.type === "mcq" ? (
        <div role="radiogroup" aria-labelledby={`${ids}-q`} className="mt-3 space-y-2">
          {q.options.map((o) => (
            <label key={o.label} className={radio}>
              <input
                type="radio"
                name={`${ids}-answer`}
                value={o.label}
                checked={value === o.label}
                onChange={() => onChange(o.label)}
                className="mt-1"
              />
              <span>
                <span className="font-mono text-xs font-semibold">{o.label}.</span> {o.body}
              </span>
            </label>
          ))}
        </div>
      ) : q.type === "tf" ? (
        <div role="radiogroup" aria-labelledby={`${ids}-q`} className="mt-3 flex flex-wrap gap-2">
          {(["true", "false"] as const).map((v) => (
            <label key={v} className={radio}>
              <input type="radio" name={`${ids}-answer`} value={v} checked={value === v} onChange={() => onChange(v)} className="mt-1" />
              {v === "true" ? t("card.true") : t("card.false")}
            </label>
          ))}
        </div>
      ) : q.type === "cloze" ? (
        <>
          <label htmlFor={`${ids}-a`} className="sr-only">
            {t("card.yourAnswer")}
          </label>
          <input
            id={`${ids}-a`}
            value={value}
            maxLength={400}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            className={`${input} min-h-11`}
          />
        </>
      ) : (
        <>
          <label htmlFor={`${ids}-a`} className="sr-only">
            {t("card.yourAnswer")}
          </label>
          <textarea
            id={`${ids}-a`}
            value={value}
            rows={q.type === "written" ? 10 : 3}
            maxLength={q.type === "written" ? 20000 : 4000}
            onChange={(e) => onChange(e.target.value)}
            className={`${input} py-2 leading-prose`}
          />
        </>
      )}
    </fieldset>
  );
}
