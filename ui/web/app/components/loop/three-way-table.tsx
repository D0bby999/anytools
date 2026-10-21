/**
 * three-way-table.tsx
 * One AI learning log: each metric measured three times — without AI, with
 * AI, and alone again days later — and what that pattern reads as. The third
 * column is the one that separates learning from delegating, so the reading
 * is computed from it (internal/learning/loop/ai_brief.go), never typed.
 *
 * A real table of inputs (I2): a row per metric, a column per measurement;
 * each row's reading follows as a Metric with its note.
 */
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { LogDetail, LogMetric, ThreeWayRow } from "~/lib/loop-types";
import { Button } from "~/components/ui/button";
import { InputTable } from "~/components/loop/input-table";
import { Metric } from "~/components/loop/metric";
import { ScrollBox } from "~/components/doc/scroll-box";

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
    <Form method="post" className="mt-6">
      <input type="hidden" name="intent" value="log" />
      <input type="hidden" name="log_id" value={detail.log.id} />
      <div className="lp-field-table">
        <ScrollBox>
          <table className="min-w-[40rem]">
            <caption className="sr-only">{t("log.title")}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">{t("up.log.metric")}</span>
                </th>
                <th scope="col">{t("log.measure")}</th>
                <th scope="col">{t("log.noAI")}</th>
                <th scope="col">{t("log.withAI")}</th>
                <th scope="col">{t("log.later")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row) => (
                <tr key={row.metric}>
                  <th scope="row">{metric[row.metric]}</th>
                  <td>
                    <input
                      name={`${row.metric}_measure`}
                      aria-label={`${metric[row.metric]}: ${t("log.measure")}`}
                      placeholder={t("log.measureHint")}
                      defaultValue={row.measure}
                    />
                  </td>
                  <td className="w-24">
                    <input
                      name={`${row.metric}_base`}
                      type="number"
                      step="any"
                      aria-label={`${metric[row.metric]}: ${t("log.noAI")}`}
                      defaultValue={v(row.baseline_noai.value)}
                    />
                  </td>
                  <td className="w-24">
                    <input
                      name={`${row.metric}_assisted`}
                      type="number"
                      step="any"
                      aria-label={`${metric[row.metric]}: ${t("log.withAI")}`}
                      defaultValue={v(row.assisted.value)}
                    />
                  </td>
                  <td className="w-24">
                    <input
                      name={`${row.metric}_delayed`}
                      type="number"
                      step="any"
                      aria-label={`${metric[row.metric]}: ${t("log.later")}`}
                      defaultValue={v(row.delayed_independent.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </div>
      {/* What each row's pattern reads as, computed on the server, each with
          what it cannot prove. */}
      {detail.rows.map((row) => (
        <Metric key={row.metric} label={metric[row.metric]} value={reading[row.reading]} cannotProve={row.cannot_prove} />
      ))}
      <InputTable
        caption={t("log.decision")}
        rows={[
          {
            id: `lp-log-decision-${detail.log.id}`,
            label: t("log.decision"),
            control: (
              <textarea
                id={`lp-log-decision-${detail.log.id}`}
                name="next_cycle_decision"
                rows={2}
                defaultValue={detail.log.next_cycle_decision}
              />
            ),
          },
        ]}
      />
      <Button type="submit" variant="outline" disabled={busy}>
        {t("log.save")}
      </Button>
    </Form>
  );
}
