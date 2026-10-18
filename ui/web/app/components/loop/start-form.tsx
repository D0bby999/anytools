/**
 * start-form.tsx
 * The minimal start: four lines, and the loop exists. A long onboarding form
 * is where a plan stalls before its first week, so everything else — AI
 * boundaries, baselines, the minimum task — is filled in later, on the goal's
 * own page, when there is something to fill it with.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

const input = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm";

export function StartForm({ busy }: { busy: boolean }) {
  const { t } = useTranslation("loop");
  return (
    <Form method="post" className="mt-3 space-y-4 rounded-lg border bg-card p-4">
      <input type="hidden" name="intent" value="start" />
      <div>
        <label htmlFor="lp-loop-goal" className="block text-sm font-medium">
          {t("start.goal")}
        </label>
        <input id="lp-loop-goal" name="goal" required maxLength={500} className={input} />
      </div>
      <div>
        <label htmlFor="lp-loop-scenario" className="block text-sm font-medium">
          {t("start.scenario")}
        </label>
        <p className="text-xs text-muted-foreground">{t("start.scenarioHint")}</p>
        <input id="lp-loop-scenario" name="real_scenario" required maxLength={2000} className={input} />
      </div>
      <div>
        <label htmlFor="lp-loop-outcome" className="block text-sm font-medium">
          {t("start.outcome")}
        </label>
        <p className="text-xs text-muted-foreground">{t("start.outcomeHint")}</p>
        <input id="lp-loop-outcome" name="outcome_12w" required maxLength={2000} className={input} />
      </div>
      <div>
        <label htmlFor="lp-loop-task" className="block text-sm font-medium">
          {t("start.task")}
        </label>
        <p className="text-xs text-muted-foreground">{t("start.taskHint")}</p>
        <input id="lp-loop-task" name="first_task" required maxLength={1000} className={input} />
      </div>
      <Button type="submit" disabled={busy}>
        {t("start.submit")}
      </Button>
    </Form>
  );
}
