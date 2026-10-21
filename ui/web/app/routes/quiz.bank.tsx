import { Badge } from "~/components/doc/badge";
import { Flyout } from "~/components/doc/flyout";
import { DateText } from "~/components/ui/date-text";
/**
 * quiz.bank.tsx
 * Every question the learner has generated, filterable by knowledge base and
 * by whether it has been answered. Unanswered questions stay answerable here;
 * answered ones show their answer, explanation and last verdict.
 *
 * Filters are URL search params, so a filtered bank is a link and the back
 * button works.
 */
import { Form, Link, useSearchParams, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/quiz.bank";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { listKBs } from "~/lib/kb.server";
import { listBank } from "~/lib/quiz.server";
import { promptLine, QUESTION_TYPES, type QuestionType } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { QuestionCard } from "~/components/quiz/question-card";
import { PageHeader } from "~/components/ui/page-header";
import { QuizTabs } from "~/components/quiz/quiz-tabs";
import { useOverflowTabStop } from "~/components/doc/scroll-box";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Question bank") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

// Under "Unanswered", answering a question would reload the list without it,
// and its card would vanish with the verdict before it is read. The list is
// left as it is until the filter is applied again.
export function shouldRevalidate({ formAction, currentUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formAction?.startsWith("/quiz/questions/") && currentUrl.searchParams.get("answered") === "no") return false;
  return defaultShouldRevalidate;
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
  const [scrollTable, tableTabIndex] = useOverflowTabStop<HTMLTableElement>();
  const [params] = useSearchParams();
  const typeLabels: Record<QuestionType, string> = {
    mcq: t("types.mcq"),
    tf: t("types.tf"),
    short: t("types.short"),
    cloze: t("types.cloze"),
    written: t("types.written"),
    code: t("types.code"),
  };

  return (
    <div className="lp-doc lp-measure">
      <PageHeader title={t("bank.title")} lede={t("bank.lead")} />
      <QuizTabs />

      <Form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <Flyout label={t("bank.kb")} buttonClassName="h-10" menuClassName="left-0 right-auto top-full">
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
        </Flyout>
        <Flyout label={t("bank.state")} buttonClassName="h-10" menuClassName="left-0 right-auto top-full">
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
        </Flyout>
        <Flyout label={t("bank.type")} buttonClassName="h-10" menuClassName="left-0 right-auto top-full">
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
        </Flyout>
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
        // The list's heading is for screen readers: each card's prompt is an
        // h3, and an h3 straight under the page's h1 skips a level (axe).
        <>
          <h2 className="sr-only">{t("bank.listHeading")}</h2>
          <table ref={scrollTable} tabIndex={tableTabIndex} className="lp-table mt-8">
            <caption className="sr-only">{t("bank.listHeading")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("practise.question")}</th>
                <th scope="col">{t("bank.type")}</th>
                <th scope="col">{t("bank.kb")}</th>
                <th scope="col">{t("bank.state")}</th>
                <th scope="col">{t("practise.lastAttempt")}</th>
              </tr>
            </thead>
            {loaderData.entries.map((entry, index) => (
              <tbody key={entry.question.id}>
                <tr>
                  <th scope="row">{promptLine(entry.question)}</th>
                  <td>
                    <Badge>{typeLabels[entry.question.type]}</Badge>
                  </td>
                  <td>{entry.module_name || entry.kb_name}</td>
                  <td>
                    {entry.attempts > 0 ? (
                      <Badge type={entry.last_correct ? "tip" : "danger"}>
                        {entry.last_correct ? t("bank.lastRight") : t("bank.lastWrong")}
                      </Badge>
                    ) : (
                      t("bank.notYet")
                    )}
                  </td>
                  <td className="whitespace-nowrap">{entry.last_attempt ? <DateText iso={entry.last_attempt} /> : t("bank.notYet")}</td>
                </tr>
                <tr className="lp-table-detail">
                  <td colSpan={5}>
                    <details className="lp-details">
                      <summary>{t("practise.openQuestion")}</summary>
                      {entry.attempts > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("bank.attempts", { count: entry.attempts })}
                        </p>
                      ) : null}
                      <QuestionCard
                        question={entry.question}
                        sources={loaderData.sources}
                        position={index + 1}
                        total={loaderData.entries.length}
                      />
                    </details>
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </>
      )}
    </div>
  );
}
