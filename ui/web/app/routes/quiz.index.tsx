import { QuickStart } from "~/components/doc/quick-start";
/**
 * quiz.index.tsx
 * Generate questions from one knowledge base, and answer them in place.
 *
 * The generated set is the action's return value, not a list re-read from the
 * bank: it is "the questions I just asked for", and every one of them is also
 * in the bank the moment the API stored it.
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/quiz.index";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createKB, listKBs } from "~/lib/kb.server";
import { addStarter, generateQuiz } from "~/lib/quiz.server";
import { DEFAULT_TYPES, GENERATABLE_TYPES, type QuestionType } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { QuestionCard } from "~/components/quiz/question-card";
import { PageHeader } from "~/components/ui/page-header";
import { QuizTabs } from "~/components/quiz/quiz-tabs";
import { asSentence } from "~/lib/sentence";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Quiz") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { knowledge_bases } = await listKBs(user.id);
  // Only knowledge bases with something indexed can be asked about; offering
  // an empty one would produce a "no questions" error the learner could have
  // been spared.
  const usable = knowledge_bases.filter((s) => s.ready > 0).map((s) => ({ id: s.kb.id, name: s.kb.name }));
  // "Quiz me on it" from a research report arrives with ?kb=<id>.
  const wanted = new URL(request.url).searchParams.get("kb") ?? "";
  return { kbs: usable, selectedKb: usable.some((kb) => kb.id === wanted) ? wanted : undefined };
}

/** The knowledge base the Python starter set goes into, made if missing. */
const STARTER_KB = "Python basics";

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  // the private design notes, phase 4: the starter set.
  if (form.get("intent") === "starter") {
    try {
      const { knowledge_bases } = await listKBs(user.id);
      const kb = knowledge_bases.find((s) => s.kb.name === STARTER_KB)?.kb ?? (await createKB(user.id, STARTER_KB));
      await addStarter(user.id, kb.id, "python");
      throw redirect(`/quiz/bank?kb=${encodeURIComponent(kb.id)}&type=code`);
    } catch (error) {
      if (error instanceof Response) throw error;
      return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
    }
  }
  const kbId = String(form.get("kb_id") ?? "");
  if (!kbId) return { errorKey: "errors.chooseKb", errorDetail: "" };

  const types = form
    .getAll("types")
    .map(String)
    .filter((v): v is QuestionType => (GENERATABLE_TYPES as readonly string[]).includes(v));
  const n = Math.min(20, Math.max(1, Number(form.get("n") ?? 5) || 5));

  try {
    const result = await generateQuiz(user.id, {
      kb_id: kbId,
      topic: String(form.get("topic") ?? "").trim() || undefined,
      n,
      types: types.length > 0 ? types : undefined,
    });
    return { result };
  } catch (error) {
    return {
      errorKey: "errors.generateFailed",
      errorDetail: error instanceof ApiError ? error.message : "",
    };
  }
}

export default function QuizIndex({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const navigation = useNavigation();
  const generating = navigation.state === "submitting" && navigation.formMethod === "POST";
  const result = actionData && "result" in actionData ? actionData.result : undefined;

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
      <PageHeader title={t("quiz.title")} lede={t("quiz.lead")} />

      <QuizTabs />
      <QuickStart kicker={t("quiz.title")} title={result ? t("practise.answerQuestionsCount", { count: result.questions.length }) : t("practise.answerQuestions")} description={t("quiz.lead")} primary={{ to: result ? "#lp-quiz-set" : loaderData.kbs.length ? "#lp-quiz-generate" : "/knowledge", label: t("quiz.submit") }} />

      {loaderData.kbs.length === 0 ? (
        <section className="mt-8"><h2>{t("practise.baseline")}</h2><ol><li>{t("practise.addSource")}</li><li>{t("practise.chooseSource")}</li><li>{t("practise.checkAnswer")}</li></ol><p>
          {t("quiz.noKb")}{" "}
          <Link to="/knowledge" className="text-primary not-italic underline underline-offset-4">
            {t("quiz.goKnowledge")}
          </Link>
        </p></section>
      ) : (
        <section aria-labelledby="lp-quiz-generate" className="mt-8">
          <h2 id="lp-quiz-generate" className="lp-section">
            {t("quiz.generate")}
          </h2>
          <Form method="post" className="mt-3 space-y-4 rounded-lg border bg-card p-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <div>
                <label htmlFor="lp-quiz-kb" className="block text-sm font-medium">
                  {t("quiz.kb")}
                </label>
                <select
                  id="lp-quiz-kb"
                  name="kb_id"
                  required
                  defaultValue={loaderData.selectedKb}
                  className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
                >
                  {loaderData.kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="lp-quiz-n" className="block text-sm font-medium">
                  {t("quiz.count")}
                </label>
                <input
                  id="lp-quiz-n"
                  name="n"
                  type="number"
                  min={1}
                  max={20}
                  defaultValue={5}
                  className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm tabular-nums"
                />
              </div>
            </div>
            <div>
              <label htmlFor="lp-quiz-topic" className="block text-sm font-medium">
                {t("quiz.topic")}
              </label>
              <input
                id="lp-quiz-topic"
                name="topic"
                maxLength={300}
                placeholder={t("quiz.topicPlaceholder")}
                className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">{t("quiz.types")}</legend>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                {GENERATABLE_TYPES.map((type) => (
                  <label key={type} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="types" value={type} defaultChecked={DEFAULT_TYPES.includes(type)} />
                    {typeLabels[type]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={generating}>
                {generating ? t("quiz.generating") : t("quiz.submit")}
              </Button>
              <p className="text-xs leading-snug text-muted-foreground">{t("quiz.cost")}</p>
            </div>
          </Form>

          {actionData && "errorKey" in actionData && actionData.errorKey ? (
            <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
              {t(actionData.errorKey)}
              {actionData.errorDetail ? ` ${asSentence(actionData.errorDetail)}` : ""}
            </p>
          ) : null}
        </section>
      )}

      {result ? (
        <section aria-labelledby="lp-quiz-set" className="mt-10">
          <h2 id="lp-quiz-set" className="lp-section">
            1. {t("practise.todayQuestions")}
          </h2>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            {t("quiz.setMeta", {
              count: result.questions.length,
              requested: result.requested,
              model: result.model,
            })}
            {result.dropped_citations > 0 ? ` ${t("quiz.dropped", { count: result.dropped_citations })}` : ""}
          </p>
          {result.note ? <p className="mt-2 text-sm leading-prose text-muted-foreground">{result.note}</p> : null}
          <ol className="mt-4 space-y-4">
            {result.questions.map((q, index) => (
              <li key={q.id}>
                <QuestionCard question={q} position={index + 1} total={result.questions.length} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="lp-quiz-starter" className="mt-10">
        <h2 id="lp-quiz-starter" className="lp-section">
          {t("starter.title")}
        </h2>
        <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("starter.lead")}</p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="starter" />
          <Button type="submit" variant="outline" disabled={generating}>
            {t("starter.add")}
          </Button>
        </Form>
      </section>
    </div>
  );
}
