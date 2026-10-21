/**
 * score-form.tsx
 * The weekly review's own form: four checks scored 0, 1 or 2, the week's
 * diagnosed mistakes, energy, and the ONE thing to change next week.
 *
 * Scores are radio groups, not a slider: three honest values, each with a
 * word, rather than a continuum that invites false precision. They stay
 * native radios (not the library's ChoiceRow) so the review still posts
 * without script.
 *
 * Plan 261020-2246 phase 12 lays the review out as up's Weekly Review
 * Template, a numbered section per part. It is still one form and one save
 * (intent "score" sends every part): ScoreFormShell is the <Form>, and each
 * part's inputs join it through their `form` attribute. A written-back review
 * is frozen: every part's fieldset is disabled.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { WeeklyReview } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { InputTable } from "~/components/loop/input-table";
import { ScrollBox } from "~/components/doc/scroll-box";

/** The id of the one form every part's inputs belong to. */
export const SCORE_FORM = "lp-rv-score";

const CHECKS = ["completion", "quality", "retention", "transfer"] as const;

/** The four checks as a table: a row per check, its three scores in a row of radios. */
export function ScoreChecks({ review }: { review: WeeklyReview }) {
  const { t } = useTranslation("loop");
  const labels: Record<(typeof CHECKS)[number], { name: string; hint: string }> = {
    completion: { name: t("review.completion"), hint: t("review.completionHint") },
    quality: { name: t("review.quality"), hint: t("review.qualityHint") },
    retention: { name: t("review.retention"), hint: t("review.retentionHint") },
    transfer: { name: t("review.transfer"), hint: t("review.transferHint") },
  };
  const levels = [t("review.level0"), t("review.level1"), t("review.level2")];
  return (
    <fieldset disabled={review.writeback_done}>
      <div className="lp-field-table">
        <ScrollBox>
          <table>
            <caption className="sr-only">{t("up.review.checks")}</caption>
            <tbody>
              {CHECKS.map((c) => (
                <tr key={c}>
                  <th scope="row" className="w-[36%]">
                    <span id={`lp-rv-${c}`}>{labels[c].name}</span>
                    <span className="mt-1 block text-[13px] font-normal">{labels[c].hint}</span>
                  </th>
                  <td className="px-4! py-1!">
                    <div role="radiogroup" aria-labelledby={`lp-rv-${c}`} className="flex flex-wrap gap-x-5">
                      {levels.map((word, n) => (
                        <label key={word} className="flex min-h-11 items-center gap-2">
                          <input
                            type="radio"
                            name={c}
                            value={n}
                            defaultChecked={review[c] === n}
                            form={SCORE_FORM}
                            className="size-4! min-h-0! p-0! accent-primary"
                          />
                          {n} · {word}
                        </label>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </div>
    </fieldset>
  );
}

/** Energy and recovery: one line. */
export function EnergyField({ review }: { review: WeeklyReview }) {
  const { t } = useTranslation("loop");
  return (
    <fieldset disabled={review.writeback_done}>
      <InputTable
        caption={t("review.energy")}
        rows={[
          {
            id: "lp-rv-energy",
            label: t("review.energy"),
            control: (
              <input id="lp-rv-energy" name="energy" defaultValue={review.energy} maxLength={1000} form={SCORE_FORM} />
            ),
          },
        ]}
      />
    </fieldset>
  );
}

/** The one variable to change next week. */
export function ChangeField({ review }: { review: WeeklyReview }) {
  const { t } = useTranslation("loop");
  return (
    <fieldset disabled={review.writeback_done}>
      <InputTable
        caption={t("review.change")}
        rows={[
          {
            id: "lp-rv-change",
            label: t("review.change"),
            hint: t("review.changeHint"),
            control: (
              <input
                id="lp-rv-change"
                name="one_variable_change"
                defaultValue={review.one_variable_change}
                maxLength={1000}
                form={SCORE_FORM}
              />
            ),
          },
        ]}
      />
    </fieldset>
  );
}

/** A Save for the whole review, placed under any of its parts. */
export function SaveScores({ review, busy }: { review: WeeklyReview; busy: boolean }) {
  const { t } = useTranslation("loop");
  if (review.writeback_done) return null;
  return (
    <Button type="submit" form={SCORE_FORM} disabled={busy}>
      {t("review.save")}
    </Button>
  );
}

/** The form the parts' inputs belong to; rendered once on the page. */
export function ScoreFormShell() {
  return (
    <Form method="post" id={SCORE_FORM} hidden>
      <input type="hidden" name="intent" value="score" />
    </Form>
  );
}
