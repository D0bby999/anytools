import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Minus, X } from "lucide-react";
import type { ExamItemView, ExamView } from "~/lib/exam-types";
import { clock } from "~/lib/exam-types";
import type { Source } from "~/hooks/use-turn-stream";
import { RichText } from "~/components/rich-text";
import { RubricMarks, points } from "~/components/quiz/rubric-marks";

/**
 * The marked exam: the score, the time taken (and whether it was late), then
 * every item with what it earned, why, and the cited explanation.
 *
 * Each item's verdict is carried by an icon and a word, never by colour
 * alone. A partly right essay says so with its points, not a tick.
 */
export function ExamResult({ exam }: { exam: ExamView }) {
  const { t } = useTranslation("study");
  const score = exam.score ?? 0;
  const max = exam.max_score ?? 0;
  const missed = exam.items.filter((it) => it.correct === false).length;

  return (
    <div>
      <section aria-labelledby="lp-exam-score" className="mt-6 border-y py-4">
        <h2 id="lp-exam-score" className="lp-kicker">
          {t("exams.result.title")}
        </h2>
        <p className="mt-2 font-serif text-3xl">
          {t("exams.result.score", { score: points(score), max: points(max) })}
          <span className="ml-3 font-sans text-base text-muted-foreground">
            {max > 0 ? `${Math.round((score / max) * 100)}%` : ""}
          </span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {exam.taken_seconds !== undefined ? t("exams.result.taken", { time: clock(exam.taken_seconds) }) : null}
          {exam.time_limit_minutes ? ` · ${t("exams.result.limit", { count: exam.time_limit_minutes })}` : ""}
        </p>
        {exam.late ? (
          <p role="note" className="mt-1 text-sm font-medium text-warning">
            {t("exams.result.late")}
          </p>
        ) : null}
        {missed > 0 ? (
          <p className="mt-3 text-sm">
            {t("exams.result.practise", { count: missed })}{" "}
            <Link to="/quiz/practice" className="text-primary underline underline-offset-4">
              {t("exams.result.practiseLink")}
            </Link>
          </p>
        ) : null}
      </section>

      <ol>
        {exam.items.map((item) => (
          <li key={item.id} className="border-b py-6">
            <ResultItem item={item} sources={exam.sources} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ResultItem({ item, sources }: { item: ExamItemView; sources: Source[] }) {
  const { t } = useTranslation("study");
  const q = item.question;
  const full = item.awarded !== undefined && item.awarded >= item.points;
  const none = !item.awarded;
  const verdict = full ? t("exams.result.full") : none ? t("exams.result.none") : t("exams.result.partial");
  const answerText = (answer: string) => {
    if (q.type === "mcq") {
      const option = q.options.find((o) => o.label === answer);
      return option ? `${option.label}. ${option.body}` : answer;
    }
    if (q.type === "tf") return answer === "true" ? t("card.true") : answer === "false" ? t("card.false") : answer;
    return answer;
  };

  return (
    <article className="text-sm leading-prose">
      <p className="flex flex-wrap items-center gap-2 font-mono text-2xs uppercase tracking-wide text-faint">
        {t("exams.take.item", { number: item.number, count: item.points })}
      </p>
      <div className="mt-2 font-serif text-lg leading-snug">
        <RichText text={q.prompt} sources={[]} />
      </div>
      <p className={full ? "mt-3 flex items-center gap-2 font-medium text-primary" : none ? "mt-3 flex items-center gap-2 font-medium text-destructive" : "mt-3 flex items-center gap-2 font-medium text-warning"}>
        {full ? <Check aria-hidden="true" className="size-4" /> : none ? <X aria-hidden="true" className="size-4" /> : <Minus aria-hidden="true" className="size-4" />}
        {verdict}
        <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
          {t("rubric.of", { awarded: points(item.awarded ?? 0), total: points(item.points) })}
        </span>
      </p>
      <div className="mt-2 space-y-2">
        <div>
          <p className="font-medium">{t("exams.result.yours")}</p>
          {!item.answer.trim() ? (
            <p className="text-muted-foreground">{t("exams.result.blank")}</p>
          ) : q.type === "mcq" || q.type === "tf" ? (
            <p>{answerText(item.answer)}</p>
          ) : (
            <RichText text={item.answer} sources={[]} listen={false} />
          )}
        </div>
        {item.judge?.reason ? <p className="text-muted-foreground">{item.judge.reason}</p> : null}
        {item.judge?.criteria && item.judge.mode === "rubric" ? <RubricMarks criteria={item.judge.criteria} /> : null}
        {q.answer ? (
          <div>
            <p className="font-medium">{t("card.answer")}</p>
            {q.type === "mcq" || q.type === "tf" ? (
              <p>{answerText(q.answer)}</p>
            ) : (
              <RichText text={q.answer} sources={[]} listen={false} />
            )}
          </div>
        ) : null}
        {q.explanation ? <RichText text={q.explanation} sources={sources} /> : null}
      </div>
    </article>
  );
}
