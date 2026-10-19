/**
 * body.workouts.$id.tsx
 * One workout: the guided session while it is open, and the same sheet,
 * still correctable, once it is finished (progression reads the log fresh,
 * so fixing a typo fixes the next target).
 *
 * The sets live in React state and are saved as the learner goes (a fetcher
 * that does not revalidate, so typing is never clobbered). Ticking a set
 * starts the rest timer; the screen is kept awake while a session is open.
 */
import { useEffect, useRef, useState } from "react";
import { Link, redirect, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Plus, Trash2, Trophy } from "lucide-react";
import type { Route } from "./+types/body.workouts.$id";
import { appTitle } from "~/lib/app-title";
import { requireUserId } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { addEntry, deleteWorkout, finishWorkout, getOverview, getWorkout, saveWorkout } from "~/lib/body.server";
import { num, parseJSON, setsDone, type Entry, type Names, type Record_, type Unit, type WorkoutSet } from "~/lib/body-types";
import { AdviceText } from "~/components/body/advice";
import { BodyTabs } from "~/components/body/body-tabs";
import { ExercisePicker } from "~/components/body/exercise-picker";
import { FIELD, NUMBER } from "~/components/body/fields";
import { RestTimer } from "~/components/body/rest-timer";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Plate } from "~/components/ui/plate";

