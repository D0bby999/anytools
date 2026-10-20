import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import type { ExamTemplate, TemplateItem } from "~/lib/exam-types";
import { EXAM_TYPES, type QuestionType } from "~/lib/study-types";
import { Button } from "~/components/ui/button";
import { PaperPage } from "~/components/exam/paper-page";

export type ReviewActionData = { ok: boolean; error?: string };

const field =
  "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm " +
  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none";

/**
 * The review screen: every extracted question, editable, before the template
 * is used (DeepTutor has none; external findings §5 step 5).
 *
 * The learner fixes a type, the points, the stem or the options, deletes what
 * the extraction invented, and marks the template ready. The server
 * re-validates every save and names what is still wrong; this screen shows
 * those issues and never decides readiness itself.
 */
export function TemplateEditor({ template, paperUrl }: { template: ExamTemplate; paperUrl: string }) {
  const { t } = useTranslation("study");
  const fetcher = useFetcher<ReviewActionData>();
  const [items, setItems] = useState<TemplateItem[]>(template.items);
  const [title, setTitle] = useState(template.title);
  const [limit, setLimit] = useState(template.time_limit_minutes ? String(template.time_limit_minutes) : "");

  // A save returns the server's view of the items, issues recomputed: adopt
  // it, so a fixed question loses its warning and a new problem gains one.
  useEffect(() => {
    setItems(template.items);
    setTitle(template.title);
    setLimit(template.time_limit_minutes ? String(template.time_limit_minutes) : "");
  }, [template]);

  const saving = fetcher.state !== "idle";
  const total = items.reduce((sum, it) => sum + (Number.isFinite(it.points) ? it.points : 0), 0);
  const withIssues = template.items.filter((it) => (it.issues ?? []).length > 0).length;

  const save = (ready?: boolean) => {
    const minutes = Number(limit);
    fetcher.submit(
      {
        intent: "save",
        payload: JSON.stringify({
          title,
          items: items.map(({ issues: _issues, ...rest }) => rest),
          ...(limit.trim() === "" ? { clear_time_limit: true } : { time_limit_minutes: minutes }),
          ...(ready === undefined ? {} : { ready }),
        }),
      },
      { method: "post" },
    );
  };
  const update = (index: number, patch: Partial<TemplateItem>) =>
    setItems((current) => current.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  return (
    <div className="mt-6">
      {template.warnings.length > 0 ? (
        <section aria-labelledby="lp-exam-warnings" className="rounded-lg border border-warning bg-warning-soft p-4">
          <h2 id="lp-exam-warnings" className="lp-section text-warning">
            {t("exams.review.warnings")}
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {template.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_10rem]">
        <div>
          <label htmlFor="lp-exam-title" className="block text-sm font-medium">
            {t("exams.review.title")}
          </label>
          <input id="lp-exam-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="lp-exam-limit" className="block text-sm font-medium">
            {t("exams.review.limit")}
          </label>
          <input
            id="lp-exam-limit"
            type="number"
            min={1}
            max={600}
            value={limit}
            placeholder={t("exams.review.noLimit")}
            onChange={(e) => setLimit(e.target.value)}
            className={`${field} tabular-nums`}
          />
        </div>
      </div>

      <section aria-labelledby="lp-exam-items" className="mt-8">
        <h2 id="lp-exam-items" className="lp-section">
          {t("exams.review.questions", { count: items.length, points: Math.round(total * 100) / 100 })}
        </h2>
        <ol className="mt-3 border-t">
          {items.map((item, index) => (
            <li key={`${item.number}-${index}`} className="border-b py-5">
              <ItemEditor
                item={item}
                template={template}
                paperUrl={paperUrl}
                onChange={(patch) => update(index, patch)}
                onDelete={() => setItems((current) => current.filter((_, i) => i !== index))}
              />
            </li>
          ))}
        </ol>
      </section>

      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <Button type="button" variant="outline" disabled={saving} onClick={() => save()}>
          {saving ? t("exams.review.saving") : t("exams.review.save")}
        </Button>
        {template.status === "ready" ? (
          <Button type="button" variant="outline" disabled={saving} onClick={() => save(false)}>
            {t("exams.review.unready")}
          </Button>
        ) : (
          <Button type="button" disabled={saving || items.length === 0} onClick={() => save(true)}>
            {t("exams.review.markReady")}
          </Button>
        )}
        <p className="text-xs leading-snug text-muted-foreground" role="status">
          {template.status === "ready"
            ? t("exams.review.isReady")
            : withIssues > 0
              ? t("exams.review.fixFirst", { count: withIssues })
              : t("exams.review.readyHint")}
        </p>
      </div>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}
    </div>
  );
}

function ItemEditor({
  item,
  template,
  paperUrl,
  onChange,
  onDelete,
}: {
  item: TemplateItem;
  template: ExamTemplate;
  paperUrl: string;
  onChange: (patch: Partial<TemplateItem>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("study");
  const ids = useId();
  const [showPage, setShowPage] = useState(false);
  const typeLabels: Record<QuestionType, string> = {
    mcq: t("types.mcq"),
    tf: t("types.tf"),
    short: t("types.short"),
    cloze: t("types.cloze"),
    written: t("types.written"),
    code: t("types.code"),
  };
  const renderable = template.kind === "pdf" || template.kind === "image";
  const page = item.figure_page ?? item.source_page;
  const issues = item.issues ?? [];

  return (
    <article aria-labelledby={`${ids}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`${ids}-title`} className="font-serif text-lg">
          {t("exams.review.item", { number: item.number || "?" })}
        </h3>
        <p className="text-xs font-semibold text-faint">
          {t("exams.review.onPage", { page: item.source_page })}
          {item.figure_page ? ` · ${t("exams.review.figureOn", { page: item.figure_page })}` : ""}
        </p>
      </div>

      {issues.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-destructive">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${ids}-type`} className="block text-sm font-medium">
            {t("exams.review.type")}
          </label>
          <select
            id={`${ids}-type`}
            value={item.type}
            onChange={(e) => onChange({ type: e.target.value as QuestionType })}
            className={field}
          >
            {EXAM_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabels[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-difficulty`} className="block text-sm font-medium">
            {t("exams.review.difficulty")}
          </label>
          <select
            id={`${ids}-difficulty`}
            value={item.difficulty}
            onChange={(e) => onChange({ difficulty: e.target.value as TemplateItem["difficulty"] })}
            className={field}
          >
            <option value="easy">{t("difficulty.easy")}</option>
            <option value="medium">{t("difficulty.medium")}</option>
            <option value="hard">{t("difficulty.hard")}</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${ids}-points`} className="block text-sm font-medium">
            {t("exams.review.points")}
          </label>
          <input
            id={`${ids}-points`}
            type="number"
            min={0.25}
            max={100}
            step={0.25}
            value={item.points}
            onChange={(e) => onChange({ points: Number(e.target.value) })}
            className={`${field} tabular-nums`}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`${ids}-stem`} className="block text-sm font-medium">
          {t("exams.review.stem")}
        </label>
        <textarea
          id={`${ids}-stem`}
          value={item.stem_md}
          rows={Math.min(10, Math.max(3, Math.ceil(item.stem_md.length / 80)))}
          maxLength={8000}
          onChange={(e) => onChange({ stem_md: e.target.value })}
          className="mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        />
      </div>

      {item.type === "mcq" ? (
        <div className="mt-3">
          <label htmlFor={`${ids}-options`} className="block text-sm font-medium">
            {t("exams.review.options")}
          </label>
          <textarea
            id={`${ids}-options`}
            value={(item.options ?? []).map((o) => o.text_md).join("\n")}
            rows={Math.max(3, (item.options ?? []).length + 1)}
            aria-describedby={`${ids}-options-hint`}
            onChange={(e) =>
              onChange({ options: e.target.value.split("\n").map((text, i) => ({ label: String.fromCharCode(65 + i), text_md: text })) })
            }
            className="mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm leading-prose focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          />
          <p id={`${ids}-options-hint`} className="mt-1 text-xs text-muted-foreground">
            {t("exams.review.optionsHint")}
          </p>
        </div>
      ) : null}

      {item.sub_questions && item.sub_questions.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {item.sub_questions.map((sq) => (
            <li key={sq.label}>
              ({sq.label}) {sq.stem_md}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {renderable ? (
          <Button type="button" variant="outline" size="sm" aria-expanded={showPage} onClick={() => setShowPage((v) => !v)}>
            {showPage ? t("exams.review.hidePage") : t("exams.review.showPage", { page })}
          </Button>
        ) : item.figure_page ? (
          <p className="text-sm text-muted-foreground">
            {t("exams.review.seeOriginal")}{" "}
            <a href={paperUrl} className="text-primary underline underline-offset-4">
              {t("exams.review.download")}
            </a>
          </p>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onDelete}>
          <Trash2 aria-hidden="true" className="size-4" />
          {t("exams.review.delete")}
        </Button>
      </div>
      {renderable && showPage ? (
        <PaperPage url={paperUrl} page={page} label={t("exams.pageCaption", { page })} />
      ) : null}
    </article>
  );
}
