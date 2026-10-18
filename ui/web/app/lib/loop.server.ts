/**
 * loop.server.ts
 * The learning loop's thin API module. Server-side only; every call is scoped
 * by an explicit user id, as in mastery.server.ts.
 */
import { apiFetch } from "~/lib/api.server";
import type {
  BriefDetail,
  Candidate,
  CardDetail,
  CardKind,
  CardLink,
  RetestDue,
  Chain,
  ChainDetail,
  Cycle,
  CycleDetail,
  EvidenceRef,
  HandoverResult,
  InterruptBody,
  LearningState,
  LogDetail,
  ReviewDetail,
  StateDetail,
  StateSummary,
  WeeklyReview,
} from "~/lib/loop-types";

const enc = encodeURIComponent;
const state = (id: string) => `/v1/learning/states/${enc(id)}`;

export function listStates(userId: string) {
  return apiFetch<{ states: StateSummary[] }>("/v1/learning/states", userId);
}

export function startState(
  userId: string,
  body: { goal: string; real_scenario: string; outcome_12w: string; first_task: string },
) {
  return apiFetch<{ state: LearningState; cycle: Cycle }>("/v1/learning/states", userId, { method: "POST", body });
}

export function getState(userId: string, id: string) {
  return apiFetch<StateDetail>(state(id), userId);
}

export function patchState(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<LearningState>(state(id), userId, { method: "PATCH", body });
}

export function interrupt(userId: string, id: string, body: InterruptBody) {
  return apiFetch<{ state: LearningState; cycle: Cycle | null }>(`${state(id)}/interrupt`, userId, {
    method: "POST",
    body,
  });
}

export function newCycle(userId: string, id: string) {
  return apiFetch<Cycle>(`${state(id)}/cycles`, userId, { method: "POST", body: {} });
}

export function resume(userId: string, id: string) {
  return apiFetch<{ session_id: string; title: string }>(`${state(id)}/resume`, userId, { method: "POST", body: {} });
}

export function handover(userId: string, id: string, body: { text: string; accept: boolean; accept_next_task: boolean }) {
  return apiFetch<HandoverResult>(`${state(id)}/handover`, userId, { method: "POST", body });
}

export function createChain(userId: string, stateId: string, question: string) {
  return apiFetch<Chain>(`${state(stateId)}/chains`, userId, { method: "POST", body: { question } });
}

export function createBrief(userId: string, stateId: string, task: string) {
  return apiFetch<{ id: string }>(`${state(stateId)}/briefs`, userId, { method: "POST", body: { task } });
}

export function getCycle(userId: string, id: string) {
  return apiFetch<CycleDetail>(`/v1/cycles/${enc(id)}`, userId);
}

export function patchCycle(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<Cycle>(`/v1/cycles/${enc(id)}`, userId, { method: "PATCH", body });
}

export function advance(userId: string, id: string) {
  return apiFetch<CycleDetail>(`/v1/cycles/${enc(id)}/advance`, userId, { method: "POST", body: {} });
}

export function createReview(userId: string, cycleId: string, week = 0) {
  return apiFetch<WeeklyReview>(`/v1/cycles/${enc(cycleId)}/reviews`, userId, { method: "POST", body: { week } });
}

export function getReview(userId: string, id: string) {
  return apiFetch<ReviewDetail>(`/v1/weekly-reviews/${enc(id)}`, userId);
}

export function patchReview(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<ReviewDetail>(`/v1/weekly-reviews/${enc(id)}`, userId, { method: "PATCH", body });
}

export function writeback(userId: string, id: string) {
  return apiFetch<{ review: ReviewDetail }>(`/v1/weekly-reviews/${enc(id)}/writeback`, userId, {
    method: "POST",
    body: {},
  });
}

export function addReviewEvidence(userId: string, reviewId: string, body: Record<string, unknown>) {
  return apiFetch<EvidenceRef>(`/v1/weekly-reviews/${enc(reviewId)}/evidence`, userId, { method: "POST", body });
}

export function suggest(userId: string, cycleId: string, week: number) {
  return apiFetch<{ week: number; suggestions: Candidate[] }>(
    `/v1/learning/evidence/suggest?cycle_id=${enc(cycleId)}&week=${week}`,
    userId,
  );
}

export function patchEvidence(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<EvidenceRef>(`/v1/learning/evidence/${enc(id)}`, userId, { method: "PATCH", body });
}

export function getChain(userId: string, id: string) {
  return apiFetch<ChainDetail>(`/v1/learning/chains/${enc(id)}`, userId);
}

export function patchChain(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<Chain>(`/v1/learning/chains/${enc(id)}`, userId, { method: "PATCH", body });
}

export function addChainEvidence(userId: string, chainId: string, body: Record<string, unknown>) {
  return apiFetch<EvidenceRef>(`/v1/learning/chains/${enc(chainId)}/evidence`, userId, { method: "POST", body });
}

export function getBrief(userId: string, id: string) {
  return apiFetch<BriefDetail>(`/v1/learning/briefs/${enc(id)}`, userId);
}

export function patchBrief(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<unknown>(`/v1/learning/briefs/${enc(id)}`, userId, { method: "PATCH", body });
}

export function createLog(userId: string, briefId: string) {
  return apiFetch<LogDetail>(`/v1/learning/briefs/${enc(briefId)}/logs`, userId, { method: "POST", body: {} });
}

export function patchLog(userId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<LogDetail>(`/v1/learning/logs/${enc(id)}`, userId, { method: "PATCH", body });
}

// ── skill evidence cards ────────────────────────────────────────────────────

export function listCardKinds(userId: string) {
  return apiFetch<{ kinds: CardKind[] }>("/v1/learning/card-kinds", userId);
}

export function listRetests(userId: string) {
  return apiFetch<{ retests: RetestDue[]; count: number; today: string }>("/v1/learning/retests", userId);
}

export function createCard(
  userId: string,
  stateId: string,
  body: { kind: string; title: string; setup: Record<string, string> },
) {
  return apiFetch<CardDetail>(`${state(stateId)}/cards`, userId, { method: "POST", body });
}

export function getCard(userId: string, id: string) {
  return apiFetch<CardDetail>(`/v1/learning/cards/${enc(id)}`, userId);
}

export function addCardEntry(
  userId: string,
  id: string,
  body: { timepoint: string; body: string; prompt_level: string; links: Pick<CardLink, "kind" | "id" | "page">[] },
) {
  return apiFetch<CardDetail>(`/v1/learning/cards/${enc(id)}/entries`, userId, { method: "POST", body });
}

export function closeCard(userId: string, id: string, body: { held: string; missed: string; next: string }) {
  return apiFetch<CardDetail>(`/v1/learning/cards/${enc(id)}/close`, userId, { method: "POST", body });
}
