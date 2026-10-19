/**
 * quiz.exams.$examId.tsx
 * One mock exam (learning depth, phase 3), in whichever state it is in:
 * being generated (progress and the calls billed), ready to start, being
 * taken (a timer, one scrolling paper, answers saved as typed), or marked.
 *
 * The clock is the server's: Start stamps it and Submit reads it, so neither
 * a reload nor a wrong laptop clock changes the time taken.
 */
import { useEffect } from "react";
import { Form, Link, redirect, useFetcher, useNavigation, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/quiz.exams.$examId";
import { appTitle, raw } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelExam, deleteExam, getExam, saveAnswers, startExam, submitExam } from "~/lib/exam.server";
import type { ExamView } from "~/lib/exam-types";
import { Button } from "~/components/ui/button";
import { ExamSheet } from "~/components/exam/exam-sheet";
import { ExamResult } from "~/components/exam/exam-result";
import { PageHeader } from "~/components/ui/page-header";

const POLL_MS = 3000;

export function meta({ data, matches }: Route.MetaArgs) {
  return [{ title: (data?.exam.title ? appTitle(matches, raw(data?.exam.title)) : appTitle(matches, "Mock exam")) }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    return { exam: await getExam(user.id, params.examId) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

function parseAnswers(raw: FormDataEntryValue | null): { item_id: string; answer: string }[] {
  try {
    const parsed = JSON.parse(String(raw ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is { item_id: string; answer: string } =>
        typeof a === "object" && a !== null && typeof a.item_id === "string" && typeof a.answer === "string")
      .map((a) => ({ item_id: a.item_id, answer: a.answer }));
  } catch {
    return [];
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "start": {
        const minutes = Number(form.get("minutes") ?? "");
        await startExam(user.id, params.examId, Number.isFinite(minutes) && minutes > 0 ? minutes : undefined);
        return { ok: true };
      }
      case "save":
        await saveAnswers(user.id, params.examId, parseAnswers(form.get("answers")));
        return { ok: true, saved: true };
      case "submit": {
        // The last keystrokes go with the submit, so nothing typed is lost to
        // an autosave that had not fired yet. A partly marked exam is locked,
        // and only marks what is left.
        const answers = parseAnswers(form.get("answers"));
        const current = await getExam(user.id, params.examId);
        if (!current.submitted_at && answers.length > 0) await saveAnswers(user.id, params.examId, answers);
        await submitExam(user.id, params.examId);
        return { ok: true };
      }
      case "cancel":
        await cancelExam(user.id, params.examId);
        return { ok: true };
      case "delete":
        await deleteExam(user.id, params.examId);
        return redirect("/quiz/exams");
    }
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : "" };
  }
  return { ok: false, error: "" };
}

/** An autosave changes nothing the page shows; reloading the exam for it would be a round trip per pause. */
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formData?.get("intent") === "save") return false;
  return defaultShouldRevalidate;
}

export default function ExamPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const { exam } = loaderData;
  const revalidator = useRevalidator();

  useEffect(() => {
    if (exam.status !== "generating") return;
    const id = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [exam.status, revalidator]);

  return (
    <div className="lp-measure">
      <Link to="/quiz/exams" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("exams.back")}
      </Link>
      <PageHeader title={exam.title} />

      {exam.status === "generating" ? (
        <Generating exam={exam} />
      ) : exam.status === "failed" ? (
        <section className="mt-6">
          <p role="alert" className="text-sm leading-prose text-destructive">
            {t("exams.generate.failed")} {exam.error}
          </p>
          <DroppedList exam={exam} />
        </section>
      ) : exam.status === "ready" ? (
        <Ready exam={exam} />
      ) : exam.status === "in_progress" ? (
        <ExamSheet key={exam.id} exam={exam} />
      ) : (
        <ExamResult exam={exam} />
      )}

      {exam.status !== "in_progress" ? (
        <Form
          method="post"
          className="mt-10"
          onSubmit={(e) => {
            if (!window.confirm(t("exams.confirmDelete"))) e.preventDefault();
          }}
        >
          <input type="hidden" name="intent" value="delete" />
          <Button type="submit" variant="ghost" size="sm" className="-ml-3">
            {t("exams.delete")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

function Generating({ exam }: { exam: ExamView }) {
  const { t } = useTranslation("study");
  const cancel = useFetcher();
  const done = exam.progress?.done ?? exam.generated + exam.dropped.length;
  return (
    <section aria-labelledby="lp-exam-generating" className="mt-6 border-y py-4">
      <h2 id="lp-exam-generating" className="lp-section">
        {t("exams.generate.title")}
      </h2>
      <p role="status" className="mt-2 text-sm leading-prose">
        {t("exams.generate.progress", { done, total: exam.requested, billed: exam.progress?.billed ?? 0 })}
      </p>
      <DroppedList exam={exam} />
      <cancel.Form method="post" className="mt-3">
        <input type="hidden" name="intent" value="cancel" />
        <Button type="submit" variant="outline" size="sm" disabled={cancel.state !== "idle"}>
          {t("exams.cancel")}
        </Button>
      </cancel.Form>
    </section>
  );
}

function DroppedList({ exam }: { exam: ExamView }) {
  const { t } = useTranslation("study");
  if (exam.dropped.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-2">{t("exams.generate.droppedTitle", { count: exam.dropped.length })}</summary>
      <ul className="mt-1 divide-y border-y">
        {exam.dropped.map((d) => (
          <li key={d.ord} className="py-2">
            <span className="font-medium">{t("exams.review.item", { number: d.number || d.ord + 1 })}</span>
            <span className="text-muted-foreground"> · {d.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Ready({ exam }: { exam: ExamView }) {
  const { t } = useTranslation("study");
  const navigation = useNavigation();
  const starting = navigation.state === "submitting" && navigation.formData?.get("intent") === "start";
  return (
    <section aria-labelledby="lp-exam-ready" className="mt-6">
      <h2 id="lp-exam-ready" className="lp-section">
        {t("exams.ready.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose">
        {t("exams.ready.generated", { count: exam.generated, requested: exam.requested })}
      </p>
      {exam.error ? <p className="mt-1 text-sm text-warning">{exam.error}</p> : null}
      <DroppedList exam={exam} />
      <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="intent" value="start" />
        <div>
          <label htmlFor="lp-exam-minutes" className="block text-sm font-medium">
            {t("exams.ready.minutes")}
          </label>
          <input
            id="lp-exam-minutes"
            name="minutes"
            type="number"
            min={1}
            max={600}
            defaultValue={exam.time_limit_minutes ?? ""}
            placeholder={t("exams.review.noLimit")}
            className="mt-1 min-h-11 w-32 rounded-md border border-control-border bg-card px-3 text-sm tabular-nums"
          />
        </div>
        <Button type="submit" disabled={starting}>
          {t("exams.ready.start")}
        </Button>
        <p className="basis-full text-xs leading-snug text-muted-foreground">{t("exams.ready.hint")}</p>
      </Form>
    </section>
  );
}
