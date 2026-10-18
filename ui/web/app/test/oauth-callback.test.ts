/**
 * oauth-callback.test.ts
 *
 * End-to-end coverage of the sign-in callback against RECORDED provider
 * responses. Real Google/GitHub client ids cannot be exercised here, so every
 * network call is mocked and every refusal path is asserted — the refusals are
 * the part that must not regress silently.
 *
 * Google's id_token is minted with a locally generated RSA key and verified
 * against a locally served JWKS, so the signature check is genuinely exercised
 * rather than stubbed out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

const APP_URL = "https://anytools.test";
const GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
const GITHUB_CLIENT_ID = "test-github-client-id";

// Env has to be in place before the modules under test are imported, because
// env.server.ts reads process.env at module scope by design.
vi.stubEnv("ANYTOOLS_APP_URL", APP_URL);
vi.stubEnv("ANYTOOLS_SESSION_SECRET", "test-session-secret-value");
vi.stubEnv("ANYTOOLS_GATEWAY_TOKEN", "test-gateway-token");
vi.stubEnv("ANYTOOLS_GOOGLE_CLIENT_ID", GOOGLE_CLIENT_ID);
vi.stubEnv("ANYTOOLS_GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ANYTOOLS_GITHUB_CLIENT_ID", GITHUB_CLIENT_ID);
vi.stubEnv("ANYTOOLS_GITHUB_CLIENT_SECRET", "test-github-client-secret");

const { handleOAuthCallback } = await import("~/auth/callback.server");
const { commitOAuthState, randomToken } = await import("~/auth/state-cookie.server");
const { __resetJWKSCacheForTests } = await import("~/auth/oidc-verify.server");
const { __resetSignInBudgetForTests } = await import("~/lib/ip-limit.server");
const { SESSION_COOKIE_NAME, createUserSession } = await import("~/lib/session.server");

// ---------------------------------------------------------------- key material

let signingKey: CryptoKey;
let publicJWK: JWK;
let wrongKey: CryptoKey;

beforeEach(async () => {
  // Every test calls the callback from the same (absent) client address.
  __resetSignInBudgetForTests();
  // The JWKS set is a module singleton in production (one issuer, cached keys
  // and rotation state). Each test mints its own key pair, so the cache has to
  // be dropped between them or every test after the first verifies against the
  // first test's key.
  __resetJWKSCacheForTests();

  const pair = await generateKeyPair("RS256", { extractable: true });
  signingKey = pair.privateKey;
  publicJWK = { ...(await exportJWK(pair.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };

  const other = await generateKeyPair("RS256", { extractable: true });
  wrongKey = other.privateKey;
});

afterEach(() => {
  vi.restoreAllMocks();
});

type IdTokenOverrides = {
  iss?: string;
  aud?: string;
  nonce?: string;
  email?: string;
  emailVerified?: boolean;
  sub?: string;
  expired?: boolean;
  signWithWrongKey?: boolean;
};

async function mintIdToken(o: IdTokenOverrides = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: o.email ?? "chau@example.test",
    email_verified: o.emailVerified ?? true,
    name: "Chau Nguyen",
    nonce: o.nonce ?? "test-nonce",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(o.iss ?? "https://accounts.google.com")
    .setAudience(o.aud ?? GOOGLE_CLIENT_ID)
    .setSubject(o.sub ?? "google-subject-1")
    .setIssuedAt(now - 10)
    .setExpirationTime(o.expired ? now - 3600 : now + 3600)
    .sign(o.signWithWrongKey ? wrongKey : signingKey);
}

// ------------------------------------------------------------------- fetch mock

type ApiCall = { path: string; body: unknown; headers: Record<string, string> };

/**
 * Installs a fetch double covering Google's token endpoint, its JWKS, GitHub's
 * endpoints and the AnyTools API. `api` chooses what the identity endpoint
 * answers, so the BFF's handling of each API refusal can be exercised.
 */
