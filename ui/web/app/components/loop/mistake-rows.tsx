/**
 * mistake-rows.tsx
 * The week's diagnosed mistakes: what showed it, the suspected cause, how
 * sure, the test that would check it, and when to give up on it. Written back,
 * each becomes a hypothesis on the state. One blank row is always offered.
 */
import { useTranslation } from "react-i18next";
import type { ReviewError } from "~/lib/loop-types";

const cell = "min-h-11 w-full rounded-md border border-control-border bg-background px-2 text-sm";
const BLANK: ReviewError = { evidence: "", cause: "", confidence: "", next_test: "", stop_condition: "" };

export function MistakeRows({ errors }: { errors: ReviewError[] }) {
  const { t } = useTranslation("loop");
  const rows = [...errors, BLANK];
  return (
    <fieldset>
      <legend className="text-sm font-medium">{t("review.mistakes")}</legend>
      <p className="text-xs text-muted-foreground">{t("review.mistakesHint")}</p>
      {rows.map((e, i) => (
        <div key={i} className="mt-2 grid gap-2 border-b pb-2 sm:grid-cols-2">
          <input name="err_evidence" aria-label={t("review.errEvidence")} placeholder={t("review.errEvidence")} defaultValue={e.evidence} className={cell} />
          <input name="err_cause" aria-label={t("review.errCause")} placeholder={t("review.errCause")} defaultValue={e.cause} className={cell} />
          <input name="err_next_test" aria-label={t("review.errNextTest")} placeholder={t("review.errNextTest")} defaultValue={e.next_test} className={cell} />
          <input name="err_stop" aria-label={t("review.errStop")} placeholder={t("review.errStop")} defaultValue={e.stop_condition} className={cell} />
          <select name="err_confidence" aria-label={t("review.errConfidence")} defaultValue={e.confidence} className={cell}>
            <option value="">{t("review.errConfidence")}</option>
            <option value="low">{t("review.low")}</option>
            <option value="medium">{t("review.medium")}</option>
            <option value="high">{t("review.high")}</option>
          </select>
        </div>
      ))}
    </fieldset>
  );
}
