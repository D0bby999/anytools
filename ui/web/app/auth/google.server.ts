/**
 * google.server.ts
 * Google's half of the OAuth dance, executed entirely on this server.
 *
 * The browser only ever sees two redirects; the client secret, the
 * authorization code and the id_token never leave this process.
 */
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectURI } from "~/lib/env.server";
import { verifyGoogleIdToken, type VerifiedIdToken } from "~/auth/oidc-verify.server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class OAuthConfigError extends Error {
  constructor(provider: string) {
    super(
      `${provider} sign-in is not configured. Set ANYTOOLS_${provider.toUpperCase()}_CLIENT_ID and ` +
        `ANYTOOLS_${provider.toUpperCase()}_CLIENT_SECRET.`,
    );
    this.name = "OAuthConfigError";
  }
}

export class OAuthExchangeError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "OAuthExchangeError";
  }
}

function credentials() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new OAuthConfigError("google");
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET };
}

/**
 * Builds the authorization URL.
 *
 * Scopes are exactly `openid email profile` — the minimum needed to identify a
 * user. Drive scopes belong to phase 13 and are requested separately at the
 * moment the user connects Drive, so signing in never asks for document access.
 */
export function buildGoogleAuthURL(params: {
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const { clientId } = credentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectURI("google"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Exchanges the authorization code for an id_token and verifies it.
 *
 * `jwksUri` is injectable for tests; production uses Google's real endpoint.
 */
export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  nonce: string;
  fetchImpl?: typeof fetch;
  jwksUri?: string;
}): Promise<VerifiedIdToken> {
  const { clientId, clientSecret } = credentials();
  const doFetch = params.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: redirectURI("google"),
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: params.codeVerifier,
  });

  const res = await doFetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });

  if (!res.ok) {
    // The provider's raw response can echo the client secret back in an error
    // description, so only the status is surfaced.
    throw new OAuthExchangeError(`google token exchange returned ${res.status}`, "token_exchange_failed");
  }

  const payload = (await res.json()) as { id_token?: string; error?: string };
  if (payload.error || !payload.id_token) {
    throw new OAuthExchangeError("google token response contained no id_token", "token_exchange_failed");
  }

  return verifyGoogleIdToken(payload.id_token, clientId, params.nonce, params.jwksUri);
}
