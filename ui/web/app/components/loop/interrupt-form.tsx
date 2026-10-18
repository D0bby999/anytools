/**
 * interrupt-form.tsx
 * "I got interrupted": the plan shrinks to its minimum instead of lapsing.
 *
 * The lines are up's interruption record (docs/en/templates/90-day-cycle.md
 * §6, "Interruption and recovery"), in up's order: the fact, the main
 * resistance, what the task is reduced to, the smallest output within 24
 * hours, the work not to be made up, and a review date. "Task reduced to" is
 * the protocol's minimum itself — prefilled with the minimum already written,
 * and required when there is none: shrinking to a minimum nobody wrote down is
 * just dropping the task.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import { useResistanceLabels } from "~/components/loop/interruption-list";
import { RESISTANCES } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";

const input = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3 text-sm";

export function InterruptForm({ minimum, busy }: { minimum: string; busy: boolean }) {
  const { t } = useTranslation("loop");
  const label = useResistanceLabels();
  const line = (id: string, name: string, text: string, opts: { hint?: string; required?: boolean; value?: string } = {}) => (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {text}
      </label>
      {opts.hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {opts.hint}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        required={opts.required}
        defaultValue={opts.value}
        maxLength={1000}
        aria-describedby={opts.hint ? `${id}-hint` : undefined}
        className={input}
      />
    </div>
  );
  return (
    <Form method="post" className="mt-3 space-y-3">
      <input type="hidden" name="intent" value="interrupt" />
      <p className="text-sm leading-prose text-muted-foreground">{t("interruption.lead")}</p>
      {line("lp-int-fact", "fact", t("interruption.fact"), { hint: t("interruption.factHint"), required: true })}
      <div>
        <label htmlFor="lp-int-resistance" className="block text-sm font-medium">
          {t("interruption.resistance")}
        </label>
        <select id="lp-int-resistance" name="resistance" defaultValue="" className={input}>
          <option value="">{t("interruption.resistanceNone")}</option>
          {RESISTANCES.map((r) => (
            <option key={r} value={r}>
              {label[r]}
            </option>
          ))}
        </select>
      </div>
      {line("lp-int-min", "minimum", t("interruption.reducedTo"), {
        hint: t("interruption.reducedToHint"),
        required: !minimum,
        value: minimum,
      })}
      {line("lp-int-24h", "within_24h", t("interruption.within24h"), { required: true })}
      {line("lp-int-repay", "not_repaying", t("interruption.notRepaying"), { hint: t("interruption.notRepayingHint") })}
      <div>
        <label htmlFor="lp-int-review" className="block text-sm font-medium">
          {t("interruption.reviewOn")}
        </label>
        <input id="lp-int-review" name="review_on" type="date" className={input} />
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {t("interruption.submit")}
      </Button>
    </Form>
  );
}
