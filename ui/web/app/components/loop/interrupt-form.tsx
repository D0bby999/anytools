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
import { InputTable, type InputRow } from "~/components/loop/input-table";

export function InterruptForm({ minimum, busy }: { minimum: string; busy: boolean }) {
  const { t } = useTranslation("loop");
  const label = useResistanceLabels();
  const line = (id: string, name: string, text: string, opts: { hint?: string; required?: boolean; value?: string } = {}): InputRow => ({
    id,
    label: text,
    hint: opts.hint,
    control: <input id={id} name={name} required={opts.required} defaultValue={opts.value} maxLength={1000} />,
  });
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="interrupt" />
      <p className="mt-0! text-muted-foreground">{t("interruption.lead")}</p>
      <InputTable
        caption={t("interrupt.title")}
        rows={[
          line("lp-int-fact", "fact", t("interruption.fact"), { hint: t("interruption.factHint"), required: true }),
          {
            id: "lp-int-resistance",
            label: t("interruption.resistance"),
            control: (
              <select id="lp-int-resistance" name="resistance" defaultValue="">
                <option value="">{t("interruption.resistanceNone")}</option>
                {RESISTANCES.map((r) => (
                  <option key={r} value={r}>
                    {label[r]}
                  </option>
                ))}
              </select>
            ),
          },
          line("lp-int-min", "minimum", t("interruption.reducedTo"), {
            hint: t("interruption.reducedToHint"),
            required: !minimum,
            value: minimum,
          }),
          line("lp-int-24h", "within_24h", t("interruption.within24h"), { required: true }),
          line("lp-int-repay", "not_repaying", t("interruption.notRepaying"), { hint: t("interruption.notRepayingHint") }),
          {
            id: "lp-int-review",
            label: t("interruption.reviewOn"),
            control: <input id="lp-int-review" name="review_on" type="date" />,
          },
        ]}
      />
      <Button type="submit" variant="outline" disabled={busy}>
        {t("interruption.submit")}
      </Button>
    </Form>
  );
}
