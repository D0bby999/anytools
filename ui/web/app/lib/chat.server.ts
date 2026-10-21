/**
 * chat.server.ts
 * The chat feature's thin API module. Server-side only.
 *
 * Every call goes through `apiFetch`, which is where the gateway bearer and the
 * user id are attached. Deliberately thin: postclaw's single api client grew
 * ~80 domain methods and transitively imported every type in the app (scout
 * §8), so each feature owns its own small module instead.
 */
import { apiFetch } from "~/lib/api.server";
import type { OwnVersion, Retell } from "~/lib/own-version";

export type ChatSession = {
  id: string;
  title: string;
  kb_ids: string[];
  model_hint?: string;
  /** The connection picked for this conversation, if any. */
  connection_id?: string;
  allow_web: boolean;
  /** On the list only: a turn of this conversation has not ended. */
  running?: boolean;
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  capability?: string;
  /**
   * A user message may carry the learner's own version, and an answer their
   * retell (up-methods phase 11). A message with nothing attached holds the
   * default `[]`, which reads as none of these keys; read the two through
   * ownVersionOf and retellOf, which check the shape.
   */
  attachments?: {
    sources?: Source[];
    own_version?: OwnVersion;
    retell?: Retell;
    /** How the answer was found (capabilities/chat/tools.go workRecord). */
    work?: unknown;
    /** Follow-up kinds offered for this answer. */
    suggestions?: unknown;
    /** Text kept from a turn that failed or was stopped. */
    incomplete?: boolean;
  } | null;
  created_at: string;
};

export type Source = {
  kind: string;
  id: string;
  title?: string;
  page?: number;
  document_id?: string;
};

export type Turn = {
  id: string;
  status: "queued" | "running" | "waiting_user" | "done" | "failed" | "cancelled";
  failure_code?: string;
  retryable?: boolean;
  error?: string;
  provider?: string;
  model?: string;
  capability: string;
};

export function listSessions(userId: string, query = "", limit?: number) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return apiFetch<{ sessions: ChatSession[] }>(`/v1/chat/sessions${qs ? `?${qs}` : ""}`, userId);
}

/** One rating of an answer; provider and model are the server's attribution. */
export type ChatFeedback = {
  message_id: string;
  rating: "good" | "bad";
  category?: string;
  comment?: string;
  provider?: string;
  model?: string;
  updated_at: string;
};

export function listFeedback(userId: string, sessionId: string) {
  return apiFetch<{ feedback: ChatFeedback[] }>(`/v1/chat/sessions/${sessionId}/feedback`, userId);
}

export function putFeedback(
  userId: string,
  messageId: string,
  body: { rating: "good" | "bad"; category?: string; comment?: string },
) {
  return apiFetch<ChatFeedback>(`/v1/chat/messages/${encodeURIComponent(messageId)}/feedback`, userId, {
    method: "PUT",
    body,
  });
}

export function deleteFeedback(userId: string, messageId: string) {
  return apiFetch<void>(`/v1/chat/messages/${encodeURIComponent(messageId)}/feedback`, userId, { method: "DELETE" });
}

export function createSession(userId: string, body: { title?: string; kb_ids?: string[] }) {
  return apiFetch<ChatSession>("/v1/chat/sessions", userId, { method: "POST", body });
}

export function getSession(userId: string, sessionId: string) {
  return apiFetch<ChatSession>(`/v1/chat/sessions/${sessionId}`, userId);
}

export function patchSession(
  userId: string,
  sessionId: string,
  body: { title?: string; kb_ids?: string[]; allow_web?: boolean; model_hint?: string; connection_id?: string },
) {
  return apiFetch<ChatSession>(`/v1/chat/sessions/${sessionId}`, userId, {
    method: "PATCH",
    body,
  });
}

export function deleteSession(userId: string, sessionId: string) {
  return apiFetch<void>(`/v1/chat/sessions/${sessionId}`, userId, { method: "DELETE" });
}

export function getMessages(userId: string, sessionId: string) {
  return apiFetch<{ messages: ChatMessage[]; turns: Turn[] }>(
    `/v1/chat/sessions/${sessionId}/messages`,
    userId,
  );
}

/**
 * Starts a turn. `rewindToId` asks again from one of the learner's questions:
 * it and everything after it go first; with an empty message the same
 * question is asked again (regenerate), with one the new text is (edit).
 */
export function startTurn(
  userId: string,
  sessionId: string,
  message: string,
  ownVersion?: OwnVersion,
  rewindToId?: string,
) {
  const body: Record<string, unknown> = { message };
  if (ownVersion) body.own_version = ownVersion;
  if (rewindToId) body.rewind_to_id = rewindToId;
  return apiFetch<{ turn_id: string; status: string }>(
    `/v1/chat/sessions/${sessionId}/turns`,
    userId,
    { method: "POST", body },
  );
}

/** Saves "close it and retell" under an answer; saving again replaces it. */
export function saveRetell(userId: string, messageId: string, text: string) {
  return apiFetch<{ retell: Retell }>(
    `/v1/chat/messages/${encodeURIComponent(messageId)}/retell`,
    userId,
    { method: "POST", body: { text } },
  );
}

export function cancelTurn(userId: string, turnId: string) {
  return apiFetch<Turn>(`/v1/turns/${turnId}/cancel`, userId, { method: "POST" });
}

export function answerTurn(
  userId: string,
  turnId: string,
  answer: string,
  questionId?: string,
) {
  return apiFetch<{ status: string }>(`/v1/turns/${turnId}/answer`, userId, {
    method: "POST",
    body: questionId ? { answer, question_id: questionId } : { answer },
  });
}
