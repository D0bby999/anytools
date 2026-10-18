/**
 * callback.server.ts
 * The closing move of the OAuth dance, and the only place a session is minted.
 *
 * The order of checks below is the security content of this file, and it is
 * deliberate — each step refuses before the next one can be reached:
 *
 *   1. provider must be one AnyTools supports
 *   2. the provider must not have returned an error
 *   3. a state cookie must exist, and the `state` parameter must match it in
 *      constant time (CSRF: without this, an attacker can hand a victim a
 *      pre-made callback URL and stitch their own provider account onto the
 *      victim's browser)
 *   4. the code is exchanged SERVER-SIDE and, for Google, the id_token's
 *      signature, issuer, audience and nonce are verified before any claim is
 *      read
 *   5. the email must be verified by the provider
 *   6. the link target, if any, is re-derived from the LIVE session
 *   7. the Go API applies the account-linking policy and returns the user id
 *   8. only then is a session cookie set
 *
 * The state cookie is cleared on EVERY exit path, success or failure, so a
 * used or abandoned state can never be replayed.
 */
import { assertSignInBudget } from "~/lib/ip-limit.server";
import { redirect } from "react-router";
import { apiFetch, ApiError, type ApiUser } from "~/lib/api.server";
import { createUserSession } from "~/lib/session.server";
import { clearOAuthState, readOAuthState, timingSafeEqual } from "~/auth/state-cookie.server";
import { exchangeGoogleCode, OAuthConfigError, OAuthExchangeError } from "~/auth/google.server";
import { exchangeGitHubCode } from "~/auth/github.server";
import { IdTokenError } from "~/auth/oidc-verify.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";
import { getUserId } from "~/lib/auth.server";
import type { Provider } from "~/auth/start.server";

const SUPPORTED: readonly string[] = ["google", "github"];

/** Query keys the login page turns into user-facing copy. */
export type LoginErrorCode =
  | "state_mismatch"
  | "exchange_failed"
  | "email_unverified"
  | "email_taken"
  | "not_configured"
  | "generic";

export async function handleOAuthCallback(
  request: Request,
  providerParam: string | undefined,
): Promise<Response> {
  const clearState = await clearOAuthState();
  assertSignInBudget(request);

  // (1) Unknown provider — never reaches an exchange.
  if (!providerParam || !SUPPORTED.includes(providerParam)) {
    return failLogin("not_configured", clearState);
  }
  const provider = providerParam as Provider;

  const url = new URL(request.url);

  // (2) The provider itself refused (user denied consent, app suspended, ...).
  if (url.searchParams.get("error")) {
    return failLogin("generic", clearState);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return failLogin("generic", clearState);
  }

  // (3) CSRF. Both halves must be present and equal; a missing cookie is as
  // fatal as a wrong one, because "no cookie" is exactly what a cross-site
  // forged callback looks like.
  const stored = await readOAuthState(request);
  if (!stored || !timingSafeEqual(stored.state, state)) {
    return failLogin("state_mismatch", clearState);
  }

  // The state must have been minted for THIS provider. Without the binding, a
  // cookie from /auth/github satisfies the check at /auth/callback/google, and
  // the Google branch below would then paper over the absent PKCE verifier and
  // nonce with empty strings — turning a mismatched flow into an unverifiable
  // one instead of refusing it.
  if (stored.provider !== provider) {
    return failLogin("state_mismatch", clearState);
  }

  // Google's lane is only safe WITH the verifier and the nonce. An empty
  // default would silently disable PKCE and token-replay protection, so a state
  // missing either is refused rather than downgraded.
  if (provider === "google" && (!stored.codeVerifier || !stored.nonce)) {
    return failLogin("state_mismatch", clearState);
  }

  // (4) Server-side exchange plus, for Google, full id_token verification.
  let identity;
  try {
    identity =
      provider === "google"
        ? await exchangeGoogleCode({
            code,
            codeVerifier: stored.codeVerifier ?? "",
            nonce: stored.nonce ?? "",
          })
        : await exchangeGitHubCode({ code });
  } catch (err) {
    if (err instanceof OAuthConfigError) return failLogin("not_configured", clearState);
    if (err instanceof OAuthExchangeError && err.code === "email_unverified") {
      return failLogin("email_unverified", clearState);
    }
    if (err instanceof OAuthExchangeError || err instanceof IdTokenError) {
      return failLogin("exchange_failed", clearState);
    }
    throw err;
  }

  // (5) An unverified address is refused here as well as in the API. The API's
  // check is authoritative; this one keeps a pointless round trip from
  // happening and produces a clearer message.
  if (!identity.emailVerified) {
    return failLogin("email_unverified", clearState);
  }

  // (6) Re-derive the link target from the LIVE session, not from the cookie.
  //
  // The state cookie was minted up to ten minutes ago. Reading linkToUserId
  // straight out of it would let a session that has since been destroyed,
  // expired or revoked still graft a new provider identity onto that account —
  // and because the API receives the same value in both the body and the
  // header, its cross-check would be comparing the cookie against itself.
  // Reading the session here is what makes that check independent.
  let linkToUserId: string | null = null;
  if (stored.linkToUserId) {
    const liveUserId = await getUserId(request);
    if (liveUserId !== stored.linkToUserId) {
      // The session ended, or now belongs to someone else, while the user was
      // at the provider. Linking is off the table; they can sign in and retry.
      return failLogin("state_mismatch", clearState);
    }
    linkToUserId = liveUserId;
  }

  // (7) The account decision belongs to the API, which owns the database and
  // the linking policy. This process only reports what it verified.
  let user: ApiUser;
  try {
    user = await apiFetch<ApiUser>("/v1/auth/identity", linkToUserId, {
      method: "POST",
      body: {
        provider,
        subject: identity.subject,
        email: identity.email,
        email_verified: identity.emailVerified,
        display_name: identity.displayName,
        link_to_user_id: linkToUserId ?? "",
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.code === "email_taken") return failLogin("email_taken", clearState);
      if (err.code === "email_unverified") return failLogin("email_unverified", clearState);
    }
    return failLogin("generic", clearState);
  }

  // (8) Session. `next` comes from the signed cookie and is re-validated: the
  // guard is cheap and the cost of being wrong is an open redirect on the one
  // page users are most primed to trust.
  const destination = sanitizeNextPath(stored.next ?? null) ?? "/home";
  const sessionCookie = await createUserSession(request, user.id);

  const headers = new Headers();
  headers.append("Set-Cookie", clearState);
  headers.append("Set-Cookie", sessionCookie);
  return redirect(destination, { headers });
}

function failLogin(code: LoginErrorCode, clearState: string): Response {
  return redirect(`/login?error=${code}`, { headers: { "Set-Cookie": clearState } });
}
