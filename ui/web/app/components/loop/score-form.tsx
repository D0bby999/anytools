/**
 * score-form.tsx
 * The weekly review's own form: four checks scored 0, 1 or 2, the week's
 * diagnosed mistakes, energy, and the ONE thing to change next week.
 *
 * Scores are radio groups, not a slider: three honest values, each with a
 * word, rather than a continuum that invites false precision.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { WeeklyReview } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { MistakeRows } from "~/components/loop/mistake-rows";

const CHECKS = ["completion", "quality", "retention", "transfer"] as const;

export function ScoreForm({ review, busy }: { review: WeeklyReview; busy: boolean }) {
  const { t } = useTranslation("loop");
  const labels: Record<(typeof CHECKS)[number], { name: string; hint: string }> = {
    completion: { name: t("review.completion"), hint: t("review.completionHint") },
    quality: { name: t("review.quality"), hint: t("review.qualityHint") },
    retention: { name: t("review.retention"), hint: t("review.retentionHint") },
    transfer: { name: t("review.transfer"), hint: t("review.transferHint") },
  };
  const levels = [t("review.level0"), t("review.level1"), t("review.level2")];
  const locked = review.writeback_done;

  return (
    <Form method="post" className="mt-3 space-y-6">
      <input type="hidden" name="intent" value="score" />
      <fieldset disabled={locked} className="space-y-4">
        {CHECKS.map((c) => (
          <fieldset key={c} className="border-b pb-3">
            <legend className="text-sm font-medium">{labels[c].name}</legend>
            <p className="text-xs text-muted-foreground">{labels[c].hint}</p>
            <div className="mt-2 flex flex-wrap gap-4">
              {levels.map((word, n) => (
                <label key={word} className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="radio" name={c} value={n} defaultChecked={review[c] === n} />
                  {n} · {word}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <MistakeRows errors={review.errors} />
        <div>
          <label htmlFor="lp-rv-energy" className="block text-sm font-medium">
            {t("review.energy")}
          </label>
          <input
            id="lp-rv-energy"
            name="energy"
            defaultValue={review.energy}
            maxLength={1000}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lp-rv-change" className="block text-sm font-medium">
            {t("review.change")}
          </label>
          <p className="text-xs text-muted-foreground">{t("review.changeHint")}</p>
          <input
            id="lp-rv-change"
            name="one_variable_change"
            defaultValue={review.one_variable_change}
            maxLength={1000}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm"
          />
        </div>
        <Button type="submit" disabled={busy}>
          {t("review.save")}
        </Button>
      </fieldset>
    </Form>
  );
}
