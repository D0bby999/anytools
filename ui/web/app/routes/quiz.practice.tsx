/**
 * quiz.practice.tsx
 * Practise your mistakes (learning depth, phase 1): the questions the learner
 * got wrong, one at a time, unrevealed.
 *
 * It is the missed question itself, not a new one — a mistake is fixed by
 * getting THAT right again — and the answer goes through the ordinary attempt
 * route, so the schedule, overrides and evidence work as anywhere else. The
 * API decides what is due; this page only walks the queue it was given.
 *
 * `?kb=` and `?path=` narrow the queue, so Mastery can link to a path's own.
 */
import { useState } from "react";
import { Link, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/quiz.practice";
import { requireUser } from "~/lib/auth.server";
import { listPractice } from "~/lib/quiz.server";
import { Button } from "~/components/ui/button";
import { QuestionCard } from "~/components/quiz/question-card";
import { PageHeader } from "~/components/ui/page-header";
import { QuizTabs } from "~/components/quiz/quiz-tabs";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Practise your mistakes · AnyLearn" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const queue = await listPractice(user.id, {
    kb_id: url.searchParams.get("kb") || undefined,
    path_id: url.searchParams.get("path") || undefined,
  });
  return { items: queue.items, remaining: queue.remaining };
}

/**
 * An answer must not reload the queue. The answered mistake leaves it (a
 * mistake answered right today is not practisable again today), so a reload
 * would remove the card, verdict and all, before the learner has read it. The
 * session walks the queue it started with; "Check for more" reloads it.
 */
export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction?.startsWith("/quiz/questions/")) return false;
  return defaultShouldRevalidate;
}

export default function QuizPractice({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const revalidator = useRevalidator();
  const [index, setIndex] = useState(0);
  const { items, remaining } = loaderData;
  const current = items[index];

  // The card's own "Next question" moves on, after any override the learner
  // wanted to make to the verdict.
  const next = () => setIndex((i) => i + 1);
  const again = () => {
    setIndex(0);
    void revalidator.revalidate();
  };

  return (
    <div className="lp-measure">
      <PageHeader title={t("practice.title")} lede={t("practice.lead")} />
      <QuizTabs />

      {items.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm leading-prose text-muted-foreground">{t("practice.empty")}</p>
          <p className="mt-3 text-sm">
            <Link to="/quiz/bank" className="text-primary underline underline-offset-4">
              {t("practice.toBank")}
            </Link>
          </p>
        </div>
      ) : current ? (
        <section aria-labelledby="lp-practice-current" className="mt-8">
          <h2 id="lp-practice-current" className="lp-section flex flex-wrap gap-x-3">
            <span>{t("practice.left", { count: Math.max(remaining - index, 1) })}</span>
            <span className="text-muted-foreground">
              {current.kb_name}
              {" · "}
              {t(`practice.status.${current.status}`, { count: current.misses })}
            </span>
          </h2>
          <div className="mt-3">
            <QuestionCard key={current.question.id} question={current.question} onAnswered={next} />
          </div>
        </section>
      ) : (
        <div className="mt-8">
          <p role="status" className="text-sm leading-prose">
            {t("practice.done")}
          </p>
          <Button type="button" variant="outline" className="mt-3" onClick={again} disabled={revalidator.state !== "idle"}>
            {t("practice.again")}
          </Button>
        </div>
      )}
    </div>
  );
}
