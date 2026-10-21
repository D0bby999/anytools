/**
 * today-block.tsx
 * Home's "Today" block (up-methods phase 13): the next task of the learning
 * state touched most recently, and its minimum version.
 *
 * The "Low day" switch is up's bad-day contract made visible: on a low day the
 * block shows only the minimum and what the learner wrote as still worth
 * keeping, so the full task is not there to argue with. The switch lives in a
 * cookie for the learner's local day (low-day.server.ts); no record of the low
 * day is kept, as up asks.
 */
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Plate } from "~/components/ui/plate";

/** The fields Home reads from a learning state, and nothing more. */
export type TodayState = {
  id: string;
  goal: string;
  next_task: string;
  next_task_minimum: string;
  still_worth_keeping: string;
};

export function TodayBlock({ today, lowDay }: { today: TodayState | null; lowDay: boolean }) {
  const { t } = useTranslation("loop");
  const fetcher = useFetcher();
  if (!today) return null;

  // While the switch is posting, show where it is going.
  const pending = fetcher.formData?.get("on");
  const low = pending == null ? lowDay : pending === "1";
  const rows = low
    ? [
        { label: t("today.minimum"), value: today.next_task_minimum },
        { label: t("today.keep"), value: today.still_worth_keeping },
      ]
    : [
        { label: t("today.nextTask"), value: today.next_task },
        { label: t("today.minimum"), value: today.next_task_minimum },
      ];

  return (
    <section aria-labelledby="lp-today">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="lp-today" className="lp-section text-xl">
          {t("today.title")}
        </h2>
        <fetcher.Form method="post" action="/app/api/low-day">
          <input type="hidden" name="on" value={low ? "0" : "1"} />
          <button
            type="submit"
            aria-pressed={low}
            aria-describedby="lp-today-low-hint"
            className="inline-flex min-h-11 items-center rounded-md border border-control-border bg-card px-4 text-sm font-medium transition-colors hover:bg-hover aria-pressed:border-primary aria-pressed:bg-selected aria-pressed:text-selected-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            {t("today.lowDay")}
          </button>
        </fetcher.Form>
      </div>
      <p id="lp-today-low-hint" className="mt-1 text-xs text-muted-foreground">
        {t("today.lowDayHint")}
      </p>
      {/* A low day: the seedling beside the minimum, so the smaller step reads as
          the plan, not a failure. One plate, from sm up. */}
      <div className={low ? "grid items-start gap-x-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)]" : undefined}>
        <div className="min-w-0">
          <Link
            to={`/loop/state/${today.id}`}
            className="mt-4 block font-serif text-2xl leading-snug font-semibold text-balance underline-offset-4 hover:text-primary hover:underline"
          >
            {today.goal}
          </Link>
          <dl className="mt-3 border-t border-part-line">
            {rows.map((r) => (
              <div key={r.label} className="grid gap-x-4 border-b border-part-line py-3 text-sm sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">{r.label}</dt>
                <dd className="font-medium">{r.value || <span className="font-normal text-faint">{t("today.none")}</span>}</dd>
              </div>
            ))}
          </dl>
          <Link
            to={`/loop/state/${today.id}#lp-state-interrupt`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            {t("today.interrupt")}
          </Link>
        </div>
        {low ? <Plate name="low-day" sizes="9rem" className="mt-4 hidden max-w-36 sm:block" /> : null}
      </div>
    </section>
  );
}
