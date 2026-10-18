/**
 * state-cookie.server.ts
 * The signed, HttpOnly cookie carrying OAuth CSRF state across the redirect.
 *
 * Why a cookie and not server memory: the API runs single-replica but the BFF
 * need not, and in-memory state would break the moment it did. Why signed: the
 * callback compares the `state` query parameter against this cookie, so an
 * attacker who could forge the cookie could complete a login-CSRF — stitching
 * their own provider account onto the victim's browser session.
 *
 * It also carries `next` (the post-login destination) and `linkToUserId`. Both
 * are decided BEFORE the redirect and read back from the signed cookie, never
 * from the callback URL, so the provider's round trip cannot alter either one.
 */
import { createCookie } from "react-router";
import { SESSION_SECRET, useSecureCookies } from "~/lib/env.server";

export type OAuthState = {
  /** Which provider this state was minted for. */
  provider: "google" | "github";
  /** Random value echoed by the provider; must match to prove same-browser. */
  state: string;
  /** PKCE verifier (Google). Absent for GitHub, which does not support PKCE. */
  codeVerifier?: string;
  /** OIDC nonce, bound into the id_token to defeat token replay. */
  nonce?: string;
  /** Validated relative path to land on after login. */
  next?: string;
  /** Set when an already-signed-in user is adding a second provider. */
  linkToUserId?: string;
};

const stateCookie = createCookie("__anytools_oauth_state", {
  httpOnly: true,
  path: "/",
  // "lax" is required, not merely chosen: the provider's redirect back is a
  // cross-site top-level GET, and a "strict" cookie would not be sent with it,
  // making every login fail state validation.
  sameSite: "lax",
  secure: useSecureCookies,
  secrets: [SESSION_SECRET],
  maxAge: 600, // 10 minutes: an authorization code round trip, not a session
});

export async function commitOAuthState(value: OAuthState): Promise<string> {
  return stateCookie.serialize(value);
}

export async function readOAuthState(request: Request): Promise<OAuthState | null> {
  const parsed = (await stateCookie.parse(request.headers.get("Cookie"))) as OAuthState | null;
  if (!parsed || typeof parsed.state !== "string" || parsed.state.length === 0) return null;
  if (parsed.provider !== "google" && parsed.provider !== "github") return null;
  return parsed;
}

/**
 * Clears the state cookie. Always called on the callback path — success or
 * failure — so a leftover state cannot be replayed against a second attempt.
 */
export async function clearOAuthState(): Promise<string> {
  return stateCookie.serialize("", { maxAge: 0 });
}

/** Cryptographically random URL-safe token. */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

/** S256 PKCE challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Constant-time string comparison for the state check.
 *
 * A plain `===` short-circuits on the first differing byte, leaking a timing
 * signal an attacker could walk to recover a valid state value.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
