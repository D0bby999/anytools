/**
 * state-edit-form.tsx
 * The rest of a learning state, filled in when there is something to fill it
 * with. AI boundaries are one entry per line: guidance written for a resumed
 * chat and for the person, which the product does not claim to enforce.
 *
 * The minimum contract (up-methods phase 13) is up's three bad-day questions,
 * from docs/en/threads/part-4/rhythm-and-compounding.md §6. The form says which
 * answers a resumed chat sends to the learner's model: the first two; never
 * the third.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { LearningState } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

const box = "mt-1 w-full rounded-md border border-control-border bg-card px-3 py-2 text-sm";

export function StateEditForm({ state, busy }: { state: LearningState; busy: boolean }) {
  const { t } = useTranslation("loop");
  const text = (id: string, name: string, label: string, value: string, rows = 2, hint?: string) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <textarea id={id} name={name} rows={rows} defaultValue={value} className={box} />
    </div>
  );
  return (
    <Form method="post" className="mt-3 space-y-4">
      <input type="hidden" name="intent" value="save" />
      {text("lp-st-goal", "goal", t("start.goal"), state.goal, 1)}
      {text("lp-st-scenario", "real_scenario", t("state.scenario"), state.real_scenario)}
      {text("lp-st-outcome", "outcome_12w", t("state.outcome"), state.outcome_12w)}
      {text("lp-st-next", "next_task", t("state.nextTask"), state.next_task, 1)}
      {text("lp-st-min", "next_task_minimum", t("state.minimum"), state.next_task_minimum, 1, t("state.minimumHint"))}
      <fieldset className="space-y-4 rounded-md border border-control-border p-4">
        <legend className="px-1 text-sm font-medium">{t("contract.title")}</legend>
        <p className="text-sm leading-prose text-muted-foreground">{t("contract.lead")}</p>
        {text(
          "lp-st-downshift",
          "contract_downshift_when",
          t("contract.downshift"),
          state.minimum_contract.downshift_when ?? "",
          2,
          t("contract.downshiftHint"),
        )}
        {text(
          "lp-st-keep",
          "contract_still_worth_keeping",
          t("contract.keep"),
          state.minimum_contract.still_worth_keeping ?? "",
          2,
          t("contract.keepHint"),
        )}
        {text(
          "lp-st-help",
          "contract_ask_for_help_when",
          t("contract.help"),
          state.minimum_contract.ask_for_help_when ?? "",
          2,
          t("contract.helpHint"),
        )}
        <p className="text-xs leading-prose text-muted-foreground">{t("contract.shared")}</p>
      </fieldset>
      {text("lp-st-may", "ai_may", t("state.aiMay"), state.ai_boundaries.ai_may.join("\n"), 3, t("state.perLine"))}
      {text(
        "lp-st-confirm",
        "human_must_confirm",
        t("state.humanConfirm"),
        state.ai_boundaries.human_must_confirm.join("\n"),
        3,
        t("state.boundariesHint"),
      )}
      {text("lp-st-handover", "handover_md", t("state.handover"), state.handover_md, 6, t("state.handoverHint"))}
      <Button type="submit" disabled={busy}>
        {t("state.save")}
      </Button>
    </Form>
  );
}
