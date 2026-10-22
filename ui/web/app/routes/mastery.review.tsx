import { SessionProgress } from "~/components/mastery/session-progress";
import { Badge } from "~/components/doc/badge";
/**
 * mastery.review.tsx
 * The cross-path review (up-methods phase 12; up, threads/part-1/
 * 1-understanding.md §8): one card at a time from every active path, each
 * from a different module than the last, and a different path when one has
 * anything due. The server decides the order; this page shows each item's
 * path and module so the switch between subjects is visible.
 *
 * The cards are the per-path session's own. Answering a question moves the
 * URL to `?after=<point>`, which names the previous point for the next pick;
 * without it the server reads the last attempt, so a reload keeps the
 * alternation. Explain-backs stay on their path's own session: when one is
 * waiting there, this page says so and links to it.
 *
 * A loader that generates spends a model call, as the per-path session does.
 */
import { Link, useNavigate, useNavigation, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/mastery.review";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { reviewNext } from "~/lib/mastery.server";
import { QuestionCard } from "~/components/quiz/question-card";
import { LearnCard, TeachMeThis } from "~/components/mastery/learn-card";
import { PageHeader } from "~/components/ui/page-header";
import { answerKeepsTheCard } from "~/lib/card-answers";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Review") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// As in the per-path session: an answer must not swap the card before its
// verdict is read; Next moves on.
export function shouldRevalidate({ formAction, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (answerKeepsTheCard(formAction)) return false;
  return defaultShouldRevalidate;
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const after = new URL(request.url).searchParams.get("after");
  try {
    return { next: await reviewNext(user.id, after), stopKey: null, stopDetail: "" };
  } catch (error) {
    // As in the per-path session: 409s are states and a 502 is the learner's
    // own model failing; each gets a sentence, not an error page.
    if (error instanceof ApiError && (error.status < 500 || error.status === 502)) {
      const stopKey = error.code === "nothing_due" ? "review.nothingDue" : "session.stopped";
      return { next: null, stopKey, stopDetail: error.message };
    }
    throw error;
  }
}

export default function MasteryReview({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const { next } = loaderData;
  const busy = revalidator.state !== "idle" || navigation.state === "loading";

  return (
    <div className="lp-doc lp-measure">
      <Link
        to="/mastery"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("review.back")}
      </Link>
      <PageHeader title={t("review.title")} lede={t("review.lead")} />

      {next ? (
        <>
          {/* Path and module first, in the same place every time: the
              switch from one subject to the next is the point of this page. */}
          <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 border-y py-3 text-sm">
            <dt className="text-xs font-semibold text-xs text-faint">{t("review.path")}</dt>
            <dd data-testid="review-path"><Badge>{next.path_goal}</Badge></dd>
            <dt className="text-xs font-semibold mt-1 text-xs text-faint">{t("review.module")}</dt>
            <dd data-testid="review-module" className="mt-1">
              {next.module_name} · <span className="text-muted-foreground">{next.knowledge_point.name}</span>
            </dd>
          </dl>
          <p className="mt-2 text-xs text-faint tabular-nums">
            {t("session.remaining", { count: next.remaining_due })}
          </p>

          {next.explain_back_waiting ? (
            <p className="mt-3 text-sm leading-prose text-muted-foreground">
              {t("review.waiting", { path: next.path_goal })}{" "}
              <Link
                to={`/mastery/${next.path_id}/session`}
                className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
              >
                {t("review.openWaiting")}
              </Link>
            </p>
          ) : null}

          <SessionProgress cardKey={`${next.path_id}-${next.kind}-${next.question?.id ?? next.knowledge_point.id}`} remaining={next.remaining_due} />
          <div className="mt-4">
            {next.kind === "learn" && next.explanation ? (
              <LearnCard
                key={`learn-${next.knowledge_point.id}`}
                pointId={next.knowledge_point.id}
                pointName={next.knowledge_point.name}
                explanation={next.explanation}
                onContinue={() => revalidator.revalidate()}
              />
            ) : next.question ? (
              <div className="space-y-3">
                <QuestionCard
                  key={next.question.id}
                  question={next.question}
                  onAnswered={() =>
                    navigate(`/mastery/review?after=${encodeURIComponent(next.knowledge_point.id)}`, {
                      replace: true,
                    })
                  }
                />
                <TeachMeThis
                  key={`teach-${next.question.id}`}
                  pointId={next.knowledge_point.id}
                  pointName={next.knowledge_point.name}
                />
              </div>
            ) : null}
          </div>
          {busy ? (
            <p aria-live="polite" className="mt-3 text-xs text-muted-foreground">
              {t("session.loadingNext")}
            </p>
          ) : null}
        </>
      ) : (
        <div className="mt-6 lp-prose">
          <p>{t(loaderData.stopKey ?? "session.stopped")}</p>
          {loaderData.stopKey === "session.stopped" && loaderData.stopDetail ? (
            <p className="text-sm text-muted-foreground">{loaderData.stopDetail}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
