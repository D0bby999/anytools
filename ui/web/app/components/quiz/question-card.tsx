import { useId } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { Source } from "~/hooks/use-turn-stream";
import { promptLine, type AttemptResult, type QuestionView } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import { RubricList, RubricMarks } from "~/components/quiz/rubric-marks";
import { MathField } from "~/components/quiz/math-field";
import { CodeExercise, declaredTests } from "~/components/quiz/code-exercise";

type ActionData = {
  result?: AttemptResult;
  errorKey?: string;
  errorDetail?: string;
  /** A maths answer the checker could not read: nothing was recorded. */
  unreadable?: { answer: string; attribution: string };
};

/**
 * One question, answerable in place.
 *
 * Posts to the `quiz/questions/:id` resource route, so the quiz page, the bank
 * and the mastery session render the same card and nothing about answering
 * differs between them. The answer and explanation are not in the page until
 * the API returns them with the verdict.
 *
 * `revealed` seeds a card that was answered before this page loaded (the bank):
 * it shows the stored answer and explanation and offers no form.
 */
export function QuestionCard({
  question,
  sources = [],
  onAnswered,
}: {
  question: QuestionView;
  sources?: Source[];
  onAnswered?: (result: AttemptResult) => void;
}) {
  const { t } = useTranslation("study");
  const fetcher = useFetcher<ActionData>();
  const overrideFetcher = useFetcher<ActionData>();
  const ids = useId();

  const result = overrideFetcher.data?.result ?? fetcher.data?.result;
  const unreadable = fetcher.state === "idle" ? fetcher.data?.unreadable : undefined;
  const error = overrideFetcher.data?.errorKey ? overrideFetcher.data : fetcher.data;
  const answered = Boolean(result);
  const submitting = fetcher.state !== "idle";
  const action = `/quiz/questions/${question.id}`;

  const typeLabel = {
    mcq: t("types.mcq"),
    tf: t("types.tf"),
    short: t("types.short"),
    cloze: t("types.cloze"),
    written: t("types.written"),
    code: t("types.code"),
  }[question.type];
  const difficultyLabel = {
    easy: t("difficulty.easy"),
    medium: t("difficulty.medium"),
    hard: t("difficulty.hard"),
  }[question.difficulty];

  return (
    <article aria-labelledby={`${ids}-prompt`} className="rounded-lg border bg-card p-4 sm:p-5">
      <p className="text-xs font-semibold text-faint">
        {typeLabel} · {difficultyLabel}
      </p>
      <h3 id={`${ids}-prompt`} className="mt-2 font-serif text-lg leading-snug">
        {promptLine(question)}
      </h3>

      {/* A code exercise is answered by its runs; once answered, the verdict says the rest. */}
      {question.code && answered ? null : question.code && !question.revealed ? (
        <CodeExercise
          question={{ ...question, code: question.code }}
          disabled={submitting}
          onSubmit={(code, run) =>
            fetcher.submit(
              { intent: "attempt", user_answer: code, self_attribution: "", tests: JSON.stringify(run.results) },
              { method: "post", action },
            )
          }
        />
      ) : question.revealed && !answered ? (
        <Revealed question={question} sources={sources} />
      ) : (
        <fetcher.Form
          method="post"
          action={action}
          className="mt-4"
          onSubmit={(event) => {
            if (answered) event.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="attempt" />
          {question.type === "short" || question.type === "cloze" ? (
            <input type="hidden" name="ask_if_unreadable" value="1" />
          ) : null}
          <fieldset disabled={answered || submitting} className="space-y-4">
            <legend className="sr-only">{t("card.yourAnswer")}</legend>
            <AnswerInput question={question} idBase={ids} />

            <div>
              <label htmlFor={`${ids}-attr`} className="block text-sm font-medium">
                {t("card.howSure")}
              </label>
              <select
                id={`${ids}-attr`}
                name="self_attribution"
                defaultValue=""
                className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm sm:w-auto"
              >
                <option value="">{t("attribution.none")}</option>
                <option value="confident">{t("attribution.confident")}</option>
                <option value="guessed">{t("attribution.guessed")}</option>
                <option value="knowledge_gap">{t("attribution.knowledge_gap")}</option>
              </select>
            </div>

            {!answered ? (
              <Button type="submit" disabled={submitting}>
                {submitting ? t("card.checking") : t("card.check")}
              </Button>
            ) : null}
          </fieldset>
        </fetcher.Form>
      )}

      {unreadable && !answered ? (
        <div role="alert" className="mt-3 rounded-md border px-3 py-2 text-sm leading-snug">
          <p>{t("card.unreadable")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={submitting}
            onClick={() =>
              fetcher.submit(
                { intent: "attempt", user_answer: unreadable.answer, self_attribution: unreadable.attribution },
                { method: "post", action },
              )
            }
          >
            {t("card.sendAsText")}
          </Button>
        </div>
      ) : null}

      {result ? (
        <Verdict
          question={question}
          result={result}
          onAnswered={onAnswered}
          override={(isCorrect) =>
            overrideFetcher.submit(
              { intent: "override", attemptId: result.attempt.id, isCorrect: String(isCorrect) },
              { method: "post", action },
            )
          }
          overriding={overrideFetcher.state !== "idle"}
          overridden={Boolean(result.attempt.overridden_at)}
        />
      ) : null}

      {error?.errorKey ? (
        <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
          {t(error.errorKey)}
          {error.errorDetail ? ` ${error.errorDetail}` : ""}
        </p>
      ) : null}
    </article>
  );
}

function AnswerInput({ question, idBase }: { question: QuestionView; idBase: string }) {
  const { t } = useTranslation("study");
  const radio =
    "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm " +
    "has-[:checked]:border-primary has-[:checked]:bg-primary-soft";

  if (question.type === "mcq") {
    return (
      <div role="radiogroup" aria-labelledby={`${idBase}-prompt`} className="space-y-2">
        {question.options.map((option) => (
          <label key={option.label} className={radio}>
            <input type="radio" name="user_answer" value={option.label} required className="mt-1" />
            <span>
              <span className="font-mono text-xs font-semibold">{option.label}.</span> {option.body}
            </span>
          </label>
        ))}
      </div>
    );
  }
  if (question.type === "tf") {
    return (
      <div role="radiogroup" aria-labelledby={`${idBase}-prompt`} className="flex flex-wrap gap-2">
        <label className={radio}>
          <input type="radio" name="user_answer" value="true" required className="mt-1" />
          {t("card.true")}
        </label>
        <label className={radio}>
          <input type="radio" name="user_answer" value="false" required className="mt-1" />
          {t("card.false")}
        </label>
      </div>
    );
  }
  const box =
    "min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";
  if (question.math) {
    return (
      <div>
        <label htmlFor={`${idBase}-answer`} className="block text-sm font-medium">
          {t("card.yourAnswer")}
        </label>
        <p id={`${idBase}-mathhint`} className="mt-0.5 text-xs text-muted-foreground">
          {t("card.mathHint")}
        </p>
        <MathField
          id={`${idBase}-answer`}
          name="user_answer"
          label={t("card.yourAnswer")}
          describedBy={`${idBase}-mathhint`}
          className={`${box} py-2 text-base text-foreground`}
        />
      </div>
    );
  }
  return (
    <div>
      <label htmlFor={`${idBase}-answer`} className="block text-sm font-medium">
        {t("card.yourAnswer")}
      </label>
      {question.type === "short" || question.type === "written" ? (
        <textarea
          id={`${idBase}-answer`}
          name="user_answer"
          required
          // A written answer is an essay or a worked calculation, marked by
          // its rubric: it gets the room one needs.
          rows={question.type === "written" ? 10 : 3}
          maxLength={question.type === "written" ? 20000 : 4000}
          className="mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      ) : (
        <input
          id={`${idBase}-answer`}
          name="user_answer"
          required
          maxLength={400}
          autoComplete="off"
          className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      )}
    </div>
  );
}

function answerText(question: QuestionView, answer: string): string {
  // A code exercise's solution is code: shown as a Python block.
  if (question.type === "code") return "```python\n" + answer.trimEnd() + "\n```";
  if (question.type !== "mcq") return answer;
  const option = question.options.find((o) => o.label === answer);
  return option ? `${option.label}. ${option.body}` : answer;
}

/**
 * The answer and, below it, the explanation are the model's text, so both are
 * rendered Markdown and math (components/rich-text.tsx); a quiz on a maths
 * chapter would otherwise show its answer as `$\frac{1}{2}$`.
 */
function AnswerBody({ question, answer }: { question: QuestionView; answer: string }) {
  const { t } = useTranslation("study");
  return (
    <div>
      <p className="font-medium">{t("card.answer")}</p>
      <RichText text={answerText(question, answer)} sources={[]} />
    </div>
  );
}

function Revealed({ question, sources }: { question: QuestionView; sources: Source[] }) {
  const { t } = useTranslation("study");
  return (
    <div className="mt-4 space-y-2 border-t pt-4 text-sm leading-prose">
      <AnswerBody question={question} answer={question.answer ?? ""} />
      {question.rubric ? <RubricList rubric={question.rubric} /> : null}
      {question.explanation ? <RichText text={question.explanation} sources={sources} /> : null}
    </div>
  );
}

function Verdict({
  question,
  result,
  override,
  overriding,
  overridden,
  onAnswered,
}: {
  question: QuestionView;
  result: AttemptResult;
  override: (isCorrect: boolean) => void;
  overriding: boolean;
  overridden: boolean;
  onAnswered?: (result: AttemptResult) => void;
}) {
  const { t } = useTranslation("study");
  const { attempt } = result;
  const correct = attempt.is_correct;
  const almost = correct && attempt.judge.mode === "math" && attempt.judge.almost === true;
  const testsRun = attempt.judge.mode === "tests" ? (attempt.judge.tests ?? []) : null;
  const math = attempt.judge.mode === "math";

  return (
    <div role="status" className="mt-4 space-y-3 border-t pt-4 text-sm leading-prose">
      {/* Icon and word both carry the verdict, so it survives a colour-blind
          read; colour is the third channel, not the only one. */}
      <p className={correct ? "flex items-center gap-2 font-medium text-primary" : "flex items-center gap-2 font-medium text-destructive"}>
        {correct ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-4" />}
        {almost ? t("verdict.almost") : correct ? t("verdict.correct") : t("verdict.incorrect")}
        {overridden ? <span className="font-normal text-muted-foreground">· {t("verdict.overridden")}</span> : null}
      </p>
      {testsRun ? (
        <p className="text-muted-foreground">
          {t("code.summary", {
            passed: testsRun.filter((r) => r.passed).length,
            total: question.code ? declaredTests(question.code.tests).length : testsRun.length,
          })}
        </p>
      ) : math ? (
        // Marked by value in Go: the reasons are said here, in the learner's language.
        <p className="text-muted-foreground">
          {almost
            ? t("verdict.mathAlmost")
            : correct
              ? sameText(attempt.user_answer, result.answer)
                ? null
                : t("verdict.mathEqual", { answer: attempt.user_answer, recorded: result.answer })
              : t("verdict.mathWrong")}
        </p>
      ) : attempt.judge.reason && attempt.judge.mode !== "user" ? (
        <p className="text-muted-foreground">{attempt.judge.reason}</p>
      ) : null}
      {attempt.judge.criteria && attempt.judge.mode === "rubric" ? (
        <RubricMarks criteria={attempt.judge.criteria} />
      ) : null}

      <AnswerBody question={question} answer={result.answer} />
      {result.explanation ? <RichText text={result.explanation} sources={result.sources} /> : null}

      {result.scheduled ? (
        <p className="text-muted-foreground">
          {result.scheduled.rating === "again" ? t("verdict.backSoon") : t("verdict.scheduled")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!overridden ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={overriding}
            onClick={() => override(!correct)}
          >
            {correct ? t("verdict.markWrong") : t("verdict.markRight")}
          </Button>
        ) : null}
        {onAnswered ? (
          <Button type="button" size="sm" onClick={() => onAnswered(result)}>
            {t("verdict.next")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The same text but for spaces and a $…$ wrapper: no need to say the forms differ. */
function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^\$+|\$+$/g, "").replace(/\s+/g, "");
  return norm(a) === norm(b);
}
