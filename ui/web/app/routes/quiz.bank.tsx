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
import { Check, X } from "lucide-react";
import type { Route } from "./+types/quiz.bank";
import { requireUser } from "~/lib/auth.server";
import { listKBs } from "~/lib/kb.server";
import { listBank } from "~/lib/quiz.server";
import { QUESTION_TYPES, type QuestionType } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { QuestionCard } from "~/components/quiz/question-card";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Question bank · AnyTools" },
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
      <div className="lp-prose">
        <h1>{t("bank.title")}</h1>
        <p>{t("bank.lead")}</p>
      </div>
      <p className="mt-2 text-sm">
        <Link to="/quiz" className="text-primary underline underline-offset-4">
          {t("bank.generateMore")}
        </Link>
        {" · "}
        <Link to="/quiz/practice" className="text-primary underline underline-offset-4">
          {t("bank.practise")}
        </Link>
      </p>

      <Form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="lp-bank-kb" className="block text-sm font-medium">
            {t("bank.kb")}
          </label>
          <select
            id="lp-bank-kb"
            name="kb"
            defaultValue={params.get("kb") ?? ""}
            className="mt-1 min-h-11 rounded-md border border-control-border bg-background px-3 text-sm"
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
            className="mt-1 min-h-11 rounded-md border border-control-border bg-background px-3 text-sm"
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
            className="mt-1 min-h-11 rounded-md border border-control-border bg-background px-3 text-sm"
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
        <p className="mt-8 text-sm leading-prose text-muted-foreground">{t("bank.empty")}</p>
      ) : (
        <ol className="mt-8 space-y-4">
          {loaderData.entries.map((entry) => (
            <li key={entry.question.id}>
              <p className="mb-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span>{entry.kb_name}</span>
                {entry.module_name ? <span>{entry.module_name}</span> : null}
                {entry.attempts > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    {entry.last_correct ? (
                      <Check aria-hidden="true" className="size-3.5 text-primary" />
                    ) : (
                      <X aria-hidden="true" className="size-3.5 text-destructive" />
                    )}
                    {entry.last_correct ? t("bank.lastRight") : t("bank.lastWrong")} ·{" "}
                    {t("bank.attempts", { count: entry.attempts })}
                  </span>
                ) : (
                  <span>{t("bank.notYet")}</span>
                )}
              </p>
              <QuestionCard question={entry.question} sources={loaderData.sources} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
