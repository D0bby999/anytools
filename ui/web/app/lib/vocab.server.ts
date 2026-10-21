/**
 * vocab.server.ts
 * The vocabulary's thin API module. Server-side only; every call is scoped by
 * an explicit user id, as in reading.server.ts.
 */
import { apiFetch } from "~/lib/api.server";
import { API_BASE, API_TOKEN } from "~/lib/env.server";
import type { Decision, DueCard, Rating, ReviewResult, SourceRecording, SourceSentence, Term, VocabNote, Week } from "~/lib/vocab-types";
import type { StudiedLanguages } from "~/lib/languages";

/** A decision and its minimum record (up-methods phase 3). */
type DecisionFields = { decision?: Decision; record?: Record<string, string>; task_impact?: string };

/** "Find words to save": one model call on the learner's reading route. */
export function findTerms(userId: string, workspaceId: string, body: { selection: string; page: number }) {
  return apiFetch<{ terms: Term[]; lang: string }>(
    `/v1/reading/${encodeURIComponent(workspaceId)}/terms`,
    userId,
    { method: "POST", body },
  );
}

export function saveWord(
  userId: string,
  body: {
    workspace_id: string;
    page: number;
    selection: string;
    term: string;
    meaning: string;
    lang?: string;
    pos?: string;
  } & DecisionFields,
) {
  return apiFetch<{ note: VocabNote; created: boolean; week?: Week }>("/v1/vocab", userId, { method: "POST", body });
}

/**
 * The learner's words. `terms` asks for exactly these terms (case ignored),
 * as the word picker does to show what was already decided.
 */
export function listWords(
  userId: string,
  filter: { q?: string; lang?: string; decision?: Decision; terms?: string[]; limit?: number; offset?: number } = {},
) {
  const params = new URLSearchParams();
  if (filter.limit) params.set("limit", String(filter.limit));
  if (filter.offset) params.set("offset", String(filter.offset));
  if (filter.q) params.set("q", filter.q);
  if (filter.lang) params.set("lang", filter.lang);
  if (filter.decision) params.set("decision", filter.decision);
  for (const term of filter.terms ?? []) params.append("term", term);
  const qs = params.toString();
  return apiFetch<{ notes: VocabNote[] }>(`/v1/vocab${qs ? `?${qs}` : ""}`, userId);
}

/**
 * Today's session, or with limit 0 only the count (Home, the tab badge).
 * The deck is the words, or `book` for the living books' flash cards; neither
 * ever holds the other's cards.
 */
export function dueCards(userId: string, limit?: number, deck: "words" | "book" | "cards" = "words", lang = "") {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (deck !== "words") params.set("deck", deck);
  if (lang) params.set("lang", lang);
  const qs = params.toString();
  return apiFetch<{ cards: DueCard[]; due_count: number }>(`/v1/vocab/due${qs ? `?${qs}` : ""}`, userId);
}

export function updateWord(
  userId: string,
  id: string,
  body: {
    meaning?: string;
    reading?: string;
    pos?: string;
    lang?: string;
    suspended?: boolean;
    production?: boolean;
    listening?: boolean;
    writing?: boolean;
  } & DecisionFields,
) {
  return apiFetch<VocabNote & { week?: Week }>(`/v1/vocab/${encodeURIComponent(id)}`, userId, {
    method: "PATCH",
    body,
  });
}

/** "Practise using it": the learner's scenario, and the production card. */
export function practiseWord(userId: string, id: string, body: { scenario: string; confusable?: string }) {
  return apiFetch<VocabNote>(`/v1/vocab/${encodeURIComponent(id)}/production`, userId, { method: "POST", body });
}

export function deleteWord(userId: string, id: string) {
  return apiFetch<void>(`/v1/vocab/${encodeURIComponent(id)}`, userId, { method: "DELETE" });
}

export function reviewCard(
  userId: string,
  cardId: string,
  body: { rating: Rating; answer?: string; request_id: string },
) {
  return apiFetch<ReviewResult>(`/v1/vocab/cards/${encodeURIComponent(cardId)}/review`, userId, {
    method: "POST",
    body,
  });
}

/** One imported batch's outcome (the private design notes, phase 3). */
export type ImportResult = { created: number; duplicates: number; invalid: number; first_day?: string; last_day?: string };

/**
 * One batch of an Anki deck's words, as the page mapped them; or of a
 * Library word list's, with its origin ("library:hsk3-1").
 */
export function importWords(userId: string, lang: string, notes: { term: string; meaning: string; sentence: string }[], origin?: string) {
  return apiFetch<ImportResult>("/v1/vocab/import", userId, { method: "POST", body: { lang, notes, ...(origin ? { origin } : {}) } });
}

/** Every word being learned, read in pages of the API's largest list. */
export async function allLearningWords(userId: string): Promise<VocabNote[]> {
  const out: VocabNote[] = [];
  for (let offset = 0; ; offset += 500) {
    const { notes } = await listWords(userId, { decision: "learn", limit: 500, offset });
    out.push(...notes);
    if (notes.length < 500) return out;
  }
}

/** The languages the learner studies, and those their words are in (Languages page). */
export function studiedLanguages(userId: string) {
  return apiFetch<StudiedLanguages>("/v1/vocab/languages", userId);
}

/** Replaces the studied list; `current` is the tab viewed last. */
export function setStudiedLanguages(userId: string, studied: string[], current = "") {
  return apiFetch<{ studied: string[]; current: string }>("/v1/vocab/languages", userId, {
    method: "PUT",
    body: { studied, current },
  });
}

// ── sentences and recordings from open sources (the private design notes, phase 6)


export function lookupSentences(userId: string, lang: string, term: string, to: string) {
  const q = new URLSearchParams({ lang, term, to });
  return apiFetch<{ sentences: SourceSentence[] }>(`/v1/vocab/lookup/sentences?${q}`, userId);
}

export function lookupRecordings(userId: string, lang: string, term: string) {
  const q = new URLSearchParams({ lang, term });
  return apiFetch<{ recordings: SourceRecording[] }>(`/v1/vocab/lookup/recordings?${q}`, userId);
}

/** Takes a source's sentence for the word: its newest, credited, and its cloze card. */
export function addSourceSentence(userId: string, id: string, body: { sentence: string; credit: string; url: string }) {
  return apiFetch<VocabNote>(`/v1/vocab/${encodeURIComponent(id)}/sentence`, userId, { method: "POST", body });
}

/** A recording's sound, streamed from the API (which fetched it from Commons or Wiktionary). */
export async function fetchSourceAudio(userId: string, id: string, signal: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/v1/vocab/lookup/audio?${new URLSearchParams({ id })}`, {
      headers: { ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}), "X-AnyTools-User-Id": userId },
      signal,
    });
  } catch {
    return new Response("The API could not be reached.", { status: 503 });
  }
  const headers = new Headers({ "X-Content-Type-Options": "nosniff" });
  for (const name of ["Content-Type", "Cache-Control"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.ok ? res.body : null, { status: res.status, headers });
}

