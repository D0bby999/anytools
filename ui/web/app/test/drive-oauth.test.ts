// @vitest-environment node
/**
 * drive-oauth.test.ts
 *
 * Connecting Google Drive, against recorded token-endpoint responses. No live
 * Google account exists for this project yet (reports/spike-drive.md is
 * BLOCKED on the owner's GCP project), so every network call is mocked and —
 * as for sign-in — every refusal is asserted: the refusals are what must not
 * regress silently.
 *
 * The state cookie is the REAL signed cookie, round-tripped from the start
 * response into the callback request, so the CSRF check is exercised rather
 * than stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_URL = "https://anytools.test";

vi.stubEnv("ANYTOOLS_APP_URL", APP_URL);
vi.stubEnv("ANYTOOLS_SESSION_SECRET", "test-session-secret-value");
vi.stubEnv("ANYTOOLS_GATEWAY_TOKEN", "test-gateway-token");
vi.stubEnv("ANYTOOLS_GOOGLE_CLIENT_ID", "drive-client.apps.googleusercontent.com");
vi.stubEnv("ANYTOOLS_GOOGLE_CLIENT_SECRET", "drive-client-secret");
vi.stubEnv("ANYTOOLS_GOOGLE_API_KEY", "browser-api-key");
vi.stubEnv("ANYTOOLS_GOOGLE_PICKER_APP_ID", "123456789012");

const session = { userId: "user-1" as string | null };
vi.mock("~/lib/auth.server", () => ({
  getUserId: async () => session.userId,
  requireUserId: async () => {
    if (!session.userId) throw new Response(null, { status: 302, headers: { Location: "/login" } });
    return session.userId;
  },
}));

const saveDriveCredentials = vi.fn();
vi.mock("~/lib/drive.server", () => ({
  saveDriveCredentials: (...args: unknown[]) => saveDriveCredentials(...args),
}));

const { startDriveConnect, handleDriveCallback, withNotice, DRIVE_SCOPE } = await import("~/auth/drive.server");

beforeEach(() => {
  session.userId = "user-1";
  saveDriveCredentials.mockReset().mockResolvedValue({ connected: true });
});

/** Starts a flow and returns the authorize URL plus the cookie to send back. */
async function start(next = "/knowledge/kb-1") {
  const res = await startDriveConnect(
    new Request(`${APP_URL}/auth/drive?next=${encodeURIComponent(next)}`),
  );
  expect(res.status).toBe(302);
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  return {
    authorize: new URL(res.headers.get("Location") ?? ""),
    cookie: setCookie.split(";")[0] ?? "",
    setCookie,
  };
}

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const GOOD_TOKEN = {
  access_token: "ya29.access",
  refresh_token: "1//0g-refresh",
  expires_in: 3599,
  scope: `openid ${DRIVE_SCOPE}`,
  token_type: "Bearer",
};

async function callback(query: string, cookie: string, fetchImpl: typeof fetch) {
  const res = await handleDriveCallback(
    new Request(`${APP_URL}/auth/drive/callback?${query}`, { headers: { Cookie: cookie } }),
    fetchImpl,
  );
  return {
    status: res.status,
    location: res.headers.get("Location") ?? "",
    setCookie: res.headers.get("Set-Cookie") ?? "",
  };
}