export function meta({ matches }: Route.MetaArgs) {
  return [
    { title: appTitle(matches, "Workout") },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  try {
    const [{ workout, names }, { overview }] = await Promise.all([getWorkout(userId, params.id), getOverview(userId)]);
    return { workout, names, unit: overview.profile.unit, restSec: overview.profile.rest_sec };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

/** Saving as the learner types must not reload the page under their fingers. */
export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return formData?.get("intent") === "save" ? false : defaultShouldRevalidate;
}

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const entries = parseJSON<Entry[]>(form.get("entries"));
  try {
    // Every intent first saves what is on screen, so nothing typed is lost.
    if (entries && intent !== "delete") {
      const note = form.get("note");
      const bw = Number(form.get("bodyweight"));
      await saveWorkout(userId, params.id, {
        entries,
        ...(note !== null ? { note: String(note) } : {}),
        ...(form.get("bodyweight") === "" ? { clear_bodyweight: true } : Number.isFinite(bw) && bw > 0 ? { bodyweight: bw } : {}),
      });
    }
    switch (intent) {
      case "save":
        return { saved: true };
      case "add":
        await addEntry(userId, params.id, String(form.get("exercise") ?? ""));
        return { added: true };
      case "finish": {
        const { records } = await finishWorkout(userId, params.id);
        return { finished: true, records };
      }
      case "delete":
        await deleteWorkout(userId, params.id);
        return redirect("/body");
    }
  } catch (error) {
    return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return { errorKey: "errors.generic" };
}

type ActionData = { saved?: boolean; finished?: boolean; records?: Record_[]; errorKey?: string; errorDetail?: string };

/** Keeps the screen on while a session is open; released when it ends. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (live) lock = l;
          else void l.release();
        })
        .catch(() => {
          // Refused (battery saver, an old browser): the session still works.
        });
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", acquire);
      void lock?.release();
    };
  }, [on]);
}

export default function WorkoutPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("body");
  const { workout, names, unit, restSec } = loaderData;
  const open = workout.finished_at === null;
  const [entries, setEntries] = useState<Entry[]>(workout.entries);
  const [note, setNote] = useState(workout.note);
  const [bodyweight, setBodyweight] = useState(num(workout.bodyweight));
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const saver = useFetcher<ActionData>();
  const doer = useFetcher<ActionData>();
  const dirty = useRef(false);
  useWakeLock(open);

  // The loader's list changes identity only when the page revalidates (an
  // exercise added, the workout finished), never on an autosave: take it
  // then. Local edits went to the server with that same request.
  useEffect(() => {
    setEntries(workout.entries);
  }, [workout.entries]);

  const fields = () => ({ entries: JSON.stringify(entries), note, bodyweight });
  const { submit } = saver;
  useEffect(() => {
    if (!dirty.current) return;
    const id = window.setTimeout(() => {
      dirty.current = false;
      void submit({ intent: "save", entries: JSON.stringify(entries), note, bodyweight }, { method: "post" });
    }, 700);
    return () => window.clearTimeout(id);
  }, [entries, note, bodyweight, submit]);

  const edit = (i: number, f: (e: Entry) => Entry) => {
    dirty.current = true;
    setEntries((list) => list.map((e, j) => (j === i ? f(e) : e)));
  };
  const setSet = (i: number, k: number, patch: Partial<WorkoutSet>) => {
    const ticking = patch.done === true && !entries[i]?.sets[k]?.done;
    edit(i, (e) => ({ ...e, sets: e.sets.map((s, j) => (j === k ? { ...s, ...patch } : s)) }));
    if (ticking && open) setRestUntil(Date.now() + restSec * 1000);
  };

  const done = doer.data?.finished ? doer.data : saver.data?.finished ? saver.data : null;
  const error = doer.data?.errorKey ? doer.data : saver.data?.errorKey ? saver.data : null;
  const total = entries.reduce((n, e) => n + e.sets.length, 0);
  const ticked = entries.reduce((n, e) => n + setsDone(e), 0);

  return (
    <div className="lp-measure">
      <PageHeader
        title={workout.routine_name || t("today.free")}
        lede={open ? t("workout.lead", { done: ticked, total }) : t("workout.finishedLead", { day: workout.day })}
      />
      <BodyTabs />

      {error ? (
        <Alert variant="destructive" className="mb-6">
          {t("errors.generic")}
          {error.errorDetail ? ` (${error.errorDetail})` : null}
        </Alert>
      ) : null}

      {done ? <Finished records={done.records ?? []} unit={unit} /> : null}

      <ol className="space-y-6">
        {entries.map((e, i) => (
          <li key={`${e.exercise}-${i}`} className="rounded-lg border bg-card p-4 sm:p-5">
            <EntryCard
              entry={e}
              names={names}
              unit={unit}
              onSet={(k, patch) => setSet(i, k, patch)}
              onAddSet={() =>
                edit(i, (x) => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] ?? { weight: 0, reps: 0 }), done: false }] }))
              }
              onRemoveSet={() => edit(i, (x) => ({ ...x, sets: x.sets.slice(0, -1) }))}
              onRemove={() => {
                dirty.current = true;
                setEntries((list) => list.filter((_, j) => j !== i));
              }}
            />
          </li>
        ))}
      </ol>

      <section aria-labelledby="lp-workout-add" className="mt-6">
        <h2 id="lp-workout-add" className="sr-only">
          {t("workout.add")}
        </h2>
        <ExercisePicker
          label={t("workout.add")}
          onPick={(ex) => void doer.submit({ intent: "add", exercise: ex.id, ...fields() }, { method: "post" })}
        />
      </section>

      <section aria-labelledby="lp-workout-notes" className="mt-8 grid gap-4 sm:grid-cols-[10rem_1fr]">
        <h2 id="lp-workout-notes" className="sr-only">
          {t("workout.notes")}
        </h2>
        <label className="text-xs text-muted-foreground">
          {t("today.bodyweight", { unit })}
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="1"
            max="1000"
            value={bodyweight}
            onChange={(e) => {
              dirty.current = true;
              setBodyweight(e.target.value);
            }}
            className={FIELD}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("workout.note")}
          <textarea
            value={note}
            maxLength={1000}
            rows={2}
            onChange={(e) => {
              dirty.current = true;
              setNote(e.target.value);
            }}
            className={`${FIELD} py-2`}
          />
        </label>
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {open ? (
          <Button
            type="button"
            disabled={doer.state !== "idle"}
            onClick={() => {
              setRestUntil(null);
              void doer.submit({ intent: "finish", ...fields() }, { method: "post" });
            }}
          >
            <Check aria-hidden="true" />
            {t("workout.finish")}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to="/body">{t("workout.back")}</Link>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (window.confirm(open ? t("workout.discardConfirm") : t("workout.deleteConfirm"))) {
              void doer.submit({ intent: "delete" }, { method: "post" });
            }
          }}
        >
          <Trash2 aria-hidden="true" />
          {open ? t("workout.discard") : t("workout.delete")}
        </Button>
        <span role="status" className="text-xs text-muted-foreground">
          {saver.state !== "idle" ? t("workout.saving") : saver.data?.saved ? t("workout.saved") : ""}
        </span>
      </div>

      {open ? <RestTimer until={restUntil} onChange={setRestUntil} /> : null}
    </div>
  );
}

function Finished({ records, unit }: { records: Record_[]; unit: Unit }) {
  const { t } = useTranslation("body");
  return (
    <section
      data-part="practise"
      aria-labelledby="lp-workout-done"
      className="mb-8 grid items-center gap-x-6 lp-keybox p-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]"
    >
      <div className="min-w-0">
      <h2 id="lp-workout-done" className="lp-section flex items-center gap-2 text-xl">
        <Trophy aria-hidden="true" className="size-5 text-part" />
        {t("finished.title")}
      </h2>
      {records.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("finished.noRecords")}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {records.map((r) => (
            <li key={r.exercise} className="text-sm">
              {t("finished.record", { name: r.name, e1rm: num(r.e1rm), unit, weight: num(r.weight), reps: r.reps })}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("finished.study")}</p>
      <p className="mt-2 flex flex-wrap gap-x-5">
        <Link to="/home" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
          {t("finished.home")}
        </Link>
        <Link to="/body/progress" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4">
          {t("finished.progress")}
        </Link>
      </p>
      </div>
      {/* The moment a session ends: Body's plate, beside the words on a wide screen. */}
      <Plate name="part-body" sizes="12rem" className="hidden max-w-48 sm:block" />
    </section>
  );
}

