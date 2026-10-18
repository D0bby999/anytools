/**
 * brief-form.tsx
 * The AI task brief, written before the task is handed over. The data
 * boundary is a note to self: AnyTools cannot enforce what a provider does
 * with a prompt, so the field says so rather than pretending to be a control.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { PRE_START_CHECKS, type Brief } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

const box = "mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm";

export function BriefForm({ brief, busy }: { brief: Brief; busy: boolean }) {
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
    <Form method="post" className="mt-3 space-y-4">
      <input type="hidden" name="intent" value="brief" />
      {fields.map((f) => (
        <label key={f.name} className="block text-sm font-medium">
          {f.label}
          <textarea name={f.name} rows={2} defaultValue={String(brief[f.name] ?? "")} className={box} />
        </label>
      ))}
      <p className="text-xs text-muted-foreground">{t("brief.dataNoteHint")}</p>
      <fieldset>
        <legend className="text-sm font-medium">{t("brief.preStart")}</legend>
        {PRE_START_CHECKS.map((k) => (
          <label key={k} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="check" value={k} defaultChecked={brief.pre_start_check[k] === true} />
            {checks[k]}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={busy}>
        {t("state.save")}
      </Button>
    </Form>
  );
}
