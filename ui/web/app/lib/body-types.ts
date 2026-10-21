/**
 * body-types.ts
 * Body's shapes, as the API sends them (internal/body), and the small pure
 * helpers the pages share. No server import: components use these too.
 */

export type Unit = "kg" | "lb";
export type Mode = "reps" | "time" | "cardio";
export type Policy = "" | "off" | "linear" | "double" | "time";

export type PlanExercise = {
  exercise: string;
  mode: Mode;
  sets: number;
  reps?: number;
  reps_min?: number;
  sec?: number;
  min?: number;
  speed?: number;
  weight?: number;
  prog?: Policy;
  inc?: number;
  why?: string;
};

export type Routine = {
  id: string;
  name: string;
  prog: Policy;
  why?: string;
  exercises: PlanExercise[];
  position: number;
};

/** Sunday first, as time.Weekday: a routine id or null for a rest day. */
export type Week = (string | null)[];

export type Prescription = {
  policy: Policy;
  kind: "first" | "up" | "hold" | "deload" | "off";
  reason?: string;
  weight?: number;
  reps?: number;
  sec?: number;
  step?: number;
  stalls?: number;
  left?: number;
};

export type WorkoutSet = { weight: number; reps: number; sec?: number; min?: number; speed?: number; done: boolean };

export type Entry = { exercise: string; target: PlanExercise; advice?: Prescription; sets: WorkoutSet[] };

export type Workout = {
  id: string;
  routine_id: string | null;
  routine_name: string;
  day: string;
  started_at: string;
  finished_at: string | null;
  bodyweight: number | null;
  entries: Entry[];
  note: string;
};

export type Weight = { day: string; weight: number };

export type Intake = {
  goal: string;
  experience: string;
  days_per_week: number;
  preferred_days: number[];
  session_min: number;
  equipment: string[];
  limitations: string;
  note: string;
};

export type Profile = { unit: Unit; goal_weight: number | null; rest_sec: number; intake: Intake | null };

export type Overview = {
  profile: Profile;
  routines: Routine[];
  week: Week;
  today: { day: string; weekday: number; routine_id: string | null; trained: boolean };
  open: Workout | null;
  recent: Workout[];
  this_week: number;
  weights: Weight[];
};

export type ExerciseName = { name: string; body_part: string; equipment: string; target: string };
export type Names = Record<string, ExerciseName>;

export type Exercise = {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary: string[];
  steps?: string[];
  /** "opengym" or "fedb" (free-exercise-db): whose text it is. */
  source?: "opengym" | "fedb";
  /** free-exercise-db's id for its start and end photos (lib/body-library.ts). */
  photo?: string;
  /** wger's names in other languages, each with its licence and author, and its video. */
  wger?: { id: number; names: Record<string, string>; licences: Record<string, string>; authors: Record<string, string>; video?: boolean };
};

export type Facets = { body_parts: string[]; equipment: string[] };

export type BestSet = { e1rm: number; weight: number; reps: number; day?: string };
export type Record_ = { exercise: string; name: string; e1rm: number; weight: number; reps: number; previous: number };

export type Stats = {
  unit: Unit;
  goal_weight: number | null;
  workouts: number;
  this_week: number;
  minutes: number;
  heatmap: { day: string; minutes: number; workouts: number }[];
  weights: Weight[];
  exercises: { exercise: string; name: string; sessions: number; best: BestSet | null; series: BestSet[] }[];
  coverage: { group: string; week: number; month: number }[];
};

export type CoachRoutine = { key: string; name: string; prog?: Policy; why?: string; exercises: PlanExercise[] };
export type CoachPlan = { name: string; summary: string; based_on: string; routines: CoachRoutine[]; week: string[] };

export type Proposal = {
  id: string;
  kind: "plan" | "review";
  status: "proposed" | "accepted" | "declined" | "replaced" | "reverted";
  intake?: Intake;
  request: string;
  plan: CoachPlan | null;
  changes: { what: string; why: string }[];
  notes: string[];
  nochange: boolean;
  reading: string;
  created_at: string;
  decided_at: string | null;
  can_revert: boolean;
};

export const GOALS = ["strength", "muscle", "fat_loss", "fitness", "health"] as const;
export const EXPERIENCES = ["new", "some", "experienced"] as const;
export const MODES: Mode[] = ["reps", "time", "cardio"];

/** The policies a mode can use, as internal/body PoliciesFor. */
export function policiesFor(mode: Mode): Policy[] {
  if (mode === "reps") return ["", "off", "linear", "double"];
  if (mode === "time") return ["", "off", "time"];
  return ["", "off"];
}

/** A number as the learner reads it: no trailing ".0". */
export function num(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(Math.round(n * 10) / 10);
}

/** Weekday names in the page's language, Sunday first (2026-10-18 is a Sunday). */
export function weekdayNames(lang: string, style: "long" | "short" = "long"): string[] {
  const fmt = new Intl.DateTimeFormat(lang, { weekday: style, timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, d) => fmt.format(new Date(Date.UTC(2026, 9, 18 + d))));
}

/** Monday-first order of weekday indexes, the way a training week is read. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Done sets of an entry, of all its sets. */
export function setsDone(e: Entry): number {
  return e.sets.filter((s) => s.done).length;
}

/** Minutes a finished workout ran, capped as the API caps it. */
export function minutesOf(w: Workout): number {
  if (!w.finished_at) return 0;
  const m = Math.floor((Date.parse(w.finished_at) - Date.parse(w.started_at)) / 60000);
  return Math.max(0, Math.min(m, 240));
}

/** Parses a JSON form field; null when it is missing or malformed. */
export function parseJSON<T>(value: FormDataEntryValue | null): T | null {
  try {
    return JSON.parse(String(value ?? "")) as T;
  } catch {
    return null;
  }
}
