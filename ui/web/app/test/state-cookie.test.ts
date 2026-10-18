import { describe, expect, it } from "vitest";
import {
  commitOAuthState,
  clearOAuthState,
  pkceChallenge,
  randomToken,
  readOAuthState,
  timingSafeEqual,
} from "~/auth/state-cookie.server";

function requestWithCookie(setCookie: string): Request {
  const value = setCookie.split(";")[0] ?? "";
  return new Request("https://anytools.test/auth/callback/google", {
    headers: { Cookie: value },
  });
}

describe("OAuth state cookie", () => {
  it("round-trips the values decided before the redirect", async () => {
    const state = {
      provider: "google" as const,
      state: "s-1",
      nonce: "n-1",
      codeVerifier: "v-1",
      next: "/knowledge",
    };
    const parsed = await readOAuthState(requestWithCookie(await commitOAuthState(state)));
    expect(parsed).toMatchObject(state);
  });

  it("is HttpOnly and SameSite=Lax", async () => {
    const header = await commitOAuthState({ provider: "google", state: "s" });
    expect(header).toContain("HttpOnly");
    // Lax, not Strict: the provider's redirect back is a cross-site top-level
    // GET, and a Strict cookie would not be sent with it, so every login would
    // fail state validation.
    expect(header).toMatch(/SameSite=Lax/i);
  });

  it("expires in minutes, not days", async () => {
    const header = await commitOAuthState({ provider: "google", state: "s" });
    const maxAge = Number(/Max-Age=(\d+)/.exec(header)?.[1] ?? 0);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(900);
  });

  it("returns null for a missing or empty cookie", async () => {
    expect(await readOAuthState(new Request("https://anytools.test/"))).toBeNull();
    expect(await readOAuthState(requestWithCookie(await clearOAuthState()))).toBeNull();
  });

  it("clearing sets Max-Age=0 so a used state cannot be replayed", async () => {
    expect(await clearOAuthState()).toMatch(/Max-Age=0/);
  });

  it("generates distinct high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => randomToken()));
    expect(tokens.size).toBe(100);
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    // URL-safe base64 only: "+" or "/" would need escaping in a query string.
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("produces a stable S256 PKCE challenge", async () => {
    const verifier = "test-verifier-value";
    expect(await pkceChallenge(verifier)).toBe(await pkceChallenge(verifier));
    expect(await pkceChallenge(verifier)).not.toBe(await pkceChallenge("other"));
    expect(await pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("timingSafeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc123", "abc12")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("a", "")).toBe(false);
  });
});