function mockFetch(opts: {
  idToken?: string;
  tokenStatus?: number;
  githubEmails?: Array<{ email: string; primary: boolean; verified: boolean }>;
  githubProfile?: { id: number; name: string | null; login: string };
  api?: { status: number; body: unknown };
}) {
  const apiCalls: ApiCall[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("googleapis.com/oauth2/v3/certs") || url.includes("/jwks")) {
      return new Response(JSON.stringify({ keys: [publicJWK] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("oauth2.googleapis.com/token")) {
      const status = opts.tokenStatus ?? 200;
      if (status !== 200) return new Response("{}", { status });
      return new Response(JSON.stringify({ id_token: opts.idToken, token_type: "Bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("github.com/login/oauth/access_token")) {
      const status = opts.tokenStatus ?? 200;
      if (status !== 200) return new Response("{}", { status });
      return new Response(JSON.stringify({ access_token: "gho_test_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("api.github.com/user/emails")) {
      return new Response(JSON.stringify(opts.githubEmails ?? []), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("api.github.com/user")) {
      return new Response(
        JSON.stringify(opts.githubProfile ?? { id: 4242, name: "Chau", login: "chau" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/v1/auth/identity")) {
      apiCalls.push({
        path: url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const api = opts.api ?? {
        status: 200,
        body: {
          id: "11111111-2222-3333-4444-555555555555",
          email: "chau@example.test",
          display_name: "Chau Nguyen",
          created_at: new Date().toISOString(),
        },
      };
      return new Response(JSON.stringify(api.body), {
        status: api.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`unexpected fetch to ${url}`);
  });

  vi.stubGlobal("fetch", impl);
  return { apiCalls };
}

// ------------------------------------------------------------------- utilities

async function callbackRequest(opts: {
  provider: string;
  code?: string;
  state?: string;
  cookieState?: Parameters<typeof commitOAuthState>[0] | null;
  error?: string;
  /** Mints a real session cookie for this user, as a signed-in browser has. */
  sessionUserId?: string;
}): Promise<Request> {
  const url = new URL(`${APP_URL}/auth/callback/${opts.provider}`);
  if (opts.code !== undefined) url.searchParams.set("code", opts.code);
  if (opts.state !== undefined) url.searchParams.set("state", opts.state);
  if (opts.error) url.searchParams.set("error", opts.error);

  const cookies: string[] = [];
  if (opts.cookieState) {
    cookies.push((await commitOAuthState(opts.cookieState)).split(";")[0] ?? "");
  }
  if (opts.sessionUserId) {
    const session = await createUserSession(new Request(APP_URL), opts.sessionUserId);
    cookies.push(session.split(";")[0] ?? "");
  }

  const headers = new Headers();
  if (cookies.length > 0) headers.set("Cookie", cookies.join("; "));
  return new Request(url.toString(), { headers });
}

function locationOf(res: Response): string {
  return res.headers.get("Location") ?? "";
}

function errorCodeOf(res: Response): string | null {
  return new URL(locationOf(res), APP_URL).searchParams.get("error");
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function hasSessionCookie(res: Response): boolean {
  return setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`) && !/Max-Age=0/.test(c));
}

function clearsOAuthState(res: Response): boolean {
  return setCookies(res).some((c) => c.startsWith("__anytools_oauth_state=") && /Max-Age=0/.test(c));
}

// ------------------------------------------------------------------ happy paths

describe("sign-in budget", () => {
  it("answers 429 once one address has spent its sign-in budget", async () => {
    const req = () =>
      new Request("http://localhost:3000/auth/callback/google", { headers: { "X-Forwarded-For": "198.51.100.7" } });
    let refused: Response | undefined;
    for (let i = 0; i < 25 && !refused; i++) {
      refused = await handleOAuthCallback(req(), "google").then(
        () => undefined,
        (r: unknown) => (r instanceof Response && r.status === 429 ? r : undefined),
      );
    }
    expect(refused?.status).toBe(429);
  });
});

describe("Google callback", () => {
  it("signs a user in and sets a session cookie", async () => {
    const nonce = "test-nonce";
    const { apiCalls } = mockFetch({ idToken: await mintIdToken({ nonce }) });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "auth-code",
        state,
        cookieState: { provider: "google", state, nonce, codeVerifier: "verifier" },
      }),
      "google",
    );

    expect(res.status).toBe(302);
    expect(locationOf(res)).toBe("/home");
    expect(hasSessionCookie(res)).toBe(true);
    expect(clearsOAuthState(res)).toBe(true);

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]?.body).toMatchObject({
      provider: "google",
      subject: "google-subject-1",
      email: "chau@example.test",
      email_verified: true,
    });
    // The BFF is the API's only client and must present the gateway bearer.
    expect(apiCalls[0]?.headers["authorization"]).toBe("Bearer test-gateway-token");
  });

  it("honours the next path carried in the signed state cookie", async () => {
    mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "auth-code",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v", next: "/knowledge" },
      }),
      "google",
    );

    expect(locationOf(res)).toBe("/knowledge");
  });

  // The destination is re-validated on the way out even though it was
  // sanitized on the way in: the guard is cheap, and an open redirect on the
  // page users are most primed to trust is not.
  it("refuses an off-origin next path even from its own cookie", async () => {
    mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "auth-code",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v", next: "//evil.test" },
      }),
      "google",
    );

    expect(locationOf(res)).toBe("/home");
  });

  it("passes link_to_user_id through when the visitor was already signed in", async () => {
    const linkToUserId = "99999999-8888-7777-6666-555555555555";
    const { apiCalls } = mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "auth-code",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v", linkToUserId },
        // A REAL session for that user: linking now requires the live session
        // to still agree with the cookie, so the cookie alone is not enough.
        sessionUserId: linkToUserId,
      }),
      "google",
    );

    expect(apiCalls[0]?.body).toMatchObject({ link_to_user_id: linkToUserId });
    // Sent as the asserted user too, so the API can cross-check the body
    // against a user id it has independently validated.
    expect(apiCalls[0]?.headers["x-anytools-user-id"]).toBe(linkToUserId);
  });
});

describe("GitHub callback", () => {
  it("signs in using the primary verified email", async () => {
    const { apiCalls } = mockFetch({
      githubEmails: [
        { email: "secondary@example.test", primary: false, verified: true },
        { email: "chau@example.test", primary: true, verified: true },
      ],
      githubProfile: { id: 4242, name: "Chau Nguyen", login: "chau" },
    });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "github", code: "code", state, cookieState: { provider: "github", state } }),
      "github",
    );

    expect(res.status).toBe(302);
    expect(hasSessionCookie(res)).toBe(true);
    expect(apiCalls[0]?.body).toMatchObject({
      provider: "github",
      subject: "4242",
      email: "chau@example.test",
      email_verified: true,
    });
  });

  // Accepting a secondary address would let someone add a victim's address as
  // a secondary on their own GitHub account and collide with the victim's
  // AnyTools account, which is keyed on email.
  it("refuses an account whose primary email is unverified, even with a verified secondary", async () => {
    mockFetch({
      githubEmails: [
        { email: "primary@example.test", primary: true, verified: false },
        { email: "secondary@example.test", primary: false, verified: true },
      ],
    });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "github", code: "code", state, cookieState: { provider: "github", state } }),
      "github",
    );

    expect(errorCodeOf(res)).toBe("email_unverified");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("refuses an account with no verified email at all", async () => {
    mockFetch({ githubEmails: [{ email: "a@b.test", primary: true, verified: false }] });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "github", code: "code", state, cookieState: { provider: "github", state } }),
      "github",
    );

    expect(errorCodeOf(res)).toBe("email_unverified");
  });
});

// ----------------------------------------------------------------- CSRF / state

describe("state validation (login CSRF)", () => {
  // Without this check an attacker hands a victim a pre-made callback URL and
  // stitches the attacker's provider account onto the victim's browser session.
  it("refuses when the state parameter does not match the cookie", async () => {
    mockFetch({ idToken: await mintIdToken() });

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state: "attacker-state",
        cookieState: { provider: "google", state: randomToken(), nonce: "test-nonce", codeVerifier: "v" },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(hasSessionCookie(res)).toBe(false);
  });

  // "No cookie" is exactly what a cross-site forged callback looks like, so it
  // must be as fatal as a wrong one.
  it("refuses when there is no state cookie at all", async () => {
    mockFetch({ idToken: await mintIdToken() });

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "google", code: "code", state: "anything", cookieState: null }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("clears the state cookie on every failure path so it cannot be replayed", async () => {
    mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state: "wrong",
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v" },
      }),
      "google",
    );

    expect(clearsOAuthState(res)).toBe(true);
  });
});

// ----------------------------------------------------- id_token verification

describe("id_token verification", () => {
  async function callbackWithToken(idToken: string, nonce = "test-nonce") {
    mockFetch({ idToken });
    const state = randomToken();
    return handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        cookieState: { provider: "google", state, nonce, codeVerifier: "v" },
      }),
      "google",
    );
  }

  // postclaw audit finding C11: claims were once read from an UNVERIFIED
  // payload, so a forged token with matching claims was accepted outright.
  it("rejects a token signed by the wrong key", async () => {
    const res = await callbackWithToken(await mintIdToken({ signWithWrongKey: true }));
    expect(errorCodeOf(res)).toBe("exchange_failed");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("rejects a token from the wrong issuer", async () => {
    const res = await callbackWithToken(await mintIdToken({ iss: "https://evil.test" }));
    expect(errorCodeOf(res)).toBe("exchange_failed");
  });

  // A token minted for a DIFFERENT client of the same provider is a real
  // token with a real signature; only the audience check rejects it.
  it("rejects a token minted for another client", async () => {
    const res = await callbackWithToken(await mintIdToken({ aud: "someone-elses-client-id" }));
    expect(errorCodeOf(res)).toBe("exchange_failed");
  });

  it("rejects an expired token", async () => {
    const res = await callbackWithToken(await mintIdToken({ expired: true }));
    expect(errorCodeOf(res)).toBe("exchange_failed");
  });

  // The nonce binds the token to THIS authorization request; without it an
  // id_token captured from any other flow for the same client would work.
  it("rejects a token whose nonce does not match the authorization request", async () => {
    const res = await callbackWithToken(await mintIdToken({ nonce: "some-other-nonce" }));
    expect(errorCodeOf(res)).toBe("exchange_failed");
  });

  it("rejects a token whose email the provider did not verify", async () => {
    const res = await callbackWithToken(await mintIdToken({ emailVerified: false }));
    expect(errorCodeOf(res)).toBe("email_unverified");
    expect(hasSessionCookie(res)).toBe(false);
  });
});

// ------------------------------------------------------------ API-side refusals

describe("API refusals surface as login-page copy", () => {
  it("maps email_taken to its own message rather than a generic failure", async () => {
    mockFetch({
      idToken: await mintIdToken(),
      api: { status: 409, body: { error: "already exists", code: "email_taken" } },
    });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v" },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("email_taken");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("does not mint a session when the API refuses for any other reason", async () => {
    mockFetch({
      idToken: await mintIdToken(),
      api: { status: 500, body: { error: "boom" } },
    });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v" },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("generic");
    expect(hasSessionCookie(res)).toBe(false);
  });
});

// ------------------------------------------------------------- malformed input

describe("malformed callbacks", () => {
  it("refuses an unknown provider before any exchange", async () => {
    const { apiCalls } = mockFetch({});
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "facebook", code: "c", state, cookieState: { provider: "google", state } }),
      "facebook",
    );

    expect(errorCodeOf(res)).toBe("not_configured");
    expect(apiCalls).toHaveLength(0);
  });

  it("refuses when the provider reported an error", async () => {
    mockFetch({});
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({ provider: "google", state, error: "access_denied", cookieState: { provider: "google", state } }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("generic");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("refuses when code or state is missing", async () => {
    mockFetch({});
    const state = randomToken();

    const noCode = await handleOAuthCallback(
      await callbackRequest({ provider: "google", state, cookieState: { provider: "google", state } }),
      "google",
    );
    expect(errorCodeOf(noCode)).toBe("generic");

    const noState = await handleOAuthCallback(
      await callbackRequest({ provider: "google", code: "c", cookieState: { provider: "google", state } }),
      "google",
    );
    expect(errorCodeOf(noState)).toBe("generic");
  });

  it("refuses when the provider's token endpoint fails", async () => {
    mockFetch({ tokenStatus: 400 });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "c",
        state,
        cookieState: { provider: "google", state, nonce: "test-nonce", codeVerifier: "v" },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("exchange_failed");
  });
});

// ----------------------------------------------- provider binding (M1 / H2)

describe("the state cookie is bound to its provider and its session", () => {
  // Without the binding, a cookie minted by /auth/github satisfies the state
  // check at /auth/callback/google — and the Google branch would then paper
  // over the absent PKCE verifier and nonce with empty strings, turning a
  // mismatched flow into an unverifiable one instead of refusing it.
  it("refuses a google callback carrying a github state", async () => {
    mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        cookieState: { provider: "github", state },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(hasSessionCookie(res)).toBe(false);
  });

  it("refuses a github callback carrying a google state", async () => {
    mockFetch({
      githubEmails: [{ email: "chau@example.test", primary: true, verified: true }],
    });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "github",
        code: "code",
        state,
        cookieState: { provider: "google", state, nonce: "n", codeVerifier: "v" },
      }),
      "github",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(hasSessionCookie(res)).toBe(false);
  });

  // An empty verifier or nonce would silently disable PKCE and token-replay
  // protection. A state missing either is refused, never downgraded.
  it("refuses a google callback whose state has no PKCE verifier or nonce", async () => {
    for (const partial of [
      { provider: "google" as const, state: "", nonce: "n" },
      { provider: "google" as const, state: "", codeVerifier: "v" },
      { provider: "google" as const, state: "" },
    ]) {
      mockFetch({ idToken: await mintIdToken() });
      const state = randomToken();

      const res = await handleOAuthCallback(
        await callbackRequest({
          provider: "google",
          code: "code",
          state,
          cookieState: { ...partial, state },
        }),
        "google",
      );

      expect(errorCodeOf(res), JSON.stringify(partial)).toBe("state_mismatch");
    }
  });

  // The state cookie was minted up to ten minutes ago. Reading linkToUserId
  // straight out of it would let a session destroyed, expired or revoked in the
  // meantime still graft a provider identity onto that account — and since the
  // API receives the same value in the body and the header, its cross-check
  // would be comparing the cookie against itself.
  it("refuses to link when no live session backs the cookie's link target", async () => {
    const { apiCalls } = mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        // A link target, but the request carries no session cookie at all.
        cookieState: {
          provider: "google",
          state,
          nonce: "test-nonce",
          codeVerifier: "v",
          linkToUserId: "99999999-8888-7777-6666-555555555555",
        },
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(hasSessionCookie(res)).toBe(false);
    expect(apiCalls, "the API must not be asked to link on a dead session").toHaveLength(0);
  });

  it("refuses to link when the live session names a different user", async () => {
    const { apiCalls } = mockFetch({ idToken: await mintIdToken() });
    const state = randomToken();

    const res = await handleOAuthCallback(
      await callbackRequest({
        provider: "google",
        code: "code",
        state,
        cookieState: {
          provider: "google",
          state,
          nonce: "test-nonce",
          codeVerifier: "v",
          linkToUserId: "99999999-8888-7777-6666-555555555555",
        },
        // Signed in, but as somebody else — the session changed hands during
        // the ten-minute window.
        sessionUserId: "11111111-1111-1111-1111-111111111111",
      }),
      "google",
    );

    expect(errorCodeOf(res)).toBe("state_mismatch");
    expect(apiCalls).toHaveLength(0);
  });
});
