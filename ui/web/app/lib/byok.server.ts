/**
 * byok.server.ts
 * The Settings surface's view of the Go API. Server-side only.
 *
 * Every function here takes the user id the session cookie proved and hands it
 * to apiFetch, which attaches it alongside the gateway bearer. A route that
 * forgot to scope a request to its user is not expressible: there is no call
 * signature in this file without a userId parameter.
 *
 * The types mirror the API's JSON exactly, including what it does NOT send —
 * there is no `secret` field on Connection, because the endpoint that lists
 * connections reads them through a store method that never decrypts.
 */
import { apiFetch, ApiError } from "~/lib/api.server";
import type {
  CatalogEntry,
  ClaudeStart,
  Connection,
  ModelList,
  CopilotStart,
  Readiness,
  RouteEntry,
  SearchConnection,
} from "~/lib/byok.types";

export type {
  ReadinessStatus,
  Connection,
  RouteEntry,
  SearchConnection,
  ReadinessEntry,
  FunctionReadiness,
  Readiness,
} from "~/lib/byok.types";

export type ConnectionsPayload = {
  connections: Connection[];
  providers: string[];
  lanes_enabled: boolean;
};

export type RoutesPayload = {
  routes: Record<string, RouteEntry[]>;
  functions: string[];
  max_chain_entries: number;
};

export type SearchPayload = {
  search_connections: SearchConnection[];
  providers: string[];
  /** Research searches DuckDuckGo when no key is connected (unless turned off). */
  keyless_fallback?: boolean;
};

export type VerifyResult = { ok: boolean; model?: string; dims?: number; message?: string };

/**
 * Escapes a value before it becomes a path segment.
 *
 * These ids come from a form field, and an unescaped `../relay` would resolve
 * to a different API endpoint under the caller's own credentials. The Go side
 * already refuses a non-uuid with 404, so this is the second lock on a door
 * that is not currently open — which is the point of having it.
 */
function path(segment: string): string {
  return encodeURIComponent(segment);
}

/** Every provider a learner can connect (plan 261021-1100 phase 4). */
export function listCatalog(userId: string) {
  return apiFetch<{ providers: CatalogEntry[] }>("/v1/byok/catalog", userId);
}

/** A connection's models: what the provider lists for the key, and the ones added by hand. */
export function listModels(userId: string, id: string) {
  return apiFetch<ModelList>(`/v1/byok/connections/${path(id)}/models`, userId);
}

export function addCustomModel(userId: string, id: string, model: string) {
  return apiFetch<void>(`/v1/byok/connections/${path(id)}/custom-models`, userId, { method: "POST", body: { model } });
}

export function deleteCustomModel(userId: string, id: string, model: string) {
  return apiFetch<void>(`/v1/byok/connections/${path(id)}/custom-models?model=${encodeURIComponent(model)}`, userId, {
    method: "DELETE",
  });
}

export function listConnections(userId: string) {
  return apiFetch<ConnectionsPayload>("/v1/byok/connections", userId);
}

export function createConnection(
  userId: string,
  body: { provider: string; name: string; api_base: string; secret: string },
) {
  return apiFetch<Connection>("/v1/byok/connections", userId, { method: "POST", body });
}

export function updateConnection(
  userId: string,
  id: string,
  body: { name?: string; api_base?: string; secret?: string },
) {
  return apiFetch<Connection>(`/v1/byok/connections/${path(id)}`, userId, { method: "PUT", body });
}

export function deleteConnection(userId: string, id: string) {
  return apiFetch<void>(`/v1/byok/connections/${path(id)}`, userId, { method: "DELETE" });
}

export function verifyConnection(userId: string, id: string, fn: string) {
  return apiFetch<VerifyResult>(`/v1/byok/connections/${path(id)}/verify`, userId, {
    method: "POST",
    body: { function: fn },
  });
}

