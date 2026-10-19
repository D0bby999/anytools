/**
 * body.tsx
 * Body → Today: what the plan asks of today, the weigh-in, the week at a
 * glance and the last few sessions. Training sits beside studying here: the
 * same day, the same calm page, nothing that shouts.
 */
import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Play } from "lucide-react";
import type { Route } from "./+types/body";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { getOverview, setWeight, startWorkout } from "~/lib/body.server";
import { minutesOf, num, setsDone, WEEK_ORDER, weekdayNames } from "~/lib/body-types";
import { BodyTabs } from "~/components/body/body-tabs";
import { FIELD } from "~/components/body/fields";
import { WeightChart } from "~/components/body/weight-chart";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { PlateEmpty } from "~/components/ui/plate";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Body") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return getOverview(userId);
}

export async function action({ request }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "weigh") {
      const weight = Number(form.get("weight"));
      if (!Number.isFinite(weight) || weight <= 0) return { errorKey: "errors.weight" };
      await setWeight(userId, String(form.get("day") ?? ""), weight);
      return { weighed: true };
    }
    if (intent === "start") {
      const routine = String(form.get("routine_id") ?? "");
      const bw = Number(form.get("bodyweight"));
      const { workout } = await startWorkout(userId, {
        ...(routine ? { routine_id: routine } : {}),
        ...(Number.isFinite(bw) && bw > 0 ? { bodyweight: bw } : {}),
      });
      return redirect(`/body/workouts/${workout.id}`);
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic" };
}

