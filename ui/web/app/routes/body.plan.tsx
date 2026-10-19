/**
 * body.plan.tsx
 * Body → Plan: the routines, which weekday trains which, and the settings
 * every number depends on (unit, rest, goal weight).
 */
import { Form, Link, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import type { Route } from "./+types/body.plan";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { getOverview, saveProfile, setWeek } from "~/lib/body.server";
import { num, WEEK_ORDER, weekdayNames, type Unit } from "~/lib/body-types";
import { BodyTabs } from "~/components/body/body-tabs";
import { FIELD } from "~/components/body/fields";
import { usePolicyName } from "~/components/body/advice";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Training plan") },
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
  try {
    switch (String(form.get("intent") ?? "")) {
      case "week": {
        const week = Array.from({ length: 7 }, (_, d) => String(form.get(`day${d}`) ?? "") || null);
        await setWeek(userId, week);
        return { saved: "week" };
      }
      case "settings": {
        const goal = String(form.get("goal_weight") ?? "").trim();
        await saveProfile(userId, {
          unit: String(form.get("unit")) === "lb" ? "lb" : ("kg" as Unit),
          rest_sec: Number(form.get("rest_sec")) || 90,
          ...(goal === "" ? { clear_goal: true } : { goal_weight: Number(goal) }),
        });
        return { saved: "settings" };
      }
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic" };
}

export default function BodyPlan({ loaderData }: Route.ComponentProps) {
  const { t, i18n } = useTranslation("body");
  const { overview: o, names } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const policyName = usePolicyName();
  const days = weekdayNames(i18n.language);

  return (
    <div className="lp-measure">
      <PageHeader
        title={t("plan.title")}
        lede={t("plan.lead")}
        actions={
          <Button asChild>
            <Link to="/body/routines/new">
              <Plus aria-hidden="true" />
              {t("plan.newRoutine")}
            </Link>
          </Button>
        }
      />
      <BodyTabs />

      {result && "errorKey" in result ? (
        <Alert variant="destructive" className="mb-6">
          {t("errors.generic")}
          {"errorDetail" in result && result.errorDetail ? ` (${result.errorDetail})` : null}
        </Alert>
      ) : null}

      <section aria-labelledby="lp-plan-routines">
        <h2 id="lp-plan-routines" className="lp-section">
          {t("plan.routines")}
        </h2>
        {o.routines.length === 0 ? (
          <p className="mt-2 max-w-[60ch] text-sm leading-prose text-muted-foreground">
            {t("plan.empty")}{" "}
            <Link to="/body/routines/new" className="font-medium text-primary underline underline-offset-4">
              {t("plan.writeOne")}
            </Link>
            , {t("plan.or")}{" "}
            <Link to="/body/coach" className="font-medium text-primary underline underline-offset-4">
              {t("today.askCoach")}
            </Link>
          </p>
        ) : (
          <ul className="mt-3 divide-y border-y">
            {o.routines.map((r) => (
              <li key={r.id} className="py-4">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h3 className="min-w-0 flex-1 font-serif text-lg font-semibold">
                    <Link to={`/body/routines/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                  </h3>
                  <span className="text-xs text-muted-foreground">{policyName(r.prog)}</span>
                </div>
                {r.why ? <p className="mt-1 text-sm text-muted-foreground">{r.why}</p> : null}
                <p className="mt-1 text-sm">
                  {r.exercises.map((e) => names[e.exercise]?.name ?? e.exercise).join(" · ") || t("plan.noExercises")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="lp-plan-week" className="mt-10">
        <h2 id="lp-plan-week" className="lp-section">
          {t("plan.week")}
        </h2>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="week" />
          <div className="grid gap-3 sm:grid-cols-2">
            {WEEK_ORDER.map((d) => (
              <label key={d} className="text-xs text-muted-foreground">
                {days[d]}
                <select name={`day${d}`} defaultValue={o.week[d] ?? ""} className={FIELD}>
                  <option value="">{t("week.rest")}</option>
                  {o.routines.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button type="submit" variant="outline" disabled={busy}>
              {t("plan.saveWeek")}
            </Button>
            {result && "saved" in result && result.saved === "week" ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t("plan.saved")}
              </span>
            ) : null}
          </div>
        </Form>
      </section>

      <section aria-labelledby="lp-plan-settings" className="mt-10">
        <h2 id="lp-plan-settings" className="lp-section">
          {t("settings.title")}
        </h2>
        <Form method="post" className="mt-3 grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="intent" value="settings" />
          <label className="text-xs text-muted-foreground">
            {t("settings.unit")}
            <select name="unit" defaultValue={o.profile.unit} className={FIELD}>
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("settings.rest")}
            <input type="number" name="rest_sec" min="15" max="600" step="15" defaultValue={o.profile.rest_sec} className={FIELD} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("settings.goal", { unit: o.profile.unit })}
            <input
              type="number"
              name="goal_weight"
              inputMode="decimal"
              step="0.1"
              min="1"
              max="1000"
              defaultValue={num(o.profile.goal_weight)}
              className={FIELD}
            />
          </label>
          <p className="text-sm leading-snug text-muted-foreground sm:col-span-3">{t("settings.unitNote")}</p>
          <div className="flex items-center gap-3 sm:col-span-3">
            <Button type="submit" variant="outline" disabled={busy}>
              {t("settings.save")}
            </Button>
            {result && "saved" in result && result.saved === "settings" ? (
              <span role="status" className="text-sm text-muted-foreground">
                {t("plan.saved")}
              </span>
            ) : null}
          </div>
        </Form>
      </section>
    </div>
  );
}
