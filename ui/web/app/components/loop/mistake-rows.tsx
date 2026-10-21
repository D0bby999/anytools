/**
 * mistake-rows.tsx
 * The week's diagnosed mistakes: what showed it, the suspected cause, how
 * sure, the test that would check it, and when to give up on it. Written back,
 * each becomes a hypothesis on the state. One blank row is always offered.
 *
 * An input table (I2), a row per mistake, its inputs joined to the review's
 * one form (score-form.tsx). The action reads each column in row order.
 */
import { useTranslation } from "react-i18next";
import type { ReviewError } from "~/lib/loop-types";
import { SCORE_FORM } from "~/components/loop/score-form";
import { ScrollBox } from "~/components/doc/scroll-box";

const BLANK: ReviewError = { evidence: "", cause: "", confidence: "", next_test: "", stop_condition: "" };

export function MistakeRows({ errors, disabled }: { errors: ReviewError[]; disabled?: boolean }) {
  const { t } = useTranslation("loop");
  const rows = [...errors, BLANK];
  const columns = [t("review.errEvidence"), t("review.errCause"), t("review.errConfidence"), t("review.errNextTest"), t("review.errStop")];
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">{t("review.mistakes")}</legend>
      <p className="mt-0! text-muted-foreground">{t("review.mistakesHint")}</p>
      <div className="lp-field-table">
        <ScrollBox>
          <table className="min-w-[44rem]">
            <thead>
              <tr>
                <th scope="col" className="w-12">
                  <span className="sr-only">{t("up.review.row")}</span>
                </th>
                {columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i}>
                  <th scope="row">{i + 1}</th>
                  <td>
                    <input name="err_evidence" aria-label={t("review.errEvidence")} defaultValue={e.evidence} form={SCORE_FORM} />
                  </td>
                  <td>
                    <input name="err_cause" aria-label={t("review.errCause")} defaultValue={e.cause} form={SCORE_FORM} />
                  </td>
                  <td className="w-32">
                    <select name="err_confidence" aria-label={t("review.errConfidence")} defaultValue={e.confidence} form={SCORE_FORM}>
                      <option value="">–</option>
                      <option value="low">{t("review.low")}</option>
                      <option value="medium">{t("review.medium")}</option>
                      <option value="high">{t("review.high")}</option>
                    </select>
                  </td>
                  <td>
                    <input name="err_next_test" aria-label={t("review.errNextTest")} defaultValue={e.next_test} form={SCORE_FORM} />
                  </td>
                  <td>
                    <input name="err_stop" aria-label={t("review.errStop")} defaultValue={e.stop_condition} form={SCORE_FORM} />
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