/**
 * The ChatGPT relay lane. The server RECEIVES a token triple the user obtained
 * themselves; there is deliberately no "start the ChatGPT authorisation" call,
 * because that flow's redirect target is the user's own 127.0.0.1:1455 and a
 * hosted origin cannot complete it.
 */
export function connectRelay(
  userId: string,
  body: { name: string; access_token: string; refresh_token: string; expires_in: number; account_id: string },
) {
  return apiFetch<Connection>("/v1/byok/connections/relay", userId, { method: "POST", body });
}

/**
 * The Google consent URL for the Gemini lane.
 *
 * The redirect URI is an input rather than something derived here: it must be
 * one already registered with the deployment's own Google OAuth client, and
 * only the operator knows which those are.
 */
export function geminiConsentURL(userId: string, redirectURI: string) {
  return apiFetch<{ url: string }>(
    `/v1/byok/connections/gemini-sub/auth-url?redirect_uri=${encodeURIComponent(redirectURI)}`,
    userId,
  );
}

/** The Gemini Code Assist lane: an authorisation code this server exchanges. */
export function connectGeminiSubscription(
  userId: string,
  body: { name: string; code: string; redirect_uri: string },
) {
  return apiFetch<Connection>("/v1/byok/connections/gemini-sub", userId, { method: "POST", body });
}

export function startCopilot(userId: string) {
  return apiFetch<CopilotStart>("/v1/byok/connections/copilot/start", userId, { method: "POST", body: {} });
}

/**
 * Polls GitHub once. `{ status: "pending" }` (HTTP 202) means the user has
 * not approved yet — not an error.
 */
export function finishCopilot(userId: string, body: { session_id: string; name: string }) {
  return apiFetch<Connection | { status: "pending" }>("/v1/byok/connections/copilot/finish", userId, {
    method: "POST",
    body,
  });
}

export function startClaude(userId: string) {
  return apiFetch<ClaudeStart>("/v1/byok/connections/claude-sub/start", userId, { method: "POST", body: {} });
}

export function finishClaude(userId: string, body: { session_id: string; code: string; name: string }) {
  return apiFetch<Connection>("/v1/byok/connections/claude-sub/finish", userId, { method: "POST", body });
}

export function listRoutes(userId: string) {
  return apiFetch<RoutesPayload>("/v1/byok/routes", userId);
}

export function setRoute(userId: string, fn: string, entries: RouteEntry[]) {
  return apiFetch<void>(`/v1/byok/routes/${path(fn)}`, userId, { method: "PUT", body: { entries } });
}

export function listSearchConnections(userId: string) {
  return apiFetch<SearchPayload>("/v1/byok/search-connections", userId);
}

/** zoteroUser is a Zotero library's numeric user id, sent only for "zotero". */
export function saveSearchConnection(userId: string, provider: string, secret: string, zoteroUser?: string) {
  return apiFetch<SearchConnection>("/v1/byok/search-connections", userId, {
    method: "POST",
    body: provider === "zotero" ? { provider, secret, zotero_user: zoteroUser ?? "" } : { provider, secret },
  });
}

export function deleteSearchConnection(userId: string, id: string) {
  return apiFetch<void>(`/v1/byok/search-connections/${path(id)}`, userId, { method: "DELETE" });
}

export function verifySearchConnection(userId: string, id: string) {
  return apiFetch<VerifyResult>(`/v1/byok/search-connections/${path(id)}/verify`, userId, { method: "POST" });
}

export function getReadiness(userId: string) {
  return apiFetch<Readiness>("/v1/readiness", userId);
}

/**
 * Turns an API failure into a message for the page.
 *
 * The API already writes user-facing text for everything a user can fix
 * (a bad base URL, a duplicate name, an impossible provider/function pairing),
 * so those are passed through. Anything else is deliberately generic: a 500's
 * detail lives in the API's log, not in the browser.
 */
export function formErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status >= 400 && err.status < 500 && err.message) return err.message;
    if (err.code === "api_unreachable") return "AnyLearn could not reach its API. Try again in a moment.";
  }
  return fallback;
}
