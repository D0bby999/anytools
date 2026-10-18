/**
 * oidc-verify.server.ts
 * ID-token verification for the BFF.
 *
 * postclaw did this in Go (internal/auth/oidc_provider.go). AnyTools moves it
 * here because the BFF owns the whole OAuth dance and the browser never reaches
 * the Go API — but the security properties that file's comments call out are
 * kept, and each is enforced below:
 *
 *   - the RS256 signature is checked against the issuer's JWKS BEFORE any claim
 *     is trusted (postclaw audit finding C11: claims were once read from an
 *     unverified payload, so a forged token with matching claims was accepted)
 *   - `alg` is restricted, closing "alg":"none" and HS256 key-confusion
 *   - issuer and audience must match, so a token minted for another client of
 *     the same provider is useless here
 *   - `nonce` must match the one bound into the authorization request, which is
 *     what makes an intercepted id_token non-replayable
 *
 * `jose` provides the JWKS cache, rotation handling and algorithm pinning. The
 * one thing never worth hand-rolling is JWT signature verification.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

export type VerifiedIdToken = {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
};

/**
 * One JWKS per URI, cached for the life of the process: the set holds the keys
 * and rate-limits refetches, so rebuilding it per request would hammer the
 * issuer and lose rotation state.
 *
 * Keyed by URI rather than kept as a single instance — a lone slot silently
 * ignores every later argument, so a second issuer added in any future phase
 * would be verified against the FIRST issuer's keys.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwks(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    set = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, set);
  }
  return set;
}

export class IdTokenError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "IdTokenError";
  }
}

/**
 * Verifies a Google id_token and returns only the claims AnyTools acts on.
 *
 * `jwksUri` is injectable so tests can verify against a locally generated key
 * pair instead of reaching the network.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
  expectedNonce: string,
  jwksUri: string = GOOGLE_JWKS_URI,
): Promise<VerifiedIdToken> {
  let payload: JWTPayload;
  try {
    const result = await jwtVerify(idToken, jwks(jwksUri), {
      issuer: [GOOGLE_ISSUER, "accounts.google.com"],
      audience: clientId,
      // Pinned: an attacker who could choose the algorithm could present an
      // HS256 token signed with the (public) JWKS modulus as its key.
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
    payload = result.payload;
  } catch (err) {
    throw new IdTokenError(
      `id_token verification failed: ${err instanceof Error ? err.message : "unknown"}`,
      "id_token_invalid",
    );
  }

  // Binds this token to THIS authorization request. Without it, an id_token
  // captured from any other flow for the same client would be accepted.
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new IdTokenError("id_token nonce does not match the authorization request", "nonce_mismatch");
  }

  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!subject || !email) {
    throw new IdTokenError("id_token is missing sub or email", "id_token_incomplete");
  }

  // Google returns email_verified as a boolean; some IdPs stringify it.
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  return {
    subject,
    email,
    emailVerified,
    displayName: typeof payload.name === "string" ? payload.name : "",
  };
}

/** Resets the cached JWKS sets. Tests only. */
export function __resetJWKSCacheForTests() {
  jwksCache.clear();
}
