/**
 * brief-form.tsx
 * The AI task brief, written before the task is handed over. The data
 * boundary is a note to self: AnyTools cannot enforce what a provider does
 * with a prompt, so the field says so rather than pretending to be a control.
 *
 * Two numbered parts of up's AI Task Brief (plan 261020-2246 phase 12): the
 * brief as an input table, then the checks before starting. One form.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { PRE_START_CHECKS, type Brief } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { NumberedSection } from "~/components/doc/numbered-section";
import { InputTable } from "~/components/loop/input-table";

export function BriefForm({ brief, busy, notReady }: { brief: Brief; busy: boolean; notReady: boolean }) {
  const { t } = useTranslation("loop");
  const fields: { name: keyof Brief; label: string }[] = [
    { name: "task", label: t("brief.task") },
    { name: "output_eval", label: t("brief.outputEval") },
    { name: "ai_scope", label: t("brief.aiScope") },
    { name: "human_gates", label: t("brief.humanGates") },
    { name: "cost_reversibility", label: t("brief.cost") },
    { name: "failure_rollback", label: t("brief.rollback") },
    { name: "handover", label: t("brief.handover") },
    { name: "data_boundary_note", label: t("brief.dataNote") },
  ];
  const checks: Record<(typeof PRE_START_CHECKS)[number], string> = {
    output_eval_written: t("brief.check.output_eval_written"),
    human_gates_named: t("brief.check.human_gates_named"),
    rollback_known: t("brief.check.rollback_known"),
    baseline_recorded: t("brief.check.baseline_recorded"),
  };
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="brief" />
      <NumberedSection n={1} title={t("brief.title")} id="lp-brief-form">
        {notReady ? <p className="text-muted-foreground">{t("brief.notReady")}</p> : null}
        <InputTable
          caption={t("brief.title")}
          rows={fields.map((f) => ({
            id: `lp-brief-${f.name}`,
            label: f.label,
            hint: f.name === "data_boundary_note" ? t("brief.dataNoteHint") : undefined,
            control: <textarea id={`lp-brief-${f.name}`} name={f.name} rows={2} defaultValue={String(brief[f.name] ?? "")} />,
          }))}
        />
      </NumberedSection>
      <NumberedSection n={2} title={t("brief.preStart")} id="lp-brief-checks">
        <fieldset>
          <legend className="sr-only">{t("brief.preStart")}</legend>
          {PRE_START_CHECKS.map((k) => (
            <label key={k} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="check" value={k} defaultChecked={brief.pre_start_check[k] === true} />
              {checks[k]}
            </label>
          ))}
        </fieldset>
        <Button type="submit" disabled={busy} className="mt-4">
          {t("state.save")}
        </Button>
      </NumberedSection>
    </Form>
  );
}
