/**
 * body.routines.$id.tsx
 * One routine, written by hand: `/body/routines/new` creates, an id edits.
 * Exercises come from the library; each says how it is logged (reps, a
 * timed hold, cardio), its target, and optionally its own progression.
 */
import { useState } from "react";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Route } from "./+types/body.routines.$id";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { createRoutine, deleteRoutine, getOverview, getRoutine, updateRoutine } from "~/lib/body.server";
import { MODES, parseJSON, policiesFor, type Mode, type Names, type PlanExercise, type Policy } from "~/lib/body-types";
import { usePolicyName } from "~/components/body/advice";
import { BodyTabs } from "~/components/body/body-tabs";
import { ExercisePicker } from "~/components/body/exercise-picker";
import { FIELD } from "~/components/body/fields";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Routine") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { overview } = await getOverview(userId);
  if (params.id === "new") return { routine: null, names: {} as Names, unit: overview.profile.unit };
  try {
    const { routine, names } = await getRoutine(userId, params.id);
    return { routine, names, unit: overview.profile.unit };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "delete") {
      await deleteRoutine(userId, params.id);
      return redirect("/body/plan");
    }
    const body = {
      name: String(form.get("name") ?? ""),
      prog: String(form.get("prog") ?? "") as Policy,
      exercises: parseJSON<PlanExercise[]>(form.get("exercises")) ?? [],
    };
    if (params.id === "new") await createRoutine(userId, body);
    else await updateRoutine(userId, params.id, body);
    return redirect("/body/plan");
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
}

const SMALL = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-2 text-sm tabular-nums text-foreground";

