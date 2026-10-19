/**
 * quiz.bank.tsx
 * Every question the learner has generated, filterable by knowledge base and
 * by whether it has been answered. Unanswered questions stay answerable here;
 * answered ones show their answer, explanation and last verdict.
 *
 * Filters are URL search params, so a filtered bank is a link and the back
 * button works.
 */
import { Form, Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, X } from "lucide-react";
import type { Route } from "./+types/quiz.bank";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listKBs } from "~/lib/kb.server";
import { listBank } from "~/lib/quiz.server";
import { QUESTION_TYPES, type QuestionType } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { QuestionCard } from "~/components/quiz/question-card";
import { PageHeader } from "~/components/ui/page-header";
import { QuizTabs } from "~/components/quiz/quiz-tabs";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Question bank") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const kbId = url.searchParams.get("kb") ?? "";
  const answeredParam = url.searchParams.get("answered");
  const answered = answeredParam === "yes" ? true : answeredParam === "no" ? false : undefined;
  const typeParam = url.searchParams.get("type") ?? "";
  const type = (QUESTION_TYPES as readonly string[]).includes(typeParam) ? typeParam : undefined;

  const [{ knowledge_bases }, bank] = await Promise.all([
    listKBs(user.id),
    listBank(user.id, { kb_id: kbId || undefined, answered, type, limit: 100 }),
  ]);
  return {
    kbs: knowledge_bases.map((s) => ({ id: s.kb.id, name: s.kb.name })),
    entries: bank.questions,
    sources: bank.sources,
  };
}

export default function QuizBank({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const [params] = useSearchParams();
  const typeLabels: Record<QuestionType, string> = {
    mcq: t("types.mcq"),
    tf: t("types.tf"),
    short: t("types.short"),
    cloze: t("types.cloze"),
    written: t("types.written"),
  };

  return (
    <div className="lp-measure">
      <PageHeader title={t("bank.title")} lede={t("bank.lead")} />
      <QuizTabs />

      <Form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="lp-bank-kb" className="block text-sm font-medium">
            {t("bank.kb")}
          </label>
          <select
            id="lp-bank-kb"
            name="kb"
            defaultValue={params.get("kb") ?? ""}
            className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3 text-sm"
          >
            <option value="">{t("bank.allKbs")}</option>
            {loaderData.kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="lp-bank-answered" className="block text-sm font-medium">
            {t("bank.state")}
          </label>
          <select
            id="lp-bank-answered"
            name="answered"
            defaultValue={params.get("answered") ?? ""}
            className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3 text-sm"
          >
            <option value="">{t("bank.any")}</option>
            <option value="no">{t("bank.unanswered")}</option>
            <option value="yes">{t("bank.answered")}</option>
          </select>
        </div>
        <div>
          <label htmlFor="lp-bank-type" className="block text-sm font-medium">
            {t("bank.type")}
          </label>
          <select
            id="lp-bank-type"
            name="type"
            defaultValue={params.get("type") ?? ""}
            className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3 text-sm"
          >
            <option value="">{t("bank.allTypes")}</option>
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          {t("bank.filter")}
        </Button>
      </Form>

      {loaderData.entries.length === 0 ? (
        <p className="mt-8 lp-empty">{t("bank.empty")}</p>
      ) : (
        // A bank is for finding a question, so each is one row (the prompt and
        // what is known about it) that opens into the card to answer. Every
        // card open at once made six questions a page of empty answer boxes.
        <ol className="mt-8 divide-y border-y">
          {loaderData.entries.map((entry) => (
            <li key={entry.question.id}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-start gap-3 py-3 [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-serif text-base leading-snug group-hover:text-primary">
                      {entry.question.prompt}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs leading-ui text-muted-foreground">
                      <span>{typeLabels[entry.question.type]}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t(`difficulty.${entry.question.difficulty}`)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.module_name || entry.kb_name}</span>
                    </span>
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs leading-ui">
                    {entry.attempts > 0 ? (
                      <span
                        className={`inline-flex items-center gap-1 ${entry.last_correct ? "text-primary" : "text-destructive"}`}
                      >
                        {entry.last_correct ? (
                          <Check aria-hidden="true" className="size-3.5" />
                        ) : (
                          <X aria-hidden="true" className="size-3.5" />
                        )}
                        {entry.last_correct ? t("bank.lastRight") : t("bank.lastWrong")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("bank.notYet")}</span>
                    )}
                  </span>
                </summary>
                <div className="pb-5 pl-7">
                  {entry.attempts > 0 ? (
                    <p className="mb-2 text-xs text-muted-foreground">{t("bank.attempts", { count: entry.attempts })}</p>
                  ) : null}
                  <QuestionCard question={entry.question} sources={loaderData.sources} />
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
