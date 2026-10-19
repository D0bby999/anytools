/**
 * api.server.ts
 * The ONLY client of the Go API. Server-side only.
 *
 * Trust boundary (docs/architecture.md): the API port is never published, and
 * this process is its sole caller. `apiFetch` is where the gateway bearer and
 * the user id are attached; nothing else in the app may call the API, so a
 * route that forgets to scope a request to its user is not expressible.
 *
 * Deliberately generic: postclaw's equivalent grew ~80 domain methods and a
 * transitive import of every type in the app (scout §8, "Needs rewrite").
 * Feature phases add their own thin modules that call apiFetch.
 */
import { API_BASE, API_TOKEN } from "~/lib/env.server";

export const USER_ID_HEADER = "X-AnyTools-User-Id";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

/**
 * Calls the Go API on behalf of `userId`.
 *
 * `userId` is required and must come from the session cookie, never from a
 * request parameter — it is the assertion the API's RequireUser middleware
 * trusts this process to make truthfully. Pass `null` only for the sign-in
 * exchange, which is the one call that happens before a user exists.
 */
export async function apiFetch<T>(
  path: string,
  userId: string | null,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, headers = {}, signal } = opts;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        ...(userId ? { [USER_ID_HEADER]: userId } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // A transport failure is not an auth failure. Reporting it as 503 keeps
    // the unauthorized handler from logging everyone out when the API restarts.
    throw new ApiError(503, `API unreachable at ${API_BASE}`, "api_unreachable");
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(res.status, payload.error ?? res.statusText, payload.code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** The user shape GET /v1/me and POST /v1/auth/identity both return. */
export type ApiUser = {
  id: string;
  email: string;
  display_name: string;
  email_verified_at?: string;
  created_at: string;
  /** IANA zone every "today" in the learning features is computed in. */
  timezone: string;
  /** False until the browser or the learner chose a zone. */
  timezone_set: boolean;
  /** "Write my own version first" (up-methods phase 11). */
  own_version_first?: boolean;
  /** Where new files are written: "server" or "drive" (Settings → Storage). */
  file_storage?: "server" | "drive";
  /** The interface language: en, vi, es or pt. */
  language?: string;
  /** False until the first sign-in reported a language or the learner chose one. */
  language_set?: boolean;
};
