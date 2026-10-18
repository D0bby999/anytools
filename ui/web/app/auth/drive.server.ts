/**
 * drive.server.ts
 * Connecting Google Drive: the consent round trip, executed on this server.
 *
 * The same dance as sign-in (start.server.ts / callback.server.ts), with three
 * differences that are the point of keeping it in its own module:
 *
 *  - It never mints a session. The user is ALREADY signed in, and the callback
 *    refuses unless the live session belongs to the user who started the flow.
 *    A Drive grant stitched onto the wrong account would sync one person's
 *    documents into another's knowledge base.
 *  - It asks for `drive.file` with `access_type=offline` and `prompt=consent`.
 *    Without both, Google returns a refresh token only on a user's very first
 *    grant, and a reconnect would produce a connector that dies after an hour.
 *  - Its result is not a user id but a refresh token, which is posted to the Go
 *    API (POST /v1/connectors/drive/credentials) and encrypted there. This
 *    process holds it for the length of one request and never writes it down.
 *
 * Its state cookie is its own, scoped to /auth/drive, so a Drive consent in one
 * tab cannot overwrite — or be satisfied by — a sign-in in another.
 */
import { createCookie, redirect } from "react-router";
import {
  driveConfigured,
  driveRedirectURI,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  SESSION_SECRET,
  useSecureCookies,
} from "~/lib/env.server";
import { pkceChallenge, randomToken, timingSafeEqual } from "~/auth/state-cookie.server";
import { getUserId, requireUserId } from "~/lib/auth.server";
import { saveDriveCredentials } from "~/lib/drive.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";
import type { DriveNotice } from "~/lib/drive-types";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Where a flow that lost its own destination lands. */
const DEFAULT_NEXT = "/settings";

type DriveState = {
  state: string;
  codeVerifier: string;
  /** The user who started the flow; the callback's live session must match. */
  userId: string;
  /** Validated relative path to return to. */
  next: string;
};

const driveStateCookie = createCookie("__anytools_drive_state", {
  httpOnly: true,
  path: "/auth/drive",
  // "lax" for the same reason as the sign-in cookie: Google's redirect back is
  // a cross-site top-level GET, which a "strict" cookie would not accompany.
  sameSite: "lax",
  secure: useSecureCookies,
  secrets: [SESSION_SECRET],
  maxAge: 600,
});

async function readDriveState(request: Request): Promise<DriveState | null> {
  const parsed = (await driveStateCookie.parse(request.headers.get("Cookie"))) as DriveState | null;
  if (!parsed || typeof parsed !== "object") return null;
  const { state, codeVerifier, userId, next } = parsed;
  if (![state, codeVerifier, userId, next].every((v) => typeof v === "string" && v.length > 0)) {
    return null;
  }
  return parsed;
}

/**
 * GET /auth/drive?next=/knowledge/<id> — sends a signed-in user to Google.
 *
 * A deployment without Drive answers 404: the UI never links here in that
 * state, so the only way to arrive is a hand-typed URL, and a redirect into a
 * consent screen for an app that cannot use the result would be worse.
 */
export async function startDriveConnect(request: Request): Promise<Response> {
  const userId = await requireUserId(request);
  if (!driveConfigured() || !GOOGLE_CLIENT_ID) {
    throw new Response("Not found", { status: 404 });
  }

  const next = sanitizeNextPath(new URL(request.url).searchParams.get("next")) ?? DEFAULT_NEXT;
  const state = randomToken();
  const codeVerifier = randomToken(48);

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", driveRedirectURI());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return redirect(url.toString(), {
    headers: {
      "Set-Cookie": await driveStateCookie.serialize({ state, codeVerifier, userId, next }),
    },
  });
}

/**
 * GET /auth/drive/callback — where Google sends the user back.
 *
 * Every exit clears the state cookie and redirects to the page the flow started
 * from with `?drive=<notice>`, which that page turns into one sentence. The
 * refusals, in order, each before the next can be reached: Google said no; the
 * state is missing or wrong (CSRF); the live session is not the user who
 * started; the code does not exchange; Google withheld the refresh token or
 * the drive.file scope; the API would not store it.
 */
export async function handleDriveCallback(
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const clear = await driveStateCookie.serialize("", { maxAge: 0 });
  const stored = await readDriveState(request);
  const finish = (notice: DriveNotice) =>
    redirect(withNotice(stored?.next ?? DEFAULT_NEXT, notice), { headers: { "Set-Cookie": clear } });

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return finish("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!stored || !code || !state || !timingSafeEqual(stored.state, state)) return finish("failed");

  // Re-derived from the LIVE session, not trusted from the cookie: a session
  // that ended or changed hands while the user was at Google must not receive
  // this grant.
  const liveUserId = await getUserId(request);
  if (!liveUserId || liveUserId !== stored.userId) return finish("failed");

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return finish("failed");

  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: driveRedirectURI(),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code_verifier: stored.codeVerifier,
      }),
    });
  } catch {
    return finish("failed");
  }
  // The body of a failed exchange is never read or logged: Google's error
  // descriptions can echo request parameters back.
  if (!res.ok) return finish("failed");

  const token = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!token.access_token) return finish("failed");
  // Granular consent lets a user untick the Drive box and still "Allow". That
  // is a refusal, and saying so beats a connection that can read nothing.
  if (!(token.scope ?? "").split(" ").includes(DRIVE_SCOPE)) return finish("denied");
  if (!token.refresh_token) return finish("no_refresh");

  try {
    await saveDriveCredentials(liveUserId, {
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expires_in: token.expires_in ?? 0,
      scope: token.scope ?? "",
    });
  } catch {
    return finish("failed");
  }
  return finish("connected");
}

/** Appends `drive=<notice>` to a relative path, keeping any query it has. */
export function withNotice(path: string, notice: DriveNotice): string {
  const url = new URL(path, "http://relative.invalid");
  url.searchParams.set("drive", notice);
  return `${url.pathname}${url.search}${url.hash}`;
}
