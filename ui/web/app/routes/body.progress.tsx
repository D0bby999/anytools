/**
 * body.progress.tsx
 * Body → Progress: a year of training at a glance, body weight against the
 * goal, each lift's estimated one-rep max, which muscle groups got work, and
 * the full history.
 */
import { DateText } from "~/components/ui/date-text";
import { DatedList } from "~/components/doc/dated-list";
import { BookMeta } from "~/components/doc/book-meta";
import { RefTable } from "~/components/doc/ref-table";
import { Form } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/body.progress";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { getOverview, getStats, listWorkouts } from "~/lib/body.server";
import { minutesOf, num, setsDone } from "~/lib/body-types";
import { BodyTabs } from "~/components/body/body-tabs";
import { FIELD } from "~/components/body/fields";
import { Heatmap } from "~/components/body/heatmap";
import { TrendChart, WeightChart } from "~/components/body/weight-chart";
import { useMuscleName } from "~/components/body/muscles";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Training progress") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const [stats, history, { overview }] = await Promise.all([getStats(userId), listWorkouts(userId, 50), getOverview(userId)]);
  const wanted = new URL(request.url).searchParams.get("exercise") ?? "";
  return { stats, history: history.workouts, today: overview.today.day, wanted };
}

export default function BodyProgress({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("body");
  const { stats: s, history, today, wanted } = loaderData;
  const muscle = useMuscleName();
  const trend = s.exercises.find((e) => e.exercise === wanted) ?? s.exercises.find((e) => e.series.length > 0) ?? null;
  const idle = s.coverage.filter((c) => c.month === 0);

  return (
    <div className="lp-doc">
      <PageHeader title={t("progress.title")} lede={t("progress.lead")} />
      <BodyTabs />

      <BookMeta
        label={t("progress.title")}
        items={[
          { label: `${t("progress.workouts")}: ${s.workouts}` },
          { label: `${t("progress.thisWeek")}: ${s.this_week}` },
          { label: `${t("progress.hours")}: ${num(s.minutes / 60)}` },
        ]}
      />

      <section aria-labelledby="lp-progress-year" className="mt-10">
        <h2 id="lp-progress-year" className="lp-section">
          {t("heatmap.title")}
        </h2>
        <Heatmap days={s.heatmap} today={today} />
      </section>

      <section aria-labelledby="lp-progress-bests">
        <h2 id="lp-progress-bests">{t("up.personalBests")}</h2>
        <RefTable
          caption={t("up.personalBests")}
          columns={[t("up.exercise"), t("up.day"), t("set.weight", { unit: s.unit }), t("set.reps"), t("up.estimatedMax")]}
          rows={s.exercises.filter((e) => e.best).map((e) => [e.name, e.best!.day, num(e.best!.weight), e.best!.reps, num(e.best!.e1rm)])}
        />
      </section>

      <section aria-labelledby="lp-progress-weight" className="mt-10">
        <h2 id="lp-progress-weight" className="lp-section">
          {t("weight.title")}
        </h2>
        <WeightChart weights={s.weights} goal={s.goal_weight} unit={s.unit} />
      </section>

      <section aria-labelledby="lp-progress-lifts" className="mt-10">
        <h2 id="lp-progress-lifts" className="lp-section">
          {t("lifts.title")}
        </h2>
        <p className="mt-1 max-w-[64ch] text-sm leading-snug text-muted-foreground">{t("lifts.lead")}</p>
        {trend ? (
          <>
            <Form method="get" className="mt-3 flex flex-wrap items-end gap-3">
              <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t("lifts.pick")}
                <select name="exercise" defaultValue={trend.exercise} className={FIELD}>
                  {s.exercises
                    .filter((e) => e.series.length > 0)
                    .map((e) => (
                      <option key={e.exercise} value={e.exercise}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit" variant="outline">
                {t("lifts.show")}
              </Button>
            </Form>
            {trend.best ? (
              <p className="mt-3 text-sm">
                {t("lifts.best", {
                  e1rm: num(trend.best.e1rm),
                  unit: s.unit,
                  weight: num(trend.best.weight),
                  reps: trend.best.reps,
                  day: trend.best.day ?? "",
                })}
              </p>
            ) : null}
            {trend.series.length > 1 ? (
              <TrendChart
                points={trend.series.map((p) => ({ day: p.day ?? "", value: p.e1rm }))}
                label={t("lifts.chartLabel", { name: trend.name, count: trend.series.length })}
              />
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("lifts.none")}</p>
        )}
      </section>

      <section aria-labelledby="lp-progress-muscles" className="mt-10">
        <h2 id="lp-progress-muscles" className="lp-section">
          {t("coverage.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {idle.length === 0 ? t("coverage.allTrained") : t("coverage.idle", { list: idle.map((c) => muscle(c.group)).join(", ") })}
        </p>
        <RefTable
          caption={t("coverage.title")}
          columns={[t("coverage.group"), t("coverage.week"), t("coverage.month")]}
          rows={s.coverage.map((c) => [muscle(c.group), num(c.week), num(c.month)])}
        />
      </section>

      <section aria-labelledby="lp-progress-history" className="mt-10">
        <h2 id="lp-progress-history" className="lp-section">
          {t("history.title")}
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("recent.none")}</p>
        ) : (
          <DatedList
            label={t("history.title")}
            items={history.map((w) => ({
              date: <DateText iso={w.day} />,
              title: w.routine_name || t("today.free"),
              to: `/body/workouts/${w.id}`,
              note: t("recent.summary", { count: w.entries.filter((e) => setsDone(e) > 0).length, minutes: minutesOf(w) }),
            }))}
          />
        )}
      </section>
    </div>
  );
}