function EntryCard({
  entry,
  names,
  unit,
  onSet,
  onAddSet,
  onRemoveSet,
  onRemove,
}: {
  entry: Entry;
  names: Names;
  unit: Unit;
  onSet: (k: number, patch: Partial<WorkoutSet>) => void;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("body");
  const name = names[entry.exercise]?.name ?? entry.exercise;
  const mode = entry.target.mode;
  const target =
    mode === "time"
      ? t("target.time", { sets: entry.target.sets, sec: entry.target.sec ?? 0 })
      : mode === "cardio"
        ? t("target.cardio", { min: num(entry.target.min) })
        : t("target.reps", { sets: entry.target.sets, reps: entry.target.reps ?? 0 });
  const load = entry.target.weight ? t("target.at", { weight: num(entry.target.weight), unit }) : "";
  return (
    <>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <h3 className="min-w-0 flex-1 font-serif text-lg font-semibold">
          <Link to={`/body/library?id=${entry.exercise}`} className="hover:underline">
            {name}
          </Link>
        </h3>
        <span className="text-sm font-medium tabular-nums">
          {target} {load}
        </span>
      </div>
      <AdviceText advice={entry.advice} unit={unit} />

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="w-10 py-1 font-medium">
              {t("set.number")}
            </th>
            {mode === "cardio" ? (
              <>
                <th scope="col" className="py-1 font-medium">{t("set.minutes")}</th>
                <th scope="col" className="py-1 font-medium">{t("set.speed")}</th>
              </>
            ) : (
              <>
                <th scope="col" className="py-1 font-medium">{t("set.weight", { unit })}</th>
                <th scope="col" className="py-1 font-medium">{mode === "time" ? t("set.seconds") : t("set.reps")}</th>
              </>
            )}
            <th scope="col" className="min-w-16 py-1 text-right font-medium">
              {t("set.done")}
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.sets.map((s, k) => {
            const label = t("set.label", { name, n: k + 1 });
            const numberField = (value: number | undefined, key: keyof WorkoutSet, what: string, step = "1") => (
              <input
                type="number"
                inputMode={step === "1" ? "numeric" : "decimal"}
                step={step}
                min="0"
                aria-label={`${label}: ${what}`}
                value={value ?? 0}
                onChange={(e) => onSet(k, { [key]: Number(e.target.value) || 0 })}
                className={NUMBER}
              />
            );
            return (
              <tr key={k} className={s.done ? "bg-part-soft" : undefined} data-part={s.done ? "practise" : undefined}>
                <td className="py-1.5 font-mono text-xs text-muted-foreground">{k + 1}</td>
                {mode === "cardio" ? (
                  <>
                    <td className="py-1.5">{numberField(s.min, "min", t("set.minutes"), "0.5")}</td>
                    <td className="py-1.5">{numberField(s.speed, "speed", t("set.speed"), "0.1")}</td>
                  </>
                ) : (
                  <>
                    <td className="py-1.5">{numberField(s.weight, "weight", t("set.weight", { unit }), "0.5")}</td>
                    <td className="py-1.5">
                      {mode === "time" ? numberField(s.sec, "sec", t("set.seconds")) : numberField(s.reps, "reps", t("set.reps"))}
                    </td>
                  </>
                )}
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    aria-pressed={s.done}
                    aria-label={s.done ? t("set.undo", { label }) : t("set.tick", { label })}
                    onClick={() => onSet(k, { done: !s.done })}
                    className={`inline-flex size-11 items-center justify-center rounded-md border transition-colors ${
                      s.done ? "border-part bg-part text-part-foreground" : "border-control-border bg-card hover:bg-hover"
                    }`}
                  >
                    <Check aria-hidden="true" className="size-5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onAddSet} disabled={entry.sets.length >= 20}>
          <Plus aria-hidden="true" />
          {t("set.add")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRemoveSet} disabled={entry.sets.length <= 1}>
          {t("set.remove")}
        </Button>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
          {t("workout.removeExercise")}
        </Button>
      </div>
    </>
  );
}
