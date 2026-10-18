/**
 * quiz.exams.templates.$templateId.tsx
 * One past paper: its extraction while it runs, then the review screen
 * (learning depth, phase 3). No template makes a mock exam until the learner
 * has reviewed it and marked it ready.
 */
import { useEffect } from "react";
import { Form, Link, redirect, useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/quiz.exams.templates.$templateId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { cancelTemplate, deleteTemplate, getTemplate, reviewTemplate, type TemplateReview } from "~/lib/exam.server";
import { templateWorking } from "~/lib/exam-types";
import { Button } from "~/components/ui/button";
import { TemplateEditor } from "~/components/exam/template-editor";
import { PageHeader } from "~/components/ui/page-header";

/** How often a running extraction is re-read. */
const POLL_MS = 3000;

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: `${data?.template.title ?? "Past paper"} · AnyTools` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  try {
    return { template: await getTemplate(user.id, params.templateId) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "save": {
        let body: TemplateReview;
        try {
          body = JSON.parse(String(form.get("payload") ?? "{}")) as TemplateReview;
        } catch {
          return { ok: false, error: "" };
        }
        await reviewTemplate(user.id, params.templateId, body);
        return { ok: true };
      }
      case "cancel":
        await cancelTemplate(user.id, params.templateId);
        return { ok: true };
      case "delete":
        await deleteTemplate(user.id, params.templateId);
        return redirect("/quiz/exams");
    }
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : "" };
  }
  return { ok: false, error: "" };
}

export default function ExamTemplatePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const { template } = loaderData;
  const revalidator = useRevalidator();
  const cancel = useFetcher();
  const working = templateWorking(template.status);
  const paperUrl = `/quiz/exams/templates/${template.id}/paper`;

  useEffect(() => {
    if (!working) return;
    const id = window.setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [working, revalidator]);

  const progress = template.progress;
  return (
    <div className="lp-measure">
      <Link to="/quiz/exams" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("exams.back")}
      </Link>
      <PageHeader title={template.title} lede={t("exams.review.lead")} />
      <p className="mt-2 text-xs text-muted-foreground">
        {t("exams.review.meta", { file: template.filename, pages: template.page_count })}
        {template.parsed_by ? ` · ${t("exams.review.readBy", { by: template.parsed_by })}` : ""}
      </p>

      {working ? (
        <section aria-labelledby="lp-exam-working" className="mt-8 border-y py-4">
          <h2 id="lp-exam-working" className="lp-section">
            {t(`exams.status.${template.status}`)}
          </h2>
          <p role="status" className="mt-2 text-sm leading-prose">
            {progress && progress.total > 0
              ? t("exams.review.progress", { done: progress.done, total: progress.total, billed: progress.billed })
              : t("exams.review.queued")}
          </p>
          <cancel.Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="cancel" />
            <Button type="submit" variant="outline" size="sm" disabled={cancel.state !== "idle"}>
              {t("exams.cancel")}
            </Button>
          </cancel.Form>
        </section>
      ) : template.status === "failed" ? (
        <section className="mt-8">
          <p role="alert" className="text-sm leading-prose text-destructive">
            {t("exams.review.failed")} {template.error}
          </p>
        </section>
      ) : (
        <TemplateEditor template={template} paperUrl={paperUrl} />
      )}

      <Form
        method="post"
        className="mt-10"
        onSubmit={(e) => {
          if (!window.confirm(t("exams.confirmDeletePaper"))) e.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="delete" />
        <Button type="submit" variant="ghost" size="sm" className="-ml-3">
          {t("exams.deletePaper")}
        </Button>
      </Form>
    </div>
  );
}
