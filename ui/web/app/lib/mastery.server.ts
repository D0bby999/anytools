/**
 * mastery.server.ts
 * The mastery path's thin API module. Server-side only; every call is scoped
 * by an explicit user id, as in kb.server.ts.
 */
import { apiFetch } from "~/lib/api.server";
import type {
  DueItem,
  ErrorRecord,
  ExplainBackResult,
  Explanation,
  NextQuestion,
  Path,
  PathDetail,
  PathSummary,
  Proposal,
  ProposedModule,
  QuestionView,
} from "~/lib/study-types";

const base = (pathId: string) => `/v1/mastery/paths/${encodeURIComponent(pathId)}`;

export function listDue(userId: string, limit = 50) {
  return apiFetch<{ due: DueItem[]; count: number }>(`/v1/mastery/due?limit=${limit}`, userId);
}

export function listPaths(userId: string) {
  return apiFetch<{ paths: PathSummary[] }>("/v1/mastery/paths", userId);
}

export function createPath(userId: string, kbId: string, goal: string) {
  return apiFetch<{ path: Path; proposal: Proposal }>("/v1/mastery/paths", userId, {
    method: "POST",
    body: { kb_id: kbId, goal },
  });
}

export function getPath(userId: string, pathId: string) {
  return apiFetch<PathDetail>(base(pathId), userId);
}

export function archivePath(userId: string, pathId: string) {
  return apiFetch<void>(base(pathId), userId, { method: "DELETE" });
}

export function proposePath(userId: string, pathId: string) {
  return apiFetch<Proposal>(`${base(pathId)}/propose`, userId, { method: "POST", body: {} });
}

export function approvePath(userId: string, pathId: string, modules: ProposedModule[]) {
  return apiFetch<PathDetail>(`${base(pathId)}/approve`, userId, { method: "POST", body: { modules } });
}

export function runDiagnostic(userId: string, pathId: string) {
  return apiFetch<{ questions: QuestionView[] }>(`${base(pathId)}/diagnostic`, userId, {
    method: "POST",
    body: {},
  });
}

export function nextQuestion(userId: string, pathId: string) {
  return apiFetch<NextQuestion>(`${base(pathId)}/next`, userId);
}

/**
 * The cross-path review's next item (up-methods phase 12). `after` is the
 * point just shown; the server ignores one that is not the caller's.
 */
export function reviewNext(userId: string, after?: string | null) {
  const query = after ? `?after=${encodeURIComponent(after)}` : "";
  return apiFetch<NextQuestion>(`/v1/mastery/review/next${query}`, userId);
}

export function openErrors(userId: string, pathId: string) {
  return apiFetch<{ errors: ErrorRecord[] }>(`${base(pathId)}/errors`, userId);
}

const point = (pointId: string) => `/v1/mastery/points/${encodeURIComponent(pointId)}`;

/** Teach a point: cached per point and model; `refresh` rewrites a stale one. */
export function learnPoint(userId: string, pointId: string, body: { variant?: number; refresh?: boolean }) {
  return apiFetch<Explanation>(`${point(pointId)}/learn`, userId, { method: "POST", body });
}

/** Judge the learner's own explanation. `request_id` makes a resubmit free. */
export function explainBack(userId: string, pointId: string, text: string, requestId: string) {
  return apiFetch<ExplainBackResult>(`${point(pointId)}/explain-back`, userId, {
    method: "POST",
    body: { text, request_id: requestId },
  });
}

/** "Judged wrong?": record the learner's opposite verdict, once. */
export function overrideExplainBack(userId: string, attemptId: string) {
  return apiFetch<ExplainBackResult>(`/v1/mastery/explain-back/${encodeURIComponent(attemptId)}/override`, userId, {
    method: "POST",
    body: {},
  });
}
