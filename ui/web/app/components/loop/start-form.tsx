/**
 * start-form.tsx
 * The minimal start: four lines, and the loop exists. A long onboarding form
 * is where a plan stalls before its first week, so everything else — AI
 * boundaries, baselines, the minimum task — is filled in later, on the goal's
 * own page, when there is something to fill it with.
 *
 * The four lines are one input table (I2), as up's worksheets ask.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { InputTable } from "~/components/loop/input-table";

export function StartForm({ busy }: { busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="start" />
      <InputTable
        caption={t("start.another")}
        rows={[
          { id: "lp-loop-goal", label: t("start.goal"), control: <input id="lp-loop-goal" name="goal" required maxLength={500} /> },
          {
            id: "lp-loop-scenario",
            label: t("start.scenario"),
            hint: t("start.scenarioHint"),
            control: <input id="lp-loop-scenario" name="real_scenario" required maxLength={2000} />,
          },
          {
            id: "lp-loop-outcome",
            label: t("start.outcome"),
            hint: t("start.outcomeHint"),
            control: <input id="lp-loop-outcome" name="outcome_12w" required maxLength={2000} />,
          },
          {
            id: "lp-loop-task",
            label: t("start.task"),
            hint: t("start.taskHint"),
            control: <input id="lp-loop-task" name="first_task" required maxLength={1000} />,
          },
        ]}
      />
      <Button type="submit" disabled={busy}>
        {t("start.submit")}
      </Button>
    </Form>
  );
}
