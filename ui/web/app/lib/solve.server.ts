/**
 * solve.server.ts
 * The solve feature's thin API module. Server-side only; every call is scoped
 * by an explicit user id, as in chat.server.ts. The turn a solve starts is
 * streamed and cancelled through chat's own endpoints.
 */
import { apiFetch } from "~/lib/api.server";
import type { StartedTurn } from "~/lib/research-types";
import type { QuestionView } from "~/lib/study-types";
import type { OwnVersion } from "~/lib/own-version";

/** The photo cap the API enforces (solveapi.MaxImageBytes). */
export const MAX_IMAGE_BYTES = 5 << 20;

export type SolveRequest = {
  session_id?: string;
  problem?: string;
  image?: { mime_type: string; data: string };
  variant?: "solve" | "check";
  user_answer?: string;
  kb_ids?: string[];
  /** "Write my own version first" (up-methods phase 11). */
  own_version?: OwnVersion;
};

export function startSolve(userId: string, body: SolveRequest) {
  return apiFetch<StartedTurn>("/v1/solve", userId, { method: "POST", body });
}

export function saveSolutionNote(userId: string, messageId: string) {
  return apiFetch<{ note_id: string }>(
    `/v1/solve/messages/${encodeURIComponent(messageId)}/note`,
    userId,
    { method: "POST" },
  );
}

export function solutionToQuestion(userId: string, messageId: string, kbId?: string) {
  return apiFetch<{ question: QuestionView }>(
    `/v1/solve/messages/${encodeURIComponent(messageId)}/question`,
    userId,
    { method: "POST", body: kbId ? { kb_id: kbId } : {} },
  );
}
