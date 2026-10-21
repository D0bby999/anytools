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
 *
 * Plan 261020-2246 phase 12 lays the state out as up's Learning State
 * Template, a numbered section per part. The fields are still one form and
 * one save (intent "save" sends every field): the <Form> is StateEditForm,
 * and each part's inputs join it through their `form` attribute, so a part
 * can sit under its own heading with a Save button of its own.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { LearningState } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { InputTable, type InputRow } from "~/components/loop/input-table";

/** The id of the one form every part's inputs belong to. */
export const STATE_FORM = "lp-state-edit";

/** One line of the state: a textarea that belongs to the state's form. */
function text(id: string, name: string, label: string, value: string, rows = 2, hint?: string): InputRow {
  return {
    id,
    label,
    hint,
    control: <textarea id={id} name={name} rows={rows} defaultValue={value} form={STATE_FORM} />,
  };
}

/** 1. Goal: the goal, the real scenario it is for, the twelve-week outcome. */
export function StateGoalFields({ state }: { state: LearningState }) {
  const { t } = useTranslation("loop");
  return (
    <InputTable
      caption={t("up.state.goal")}
      rows={[
        text("lp-st-goal", "goal", t("start.goal"), state.goal, 1),
        text("lp-st-scenario", "real_scenario", t("state.scenario"), state.real_scenario),
        text("lp-st-outcome", "outcome_12w", t("state.outcome"), state.outcome_12w),
      ]}
    />
  );
}

/** 2. Constraints and boundaries: what AI may do, and the bad-day contract. */
export function StateBoundaryFields({ state }: { state: LearningState }) {
  const { t } = useTranslation("loop");
  return (
    <>
      <InputTable
        caption={t("up.state.boundaries")}
        rows={[
          text("lp-st-may", "ai_may", t("state.aiMay"), state.ai_boundaries.ai_may.join("\n"), 3, t("state.perLine")),
          text(
            "lp-st-confirm",
            "human_must_confirm",
            t("state.humanConfirm"),
            state.ai_boundaries.human_must_confirm.join("\n"),
            3,
            t("state.boundariesHint"),
          ),
        ]}
      />
      <fieldset>
        <legend className="text-base font-semibold">{t("contract.title")}</legend>
        <p className="text-muted-foreground">{t("contract.lead")}</p>
        <InputTable
          caption={t("contract.title")}
          rows={[
            text(
              "lp-st-downshift",
              "contract_downshift_when",
              t("contract.downshift"),
              state.minimum_contract.downshift_when ?? "",
              2,
              t("contract.downshiftHint"),
            ),
            text(
              "lp-st-keep",
              "contract_still_worth_keeping",
              t("contract.keep"),
              state.minimum_contract.still_worth_keeping ?? "",
              2,
              t("contract.keepHint"),
            ),
            text(
              "lp-st-help",
              "contract_ask_for_help_when",
              t("contract.help"),
              state.minimum_contract.ask_for_help_when ?? "",
              2,
              t("contract.helpHint"),
            ),
          ]}
        />
        <p className="text-sm text-muted-foreground">{t("contract.shared")}</p>
      </fieldset>
    </>
  );
}

/** The latest handover note. */
export function StateHandoverField({ state }: { state: LearningState }) {
  const { t } = useTranslation("loop");
  return (
    <InputTable
      caption={t("state.handover")}
      rows={[text("lp-st-handover", "handover_md", t("state.handover"), state.handover_md, 6, t("state.handoverHint"))]}
    />
  );
}

/** The next action and the minimum it shrinks to. */
export function StateNextFields({ state }: { state: LearningState }) {
  const { t } = useTranslation("loop");
  return (
    <InputTable
      caption={t("up.state.next")}
      rows={[
        text("lp-st-next", "next_task", t("state.nextTask"), state.next_task, 1),
        text("lp-st-min", "next_task_minimum", t("state.minimum"), state.next_task_minimum, 1, t("state.minimumHint")),
      ]}
    />
  );
}

/** A Save for the whole state, placed under any of its parts. */
export function SaveState({ busy }: { busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <Button type="submit" form={STATE_FORM} disabled={busy}>
      {t("state.save")}
    </Button>
  );
}

/** The form the parts' inputs belong to; rendered once on the page. */
export function StateEditForm() {
  return (
    <Form method="post" id={STATE_FORM} hidden>
      <input type="hidden" name="intent" value="save" />
    </Form>
  );
}
