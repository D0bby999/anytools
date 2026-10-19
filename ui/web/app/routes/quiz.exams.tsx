/**
 * quiz.exams.tsx
 * Mock exams (learning depth, phase 3): the learner's past papers, and the
 * mock exams made from them. Under Quiz, not a new rail item.
 *
 * A paper is uploaded here and reviewed on its own page; a reviewed paper
 * makes a mock exam from any knowledge base with something indexed. The cost
 * is stated before the button is pressed: one call per item, and one more for
 * any item that needs a repair.
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/quiz.exams";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { listKBs } from "~/lib/kb.server";
import { createExam, deleteExam, deleteTemplate, listExams, listTemplates, uploadPaper } from "~/lib/exam.server";
import type { Exam, ExamTemplate } from "~/lib/exam-types";
import { driveReason } from "~/lib/drive-storage";
import { Button } from "~/components/ui/button";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import { PageHeader } from "~/components/ui/page-header";
import { PlateEmpty } from "~/components/ui/plate";
import { QuizTabs } from "~/components/quiz/quiz-tabs";

/** The most items one mock exam generates (exam.MaxGenerate). */
const MAX_GENERATE = 60;

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Mock exams") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [{ templates }, { exams }, { knowledge_bases }] = await Promise.all([
    listTemplates(user.id),
    listExams(user.id),
    listKBs(user.id),
  ]);
  return {
    templates,
    exams,
    kbs: knowledge_bases.filter((s) => s.ready > 0).map((s) => ({ id: s.kb.id, name: s.kb.name })),
    kbNames: Object.fromEntries(knowledge_bases.map((s) => [s.kb.id, s.kb.name])),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    switch (intent) {
      case "upload": {
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) return { errorKey: "exams.errors.chooseFile", errorDetail: "" };
        const result = await uploadPaper(user.id, file);
        if (result.status >= 400 || !result.template) {
          const reason = driveReason(result.code);
          return {
            errorKey: "exams.errors.upload",
            errorDetail: result.error ? `${file.name}: ${result.error}` : file.name,
            // Kept in the learner's Google Drive, which refused the paper
            // (drive-user-storage phase 5): the page says why.
            ...(reason ? { driveReason: reason } : {}),
          };
        }
        return redirect(`/quiz/exams/templates/${result.template.id}`);
      }
      case "create": {
        const exam = await createExam(user.id, {
          template_id: String(form.get("templateId") ?? ""),
          kb_id: String(form.get("kbId") ?? ""),
        });
        return redirect(`/quiz/exams/${exam.id}`);
      }
      case "delete-template":
        await deleteTemplate(user.id, String(form.get("id") ?? ""));
        return null;
      case "delete-exam":
        await deleteExam(user.id, String(form.get("id") ?? ""));
        return null;
    }
  } catch (error) {
    return { errorKey: "exams.errors.action", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return null;
}

export default function QuizExams({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("study");
  const navigation = useNavigation();
  const uploading = navigation.state === "submitting" && navigation.formData?.get("intent") === "upload";
  const { templates, exams, kbs, kbNames } = loaderData;

  return (
    <div className="lp-measure">
      <PageHeader title={t("exams.title")} lede={t("exams.lead")} />
      <QuizTabs />

      <section aria-labelledby="lp-exams-upload" className="mt-8">
        <h2 id="lp-exams-upload" className="lp-section">
          {t("exams.upload.title")}
        </h2>
        <Form method="post" encType="multipart/form-data" className="mt-3 space-y-3 rounded-lg border bg-card p-4">
          <input type="hidden" name="intent" value="upload" />
          <div>
            <label htmlFor="lp-exams-file" className="block text-sm font-medium">
              {t("exams.upload.file")}
            </label>
            <input
              id="lp-exams-file"
              name="file"
              type="file"
              required
              accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
              aria-describedby="lp-exams-file-hint"
              className="mt-1 lp-file"
            />
            <p id="lp-exams-file-hint" className="mt-1 text-xs leading-snug text-muted-foreground">
              {t("exams.upload.hint")}
            </p>
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? t("exams.upload.uploading") : t("exams.upload.submit")}
          </Button>
        </Form>
        {actionData && "driveReason" in actionData && actionData.driveReason ? (
          <DriveFileNotice reason={actionData.driveReason} className="mt-3" />
        ) : actionData && "errorKey" in actionData && actionData.errorKey ? (
          <p role="alert" className="mt-3 text-sm leading-snug text-destructive">
            {t(actionData.errorKey)}
            {actionData.errorDetail ? ` ${actionData.errorDetail}` : ""}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="lp-exams-papers" className="mt-10">
        <h2 id="lp-exams-papers" className="lp-section">
          {t("exams.papers")}
        </h2>
        {templates.length === 0 ? (
          <p className="mt-3 lp-empty">{t("exams.noPapers")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {templates.map((tmpl) => (
              <li key={tmpl.id} className="border-b py-4">
                <TemplateRow template={tmpl} kbs={kbs} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lp-exams-list" className="mt-10">
        <h2 id="lp-exams-list" className="lp-section">
          {t("exams.exams")}
        </h2>
        {exams.length === 0 && templates.length === 0 ? (
          // First run: no paper and no mock yet. Practise's plate over the way in.
          <PlateEmpty name="part-practise" className="mt-3">
            {t("exams.noExams")}
          </PlateEmpty>
        ) : exams.length === 0 ? (
          <p className="mt-3 lp-empty">{t("exams.noExams")}</p>
        ) : (
          <ul className="mt-3 border-t">
            {exams.map((exam) => (
              <li key={exam.id} className="border-b py-4">
                <ExamRow exam={exam} kbName={kbNames[exam.kb_id] ?? ""} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TemplateRow({ template, kbs }: { template: ExamTemplate; kbs: { id: string; name: string }[] }) {
  const { t } = useTranslation("study");
  const count = template.items.length;
  const generate = Math.min(count, MAX_GENERATE);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link to={`/quiz/exams/templates/${template.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {template.title}
        </Link>
        <span className="text-xs font-semibold text-faint">{t(`exams.status.${template.status}`)}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("exams.paperMeta", { pages: template.page_count, count, points: template.total_points })}
      </p>
      {template.status === "ready" ? (
        kbs.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t("quiz.noKb")}</p>
        ) : (
          <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="templateId" value={template.id} />
            <div>
              <label htmlFor={`lp-exams-kb-${template.id}`} className="block text-sm font-medium">
                {t("exams.fromKb")}
              </label>
              <select
                id={`lp-exams-kb-${template.id}`}
                name="kbId"
                required
                className="mt-1 min-h-11 rounded-md border border-control-border bg-card px-3 text-sm"
              >
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit">{t("exams.make")}</Button>
            <p className="basis-full text-xs leading-snug text-muted-foreground">
              {t("exams.cost", { count: generate, calls: generate * 2 })}
              {count > MAX_GENERATE ? ` ${t("exams.capped", { max: MAX_GENERATE })}` : ""}
            </p>
          </Form>
        )
      ) : null}
      <Form method="post" className="mt-2">
        <input type="hidden" name="intent" value="delete-template" />
        <input type="hidden" name="id" value={template.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="-ml-3"
          onClick={(e) => {
            if (!window.confirm(t("exams.confirmDeletePaper"))) e.preventDefault();
          }}
        >
          {t("exams.deletePaper")}
        </Button>
      </Form>
    </div>
  );
}

function ExamRow({ exam, kbName }: { exam: Exam; kbName: string }) {
  const { t } = useTranslation("study");
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <Link to={`/quiz/exams/${exam.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {exam.title}
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">
          {kbName ? `${kbName} · ` : ""}
          {exam.status === "submitted" && exam.score !== undefined
            ? t("exams.scored", { score: exam.score, max: exam.max_score ?? 0 })
            : t(`exams.examStatus.${exam.status}`)}
        </p>
      </div>
      <Form method="post">
        <input type="hidden" name="intent" value="delete-exam" />
        <input type="hidden" name="id" value={exam.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          onClick={(e) => {
            if (!window.confirm(t("exams.confirmDelete"))) e.preventDefault();
          }}
        >
          {t("exams.delete")}
        </Button>
      </Form>
    </div>
  );
}