export default function RoutineEditor({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("body");
  const { routine, unit } = loaderData;
  const result = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const policyName = usePolicyName();
  const [names, setNames] = useState<Names>(loaderData.names);
  const [exercises, setExercises] = useState<PlanExercise[]>(routine?.exercises ?? []);
  const set = (i: number, patch: Partial<PlanExercise>) =>
    setExercises((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const move = (i: number, by: number) =>
    setExercises((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      if (item) next.splice(i + by, 0, item);
      return next;
    });

  return (
    <div className="lp-measure">
      <PageHeader title={routine ? routine.name : t("routine.new")} lede={t("routine.lead")} />
      <BodyTabs />

      {result?.errorKey ? (
        <Alert variant="destructive" className="mb-6">
          {t("errors.generic")}
          {result.errorDetail ? ` (${result.errorDetail})` : null}
        </Alert>
      ) : null}

      <Form method="post" className="space-y-6">
        <input type="hidden" name="exercises" value={JSON.stringify(exercises)} />
        <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
          <label className="text-xs text-muted-foreground">
            {t("routine.name")}
            <input name="name" required maxLength={60} defaultValue={routine?.name ?? ""} className={FIELD} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("routine.prog")}
            <select name="prog" defaultValue={routine?.prog ?? ""} className={FIELD}>
              {(["", "linear", "double", "time", "off"] as Policy[]).map((p) => (
                <option key={p} value={p}>
                  {policyName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm leading-snug text-muted-foreground">{t("routine.progNote")}</p>

        <ol className="space-y-4">
          {exercises.map((e, i) => {
            const name = names[e.exercise]?.name ?? e.exercise;
            return (
              <li key={`${e.exercise}-${i}`} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 font-medium">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    {name}
                  </h3>
                  <Button type="button" size="icon" variant="ghost" aria-label={t("routine.up", { name })} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("routine.down", { name })}
                    disabled={i === exercises.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("routine.remove", { name })}
                    onClick={() => setExercises((list) => list.filter((_, j) => j !== i))}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
                {e.why ? <p className="mt-1 text-sm text-muted-foreground">{e.why}</p> : null}
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="text-xs text-muted-foreground">
                    {t("routine.mode")}
                    <select
                      value={e.mode}
                      onChange={(ev) => set(i, { mode: ev.target.value as Mode, prog: "" })}
                      className={SMALL}
                    >
                      {MODES.map((m) => (
                        <option key={m} value={m}>
                          {m === "reps" ? t("mode.reps") : m === "time" ? t("mode.time") : t("mode.cardio")}
                        </option>
                      ))}
                    </select>
                  </label>
                  {e.mode !== "cardio" ? (
                    <label className="text-xs text-muted-foreground">
                      {t("routine.sets")}
                      <input type="number" min="1" max="10" value={e.sets} onChange={(ev) => set(i, { sets: Number(ev.target.value) })} className={SMALL} />
                    </label>
                  ) : null}
                  {e.mode === "reps" ? (
                    <>
                      <label className="text-xs text-muted-foreground">
                        {t("routine.reps")}
                        <input type="number" min="1" max="100" value={e.reps ?? 10} onChange={(ev) => set(i, { reps: Number(ev.target.value) })} className={SMALL} />
                      </label>
                      <label className="text-xs text-muted-foreground">
                        {t("routine.repsMin")}
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={e.reps_min ?? 0}
                          onChange={(ev) => set(i, { reps_min: Number(ev.target.value) || undefined })}
                          className={SMALL}
                        />
                      </label>
                    </>
                  ) : e.mode === "time" ? (
                    <label className="text-xs text-muted-foreground">
                      {t("routine.sec")}
                      <input type="number" min="5" max="3600" value={e.sec ?? 45} onChange={(ev) => set(i, { sec: Number(ev.target.value) })} className={SMALL} />
                    </label>
                  ) : (
                    <>
                      <label className="text-xs text-muted-foreground">
                        {t("routine.min")}
                        <input type="number" min="1" max="300" value={e.min ?? 20} onChange={(ev) => set(i, { min: Number(ev.target.value) })} className={SMALL} />
                      </label>
                      <label className="text-xs text-muted-foreground">
                        {t("set.speed")}
                        <input
                          type="number"
                          min="0"
                          max="60"
                          step="0.1"
                          value={e.speed ?? 0}
                          onChange={(ev) => set(i, { speed: Number(ev.target.value) })}
                          className={SMALL}
                        />
                      </label>
                    </>
                  )}
                  {e.mode !== "cardio" ? (
                    <label className="text-xs text-muted-foreground">
                      {t("set.weight", { unit })}
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        step="0.5"
                        value={e.weight ?? 0}
                        onChange={(ev) => set(i, { weight: Number(ev.target.value) })}
                        className={SMALL}
                      />
                    </label>
                  ) : null}
                  <label className="text-xs text-muted-foreground">
                    {t("routine.exerciseProg")}
                    <select value={e.prog ?? ""} onChange={(ev) => set(i, { prog: ev.target.value as Policy })} className={SMALL}>
                      {policiesFor(e.mode).map((p) => (
                        <option key={p} value={p}>
                          {p === "" ? t("policy.routine") : policyName(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
        {exercises.length === 0 ? <p className="text-sm text-muted-foreground">{t("routine.empty")}</p> : null}

        <ExercisePicker
          onPick={(ex) => {
            setNames((n) => ({ ...n, [ex.id]: { name: ex.name, body_part: ex.body_part, equipment: ex.equipment, target: ex.target } }));
            const cardio = ex.body_part === "cardio";
            setExercises((list) => [
              ...list,
              cardio ? { exercise: ex.id, mode: "cardio", sets: 1, min: 20 } : { exercise: ex.id, mode: "reps", sets: 3, reps: 10 },
            ]);
          }}
        />

        <div className="flex flex-wrap items-center gap-3 border-t pt-6">
          <Button type="submit" disabled={busy || exercises.length > 15}>
            {t("routine.save")}
          </Button>
          {routine ? (
            <Button
              type="submit"
              name="intent"
              value="delete"
              variant="ghost"
              formNoValidate
              onClick={(ev) => {
                if (!window.confirm(t("routine.deleteConfirm"))) ev.preventDefault();
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("routine.delete")}
            </Button>
          ) : null}
        </div>
      </Form>
    </div>
  );
}
