import { useId } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { Source } from "~/hooks/use-turn-stream";
import type { AttemptResult, QuestionView } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { RichText } from "~/components/rich-text";
import { RubricList, RubricMarks } from "~/components/quiz/rubric-marks";

type ActionData = { result?: AttemptResult; errorKey?: string; errorDetail?: string };

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
  }[question.type];
  const difficultyLabel = {
    easy: t("difficulty.easy"),
    medium: t("difficulty.medium"),
    hard: t("difficulty.hard"),
  }[question.difficulty];

  return (
    <article aria-labelledby={`${ids}-prompt`} className="rounded-lg border bg-card p-4 sm:p-5">
      <p className="font-mono text-2xs uppercase tracking-wide text-faint">
        {typeLabel} · {difficultyLabel}
      </p>
      <h3 id={`${ids}-prompt`} className="mt-2 font-serif text-lg leading-snug">
        {question.prompt}
      </h3>

      {question.revealed && !answered ? (
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
                className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3 text-sm sm:w-auto"
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
          className="mt-1 w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm leading-prose focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      ) : (
        <input
          id={`${idBase}-answer`}
          name="user_answer"
          required
          maxLength={400}
          autoComplete="off"
          className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      )}
    </div>
  );
}

function answerText(question: QuestionView, answer: string): string {
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

  return (
    <div role="status" className="mt-4 space-y-3 border-t pt-4 text-sm leading-prose">
      {/* Icon and word both carry the verdict, so it survives a colour-blind
          read; colour is the third channel, not the only one. */}
      <p className={correct ? "flex items-center gap-2 font-medium text-primary" : "flex items-center gap-2 font-medium text-destructive"}>
        {correct ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-4" />}
        {correct ? t("verdict.correct") : t("verdict.incorrect")}
        {overridden ? <span className="font-normal text-muted-foreground">· {t("verdict.overridden")}</span> : null}
      </p>
      {attempt.judge.reason && attempt.judge.mode !== "user" ? (
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
