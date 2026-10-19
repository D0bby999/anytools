/**
 * body.server.ts
 * Body's thin API module. Server-side only; every call is scoped by an
 * explicit user id, as in vocab.server.ts.
 */
import { apiFetch } from "~/lib/api.server";
import type {
  Exercise,
  Facets,
  Intake,
  Names,
  Overview,
  PlanExercise,
  Policy,
  Profile,
  Proposal,
  Record_,
  Routine,
  Stats,
  Unit,
  Week,
  Weight,
  Workout,
} from "~/lib/body-types";

const json = (method: string, body?: unknown) => ({ method, body });

export function getOverview(userId: string) {
  return apiFetch<{ overview: Overview; names: Names }>("/v1/body", userId);
}

export function saveProfile(
  userId: string,
  body: { unit?: Unit; goal_weight?: number; clear_goal?: boolean; rest_sec?: number },
) {
  return apiFetch<Profile>("/v1/body/profile", userId, json("PUT", body));
}

export function searchExercises(
  userId: string,
  filter: { q?: string; body_part?: string; equipment?: string; limit?: number; offset?: number },
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v !== undefined && v !== "") params.set(k, String(v));
  return apiFetch<{ exercises: Exercise[]; total: number; facets: Facets }>(`/v1/body/exercises?${params}`, userId);
}

export function getExercise(userId: string, id: string) {
  return apiFetch<{ exercise: Exercise }>(`/v1/body/exercises?id=${encodeURIComponent(id)}`, userId);
}

export function getStats(userId: string) {
  return apiFetch<Stats>("/v1/body/stats", userId);
}

type RoutineBody = { name: string; prog: Policy; exercises: PlanExercise[] };

export function createRoutine(userId: string, body: RoutineBody) {
  return apiFetch<{ routine: Routine; names: Names }>("/v1/body/routines", userId, json("POST", body));
}

export function getRoutine(userId: string, id: string) {
  return apiFetch<{ routine: Routine; names: Names }>(`/v1/body/routines/${encodeURIComponent(id)}`, userId);
}

export function updateRoutine(userId: string, id: string, body: RoutineBody) {
  return apiFetch<{ routine: Routine; names: Names }>(`/v1/body/routines/${encodeURIComponent(id)}`, userId, json("PUT", body));
}

export function deleteRoutine(userId: string, id: string) {
  return apiFetch<void>(`/v1/body/routines/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

export function setWeek(userId: string, week: Week) {
  return apiFetch<{ week: Week }>("/v1/body/week", userId, json("PUT", { week }));
}

export function startWorkout(userId: string, body: { routine_id?: string; bodyweight?: number }) {
  return apiFetch<{ workout: Workout; created: boolean; names: Names }>("/v1/body/workouts", userId, json("POST", body));
}

export function listWorkouts(userId: string, limit = 50) {
  return apiFetch<{ workouts: Workout[]; names: Names }>(`/v1/body/workouts?limit=${limit}`, userId);
}

export function getWorkout(userId: string, id: string) {
  return apiFetch<{ workout: Workout; names: Names }>(`/v1/body/workouts/${encodeURIComponent(id)}`, userId);
}

export function saveWorkout(
  userId: string,
  id: string,
  body: { entries?: Workout["entries"]; bodyweight?: number; clear_bodyweight?: boolean; note?: string },
) {
  return apiFetch<{ workout: Workout; names: Names }>(`/v1/body/workouts/${encodeURIComponent(id)}`, userId, json("PATCH", body));
}

export function addEntry(userId: string, id: string, exercise: string) {
  return apiFetch<{ workout: Workout; names: Names }>(
    `/v1/body/workouts/${encodeURIComponent(id)}/entries`,
    userId,
    json("POST", { exercise }),
  );
}

export function finishWorkout(userId: string, id: string) {
  return apiFetch<{ workout: Workout; records: Record_[]; names: Names }>(
    `/v1/body/workouts/${encodeURIComponent(id)}/finish`,
    userId,
    { method: "POST" },
  );
}

export function deleteWorkout(userId: string, id: string) {
  return apiFetch<void>(`/v1/body/workouts/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

export function setWeight(userId: string, day: string, weight: number) {
  return apiFetch<Weight>("/v1/body/weights", userId, json("POST", { day, weight }));
}

export function deleteWeight(userId: string, day: string) {
  return apiFetch<void>(`/v1/body/weights/${encodeURIComponent(day)}`, userId, { method: "DELETE" });
}

export function listProposals(userId: string) {
  return apiFetch<{ proposals: Proposal[]; names: Names }>("/v1/body/coach/proposals", userId);
}

export function coachPlan(userId: string, intake: Intake) {
  return apiFetch<{ proposal: Proposal; names: Names }>("/v1/body/coach/plan", userId, json("POST", intake));
}

export function coachReview(userId: string, text: string) {
  return apiFetch<{ proposal: Proposal; names: Names }>("/v1/body/coach/review", userId, json("POST", { text }));
}

export function coachRefine(userId: string, id: string, text: string) {
  return apiFetch<{ proposal: Proposal; names: Names }>(
    `/v1/body/coach/proposals/${encodeURIComponent(id)}/refine`,
    userId,
    json("POST", { text }),
  );
}

/** accept, decline or revert. */
export function decideProposal(userId: string, id: string, decision: "accept" | "decline" | "revert") {
  return apiFetch<{ proposal: Proposal; names: Names }>(
    `/v1/body/coach/proposals/${encodeURIComponent(id)}/${decision}`,
    userId,
    { method: "POST" },
  );
}
