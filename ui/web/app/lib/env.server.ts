/**
 * env.server.ts
 * The one place BFF configuration is read, and the one place it is validated.
 *
 * Every value here is a secret or a trust-boundary parameter. Reading
 * process.env ad hoc across route modules is how a missing variable becomes a
 * silent behavior change instead of a startup failure: postclaw's
 * session-watermark module had to warn at import time that a missing gateway
 * token disabled session revocation *permanently* and nothing else would say
 * so. AnyTools fails at boot instead.
 */

/**
 * Reads one ANYTOOLS_* variable. For one release after the rename, a
 * LONGPLAY_* twin still counts when the new name is unset or empty, so an old
 * .env keeps working; the API logs which old names it found.
 */
export function env(name: string): string | undefined {
  const value = process.env[name];
  if (value) return value;
  if (name.startsWith("ANYTOOLS_")) {
    return process.env[`LONGPLAY_${name.slice("ANYTOOLS_".length)}`] || undefined;
  }
  return undefined;
}

function required(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(
      `${name} is required. The BFF cannot start without it — see .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return env(name);
}

export const isProduction = process.env.NODE_ENV === "production";

/** Base URL of the Go API. Reachable only from inside the compose network. */
export const API_BASE = env("ANYTOOLS_API_URL") ?? "http://api:8080";

/**
 * Shared bearer proving to the API that this process is the BFF.
 *
 * Required in production. Without it every API call 401s, and treating that as
 * a soft warning means the app appears to run while being entirely broken.
 */
export const API_TOKEN = isProduction
  ? required("ANYTOOLS_GATEWAY_TOKEN")
  : (env("ANYTOOLS_GATEWAY_TOKEN") ?? "");

/** Signing secret for the session and OAuth-state cookies. */
export const SESSION_SECRET = isProduction
  ? required("ANYTOOLS_SESSION_SECRET")
  : (env("ANYTOOLS_SESSION_SECRET") ?? "anytools-dev-session-secret-change-me");

/**
 * Public origin of this app, e.g. https://anytools.example.
 *
 * OAuth redirect URIs are built from it rather than from the inbound request's
 * Host header: an attacker-controlled Host would otherwise steer the
 * provider's redirect — and the authorization code with it — to another origin.
 */
export const APP_URL = (env("ANYTOOLS_APP_URL") ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Whether cookies carry the Secure attribute.
 *
 * Keyed off the app's own scheme, not NODE_ENV. The compose stack ships
 * NODE_ENV=production with ANYTOOLS_APP_URL=http://localhost:3000, and a Secure
 * cookie is silently dropped on a plain-http origin by Safari — so the
 * documented `docker compose up` then sign-in path would fail there, and only
 * there, with no error to explain it. Chrome and Firefox exempt localhost;
 * Safari does not.
 *
 * Any real deployment is https, so this is Secure in every case that matters.
 */
export const useSecureCookies = APP_URL.startsWith("https:");

export const GOOGLE_CLIENT_ID = optional("ANYTOOLS_GOOGLE_CLIENT_ID");
export const GOOGLE_CLIENT_SECRET = optional("ANYTOOLS_GOOGLE_CLIENT_SECRET");
export const GITHUB_CLIENT_ID = optional("ANYTOOLS_GITHUB_CLIENT_ID");
export const GITHUB_CLIENT_SECRET = optional("ANYTOOLS_GITHUB_CLIENT_SECRET");

/**
 * Which sign-in buttons the login page offers.
 *
 * A provider with no credentials is hidden rather than shown-and-broken: a
 * button that always ends on an error page is worse than no button.
 */
export function configuredProviders(): Array<"google" | "github"> {
  const providers: Array<"google" | "github"> = [];
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) providers.push("google");
  if (GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET) providers.push("github");
  return providers;
}

export function redirectURI(provider: "google" | "github"): string {
  return `${APP_URL}/auth/callback/${provider}`;
}

/**
 * The Google Picker's two browser-side values (phase 13).
 *
 * Neither is a secret — both are sent to the browser, which is the only place
 * the Picker runs — but they are read here with everything else so that "is
 * Drive configured" has one answer. The API key must be restricted in the GCP
 * console to the Picker and Drive APIs and to this app's origin; the app id is
 * the project NUMBER, not the project id.
 */
export const GOOGLE_API_KEY = optional("ANYTOOLS_GOOGLE_API_KEY");
export const GOOGLE_PICKER_APP_ID = optional("ANYTOOLS_GOOGLE_PICKER_APP_ID");

/**
 * Whether this process can offer Google Drive at all.
 *
 * All four values are needed: the client id and secret for the consent
 * exchange, the key and app id for the Picker. With any one missing the Drive
 * UI is absent rather than present-and-broken — the same rule as the sign-in
 * buttons, and the same rule the API applies by not registering its Drive
 * routes.
 */
export function driveConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_API_KEY && GOOGLE_PICKER_APP_ID);
}

/**
 * Where Google sends the user back after the Drive consent.
 *
 * Its own path, not /auth/callback/google: that route mints a SESSION, and a
 * Drive grant must never be able to reach the code that does.
 */
export function driveRedirectURI(): string {
  return `${APP_URL}/auth/drive/callback`;
}

/**
 * The development-only local sign-in, for reviewing AnyTools on your own
 * machine before any OAuth app exists. Offered only when BOTH hold:
 * ANYTOOLS_DEV_LOGIN=1, and the app's own URL is plain http on localhost or
 * 127.0.0.1 — a public deployment is https on a real domain, so it can never
 * satisfy the second. The API refuses the provider too unless ANYTOOLS_ENV is
 * exactly `development` (internal/auth): two independent gates.
 */
export function localSignInEnabled(): boolean {
  if (env("ANYTOOLS_DEV_LOGIN") !== "1") return false;
  try {
    const u = new URL(APP_URL);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/** The email the local sign-in uses. One local account per machine. */
export const LOCAL_SIGNIN_EMAIL = env("ANYTOOLS_DEV_LOGIN_EMAIL") || "owner@anytools.local";