describe("startDriveConnect", () => {
  it("asks Google for drive.file, offline, with a forced consent and PKCE", async () => {
    const { authorize, setCookie } = await start();

    expect(authorize.origin + authorize.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = authorize.searchParams;
    expect(q.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    // Both, or a reconnect gets no refresh token and dies after an hour.
    expect(q.get("access_type")).toBe("offline");
    expect(q.get("prompt")).toBe("consent");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toBeTruthy();
    // Its own callback — never the sign-in one, which mints sessions.
    expect(q.get("redirect_uri")).toBe(`${APP_URL}/auth/drive/callback`);

    expect(setCookie).toMatch(/^__anytools_drive_state=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\/auth\/drive/);
  });

  it("requires a signed-in user", async () => {
    session.userId = null;
    await expect(start()).rejects.toMatchObject({ status: 302 });
  });

  it("does not follow an off-site next", async () => {
    const { authorize, cookie } = await start("https://evil.example/steal");
    const fetchImpl = tokenResponse(GOOD_TOKEN);
    const res = await callback(`code=c&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);
    expect(res.location).toBe("/settings?drive=connected");
  });
});

describe("handleDriveCallback", () => {
  it("exchanges the code with the PKCE verifier and hands the refresh token to the API", async () => {
    const { authorize, cookie } = await start();
    const fetchImpl = tokenResponse(GOOD_TOKEN);

    const res = await callback(`code=auth-code&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);

    expect(res.location).toBe("/knowledge/kb-1?drive=connected");
    expect(res.setCookie, "the state cookie must be cleared").toMatch(/Max-Age=0/i);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(`${APP_URL}/auth/drive/callback`);
    expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/);

    expect(saveDriveCredentials).toHaveBeenCalledWith("user-1", {
      refresh_token: "1//0g-refresh",
      access_token: "ya29.access",
      expires_in: 3599,
      scope: `openid ${DRIVE_SCOPE}`,
    });
  });

  it("refuses a state that does not match the cookie", async () => {
    const { cookie } = await start();
    const fetchImpl = tokenResponse(GOOD_TOKEN);
    const res = await callback("code=c&state=forged", cookie, fetchImpl);
    expect(res.location).toBe("/knowledge/kb-1?drive=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveDriveCredentials).not.toHaveBeenCalled();
  });

  it("refuses a callback with no state cookie at all", async () => {
    const fetchImpl = tokenResponse(GOOD_TOKEN);
    const res = await callback("code=c&state=anything", "", fetchImpl);
    expect(res.location).toBe("/settings?drive=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when the live session is no longer the user who started", async () => {
    const { authorize, cookie } = await start();
    session.userId = "someone-else";
    const fetchImpl = tokenResponse(GOOD_TOKEN);
    const res = await callback(`code=c&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);
    expect(res.location).toContain("drive=failed");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(saveDriveCredentials).not.toHaveBeenCalled();
  });

  it("reports a consent the user declined", async () => {
    const { cookie } = await start();
    const fetchImpl = tokenResponse(GOOD_TOKEN);
    const res = await callback("error=access_denied", cookie, fetchImpl);
    expect(res.location).toBe("/knowledge/kb-1?drive=denied");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats an unticked Drive box as a refusal", async () => {
    const { authorize, cookie } = await start();
    const fetchImpl = tokenResponse({ ...GOOD_TOKEN, scope: "openid email" });
    const res = await callback(`code=c&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);
    expect(res.location).toContain("drive=denied");
    expect(saveDriveCredentials).not.toHaveBeenCalled();
  });

  it("says so when Google returns no refresh token", async () => {
    const { authorize, cookie } = await start();
    const { refresh_token: _omit, ...withoutRefresh } = GOOD_TOKEN;
    const fetchImpl = tokenResponse(withoutRefresh);
    const res = await callback(`code=c&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);
    expect(res.location).toContain("drive=no_refresh");
    expect(saveDriveCredentials).not.toHaveBeenCalled();
  });

  it("reports a failed exchange without storing anything", async () => {
    const { authorize, cookie } = await start();
    const fetchImpl = tokenResponse({ error: "invalid_grant" }, 400);
    const res = await callback(`code=c&state=${authorize.searchParams.get("state")}`, cookie, fetchImpl);
    expect(res.location).toContain("drive=failed");
    expect(saveDriveCredentials).not.toHaveBeenCalled();
  });

  it("reports an API that would not store the grant", async () => {
    const { authorize, cookie } = await start();
    saveDriveCredentials.mockRejectedValue(new Error("400"));
    const res = await callback(
      `code=c&state=${authorize.searchParams.get("state")}`,
      cookie,
      tokenResponse(GOOD_TOKEN),
    );
    expect(res.location).toContain("drive=failed");
  });
});

describe("withNotice", () => {
  it("keeps an existing query", () => {
    expect(withNotice("/knowledge/kb-1?tab=docs", "connected")).toBe("/knowledge/kb-1?tab=docs&drive=connected");
  });
});