export default function BodyToday({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("body");
  const { overview: o, names } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const unit = o.profile.unit;
  const days = weekdayNames(i18n.language);
  const routineName = (id: string | null) => o.routines.find((r) => r.id === id)?.name ?? "";
  const today = o.routines.find((r) => r.id === o.today.routine_id) ?? null;
  const lastWeight = o.weights[o.weights.length - 1] ?? null;
  // First run: no routine and no workout yet. Body's plate over the first step.
  const firstRun = o.routines.length === 0 && o.recent.length === 0;

  return (
    <div className="lp-measure">
      <PageHeader title={t("page.title")} lede={t("page.lead")} />
      <BodyTabs />

      {result && "errorKey" in result && result.errorKey ? (
        <Alert variant="destructive" className="mb-6">
          {t(result.errorKey === "errors.weight" ? "errors.weight" : "errors.generic")}
          {"errorDetail" in result && result.errorDetail ? ` (${result.errorDetail})` : null}
        </Alert>
      ) : null}

      {firstRun ? (
        <PlateEmpty name="part-body" className="mb-8">
          {t("firstRun.body")}{" "}
          <Link to="/body/coach" className="font-medium text-primary underline underline-offset-4">
            {t("today.askCoach")}
          </Link>{" "}
          ·{" "}
          <Link to="/body/routines/new" className="font-medium text-primary underline underline-offset-4">
            {t("today.writeOwn")}
          </Link>
        </PlateEmpty>
      ) : null}

      {/* Today: resume, start the planned routine, or rest. */}
      <section data-part="practise" aria-labelledby="lp-body-today" className="lp-keybox p-5 sm:p-6">
        <h2 id="lp-body-today" className="lp-section text-xl">
          {t("today.title", { day: days[o.today.weekday] })}
        </h2>
        {o.open ? (
          <>
            <p className="mt-2 text-sm leading-prose">
              {t("today.open", {
                name: o.open.routine_name || t("today.free"),
                done: o.open.entries.reduce((n, e) => n + setsDone(e), 0),
              })}
            </p>
            <Button asChild className="mt-4">
              <Link to={`/body/workouts/${o.open.id}`}>{t("today.resume")}</Link>
            </Button>
          </>
        ) : (
          <>
            {o.today.trained ? (
              <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                <Check aria-hidden="true" className="size-4 text-part" />
                {t("today.trained")}
              </p>
            ) : today ? (
              <p className="mt-2 text-sm leading-prose">
                {t("today.planned", { name: today.name, count: today.exercises.length })}
              </p>
            ) : (
              <p className="mt-2 max-w-[60ch] text-sm leading-prose text-muted-foreground">{t("today.rest")}</p>
            )}
            <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="start" />
              <label className="text-xs text-muted-foreground">
                {t("today.routine")}
                <select name="routine_id" defaultValue={today?.id ?? ""} className={FIELD}>
                  {o.routines.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                  <option value="">{t("today.free")}</option>
                </select>
              </label>
              <label className="min-w-36 text-xs text-muted-foreground">
                {t("today.bodyweight", { unit })}
                <input
                  type="number"
                  name="bodyweight"
                  inputMode="decimal"
                  step="0.1"
                  min="1"
                  max="1000"
                  defaultValue={lastWeight?.day === o.today.day ? num(lastWeight.weight) : ""}
                  className={FIELD}
                />
              </label>
              <Button type="submit" disabled={busy}>
                <Play aria-hidden="true" />
                {t("today.start")}
              </Button>
            </Form>
            {o.routines.length === 0 && !firstRun ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t("today.noPlan")}{" "}
                <Link to="/body/coach" className="font-medium text-primary underline underline-offset-4">
                  {t("today.askCoach")}
                </Link>{" "}
                ·{" "}
                <Link to="/body/routines/new" className="font-medium text-primary underline underline-offset-4">
                  {t("today.writeOwn")}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* The week, Monday first. */}
      <section aria-labelledby="lp-body-week" className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="lp-body-week" className="lp-section">
            {t("week.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("week.done", { count: o.this_week })}</p>
        </div>
        <ol className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-7">
          {WEEK_ORDER.map((d) => {
            const isToday = d === o.today.weekday;
            return (
              <li
                key={d}
                data-part={isToday ? "practise" : undefined}
                className={`flex gap-2 bg-card px-3 py-2 sm:flex-col sm:gap-1 ${isToday ? "bg-part-soft" : ""}`}
              >
                <span className="min-w-24 shrink-0 text-xs font-semibold text-muted-foreground sm:min-w-0">
                  {days[d]}
                  {isToday ? <span className="sr-only"> ({t("week.today")})</span> : null}
                </span>
                <span className="text-sm">{routineName(o.week[d] ?? null) || <span className="text-muted-foreground">{t("week.rest")}</span>}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-2">
          <Link to="/body/plan" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
            {t("week.edit")}
          </Link>
        </p>
      </section>

      {/* Weigh-in. */}
      <section aria-labelledby="lp-body-weight" className="mt-10">
        <h2 id="lp-body-weight" className="lp-section">
          {t("weight.title")}
        </h2>
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="weigh" />
          <input type="hidden" name="day" value={o.today.day} />
          <label className="min-w-40 text-xs text-muted-foreground">
            {t("weight.today", { unit })}
            <input type="number" name="weight" inputMode="decimal" step="0.1" min="1" max="1000" required className={FIELD} />
          </label>
          <Button type="submit" variant="outline" disabled={busy}>
            {t("weight.save")}
          </Button>
          {result && "weighed" in result ? (
            <span role="status" className="text-sm text-muted-foreground">
              {t("weight.saved")}
            </span>
          ) : null}
        </Form>
        <WeightChart weights={o.weights} goal={o.profile.goal_weight} unit={unit} />
      </section>

      {/* The last sessions. */}
      <section aria-labelledby="lp-body-recent" className="mt-10">
        <h2 id="lp-body-recent" className="lp-section">
          {t("recent.title")}
        </h2>
        {o.recent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("recent.none")}</p>
        ) : (
          <ul className="mt-3 divide-y border-y">
            {o.recent.map((w) => (
              <li key={w.id}>
                <Link to={`/body/workouts/${w.id}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 hover:bg-hover">
                  <span className="w-28 font-mono text-xs text-muted-foreground">{w.day}</span>
                  <span className="min-w-0 flex-1 font-medium">{w.routine_name || t("today.free")}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("recent.summary", {
                      count: w.entries.filter((e) => setsDone(e) > 0).length,
                      minutes: minutesOf(w),
                    })}
                  </span>
                  <span className="sr-only">
                    {w.entries.map((e) => names[e.exercise]?.name ?? e.exercise).join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2">
          <Link to="/body/progress" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
            {t("recent.all")}
          </Link>
        </p>
      </section>
    </div>
  );
}
