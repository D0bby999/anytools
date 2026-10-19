/**
 * mastery.$pathId.session.tsx
 * One card at a time: due reviews first, then the weakest module. The loader
 * asks the API what is next — a question, an explanation of a point never yet
 * answered correctly (learn), or an explain-back for a concept or design point
 * the learner has just got right. Finishing a card revalidates the loader,
 * which is the whole session loop.
 *
 * A loader that generates (when nothing unanswered is banked for the chosen
 * point, or a point is taught for the first time) spends a model call — the
 * same call pressing Next would make, and only then.
 */
import { Link, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/mastery.$pathId.session";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { nextQuestion } from "~/lib/mastery.server";
import { QuestionCard } from "~/components/quiz/question-card";
import { LearnCard, TeachMeThis } from "~/components/mastery/learn-card";
import { ExplainBackCard } from "~/components/mastery/explain-back-card";
import { PageHeader } from "~/components/ui/page-header";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Study · AnyLearn" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    return { next: await nextQuestion(user.id, params.pathId), stopKey: null, stopDetail: "" };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    // 409s are states, not failures: nothing due, no plan yet, no model, or
    // material that supports no question. A 502 is the learner's own model
    // failing. Each gets a sentence beside the way back, not an error page.
    if (error instanceof ApiError && (error.status < 500 || error.status === 502)) {
      const stopKey =
        error.code === "nothing_due" ? "session.nothingDue" : error.code === "not_approved" ? "session.notPlanned" : "session.stopped";
      return { next: null, stopKey, stopDetail: error.message };
    }
    throw error;
  }
}

export default function MasterySession({ loaderData, params }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const revalidator = useRevalidator();
  const { next } = loaderData;

  return (
    <div className="lp-measure">
      <Link
        to={`/mastery/${params.pathId}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("session.back")}
      </Link>

      {next ? (
        <>
          <PageHeader
            title={next.knowledge_point.name}
            className="mt-2 mb-0"
            lede={`${next.module_name}${next.due ? ` · ${t("session.review")}` : ""}`}
          >
            <p className="mt-3 text-sm tabular-nums">
              <span className={next.remaining_due > 0 ? "lp-highlight" : undefined}>
                {t("session.remaining", { count: next.remaining_due })}
              </span>
            </p>
          </PageHeader>
          <div className="mt-4">
            {/* Keyed by what they show: the next card is a new card with no
                leftover answer or verdict from the last one. */}
            {next.kind === "learn" && next.explanation ? (
              <LearnCard
                key={`learn-${next.knowledge_point.id}`}
                pointId={next.knowledge_point.id}
                pointName={next.knowledge_point.name}
                explanation={next.explanation}
                onContinue={() => revalidator.revalidate()}
              />
            ) : next.kind === "explain_back" ? (
              <ExplainBackCard
                key={`explain-${next.knowledge_point.id}-${next.last_explain_back?.id ?? ""}`}
                pointId={next.knowledge_point.id}
                pointName={next.knowledge_point.name}
                prompt={next.prompt ?? ""}
                lastAttempt={next.last_explain_back}
                onContinue={() => revalidator.revalidate()}
              />
            ) : next.question ? (
              <div className="space-y-3">
                <QuestionCard
                  key={next.question.id}
                  question={next.question}
                  onAnswered={() => revalidator.revalidate()}
                />
                <TeachMeThis
                  key={`teach-${next.question.id}`}
                  pointId={next.knowledge_point.id}
                  pointName={next.knowledge_point.name}
                />
              </div>
            ) : null}
          </div>
          {revalidator.state !== "idle" ? (
            <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
              {t("session.loadingNext")}
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-4 lp-prose">
          <p>{t(loaderData.stopKey ?? "session.stopped")}</p>
          {loaderData.stopKey === "session.stopped" && loaderData.stopDetail ? (
            <p className="text-sm text-muted-foreground">{loaderData.stopDetail}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
