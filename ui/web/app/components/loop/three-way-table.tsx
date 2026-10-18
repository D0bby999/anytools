/**
 * three-way-table.tsx
 * One AI learning log: each metric measured three times — without AI, with
 * AI, and alone again days later — and what that pattern reads as. The third
 * column is the one that separates learning from delegating, so the reading
 * is computed from it (internal/learning/loop/ai_brief.go), never typed.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { LogDetail, LogMetric, ThreeWayRow } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { Metric } from "~/components/loop/metric";

const num = "min-h-11 w-full rounded-md border border-control-border bg-background px-2 text-sm";

export function ThreeWayTable({ detail, busy }: { detail: LogDetail; busy: boolean }) {
  const { t } = useTranslation("loop");
  const metric: Record<LogMetric, string> = {
    completion: t("log.metric.completion"),
    quality: t("log.metric.quality"),
    independent_perf: t("log.metric.independent_perf"),
    rework: t("log.metric.rework"),
    cost: t("log.metric.cost"),
    transfer: t("log.metric.transfer"),
  };
  const reading: Record<ThreeWayRow["reading"], string> = {
    incomplete: t("log.reading.incomplete"),
    retained: t("log.reading.retained"),
    only_with_ai: t("log.reading.only_with_ai"),
    no_gain: t("log.reading.no_gain"),
  };
  const v = (n: number | null) => (n === null ? "" : String(n));

  return (
    <Form method="post" className="mt-3">
      <input type="hidden" name="intent" value="log" />
      <input type="hidden" name="log_id" value={detail.log.id} />
      <div className="hidden grid-cols-[1fr_5rem_5rem_5rem] gap-2 font-mono text-2xs uppercase tracking-wide text-faint sm:grid">
        <span>{t("log.measure")}</span>
        <span>{t("log.noAI")}</span>
        <span>{t("log.withAI")}</span>
        <span>{t("log.later")}</span>
      </div>
      {detail.rows.map((row) => (
        <div key={row.metric} className="mt-2">
          <Metric label={metric[row.metric]} value={reading[row.reading]} cannotProve={row.cannot_prove} className="border-b-0" />
          <div className="grid grid-cols-3 gap-2 border-b pb-3 sm:grid-cols-[1fr_5rem_5rem_5rem]">
            <input name={`${row.metric}_measure`} aria-label={t("log.measure")} placeholder={t("log.measureHint")} defaultValue={row.measure} className={`${num} col-span-3 sm:col-span-1`} />
            <input name={`${row.metric}_base`} type="number" step="any" aria-label={t("log.noAI")} defaultValue={v(row.baseline_noai.value)} className={num} />
            <input name={`${row.metric}_assisted`} type="number" step="any" aria-label={t("log.withAI")} defaultValue={v(row.assisted.value)} className={num} />
            <input name={`${row.metric}_delayed`} type="number" step="any" aria-label={t("log.later")} defaultValue={v(row.delayed_independent.value)} className={num} />
          </div>
        </div>
      ))}
      <label className="mt-4 block text-sm font-medium">
        {t("log.decision")}
        <textarea
          name="next_cycle_decision"
          rows={2}
          defaultValue={detail.log.next_cycle_decision}
          className="mt-1 w-full rounded-md border border-control-border bg-background px-3 py-2 text-sm"
        />
      </label>
      <Button type="submit" variant="outline" className="mt-2" disabled={busy}>
        {t("log.save")}
      </Button>
    </Form>
  );
}
