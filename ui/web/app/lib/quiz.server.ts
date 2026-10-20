/**
 * quiz.server.ts
 * The question bank's thin API module. Server-side only; every call is scoped
 * by an explicit user id, as in kb.server.ts.
 */
import { apiFetch } from "~/lib/api.server";
import type { Source } from "~/hooks/use-turn-stream";
import type {
  Attempt,
  AttemptResult,
  BankEntry,
  GenerateResult,
  PracticeQueue,
  QuestionType,
  QuestionView,
} from "~/lib/study-types";

export function generateQuiz(
  userId: string,
  req: { kb_id: string; topic?: string; n?: number; types?: QuestionType[] },
) {
  return apiFetch<GenerateResult>("/v1/quiz/generate", userId, { method: "POST", body: req });
}

export function listBank(
  userId: string,
  filter: { kb_id?: string; answered?: boolean; type?: string; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (filter.kb_id) query.set("kb_id", filter.kb_id);
  if (filter.answered !== undefined) query.set("answered", String(filter.answered));
  if (filter.type) query.set("type", filter.type);
  if (filter.limit) query.set("limit", String(filter.limit));
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiFetch<{ questions: BankEntry[]; sources: Source[] }>(`/v1/quiz/questions${suffix}`, userId);
}

/** The learner's open mistakes, served unrevealed (learning depth, phase 1). */
export function listPractice(userId: string, filter: { kb_id?: string; path_id?: string } = {}) {
  const query = new URLSearchParams();
  if (filter.kb_id) query.set("kb_id", filter.kb_id);
  if (filter.path_id) query.set("path_id", filter.path_id);
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiFetch<PracticeQueue>(`/v1/quiz/practice${suffix}`, userId);
}

export function getQuestion(userId: string, questionId: string) {
  return apiFetch<{ question: QuestionView; attempts: Attempt[]; sources: Source[] }>(
    `/v1/quiz/questions/${encodeURIComponent(questionId)}`,
    userId,
  );
}

export function attemptQuestion(
  userId: string,
  questionId: string,
  body: { user_answer: string; self_attribution?: string; ask_if_unreadable?: boolean },
) {
  return apiFetch<AttemptResult>(`/v1/questions/${encodeURIComponent(questionId)}/attempt`, userId, {
    method: "POST",
    body,
  });
}

export function overrideAttempt(userId: string, attemptId: string, isCorrect: boolean) {
  return apiFetch<AttemptResult>(`/v1/quiz/attempts/${encodeURIComponent(attemptId)}/override`, userId, {
    method: "POST",
    body: { is_correct: isCorrect },
  });
}
