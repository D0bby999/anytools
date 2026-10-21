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
 *
 * Learning-tool-connections phase 1: this is the learner's one Google grant.
 * `?add=calendar` (or classroom, photos) asks for that feature's scopes on top
 * of drive.file through incremental authorization; the scopes come from the
 * API's feature catalogue, never from the query string, and a sensitive
 * feature the API does not offer this learner is refused before Google is
 * asked. `openid email` name the account, so the API can refuse a consent
 * given with another Google account than the connected one.
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
import { driveStatus, saveDriveCredentials } from "~/lib/drive.server";
import { ApiError } from "~/lib/api.server";
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
  /** Every scope this consent asked for beyond openid and email. */
  want?: string[];
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

  const params = new URL(request.url).searchParams;
  const next = sanitizeNextPath(params.get("next")) ?? DEFAULT_NEXT;

  // The features asked for, resolved against the API's catalogue for THIS
  // learner: an unknown id or a feature not offered to them stops here.
  const add = (params.get("add") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  let want = [DRIVE_SCOPE];
  let loginHint = "";
  if (add.length > 0) {
    const status = await driveStatus(userId).catch(() => null);
    const features = status?.features ?? [];
    for (const id of add) {
      const feature = features.find((f) => f.id === id);
      if (!feature || !feature.available) return redirect(withNotice(next, "unavailable"));
      want = [...want, ...feature.scopes];
    }
    loginHint = status?.connected ? (status.email ?? "") : "";
  }
  want = [...new Set(want)];

  const state = randomToken();
  const codeVerifier = randomToken(48);

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", driveRedirectURI());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ["openid", "email", ...want].join(" "));
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return redirect(url.toString(), {
    headers: {
      "Set-Cookie": await driveStateCookie.serialize({ state, codeVerifier, userId, next, want }),
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
  // A school account whose administrator has not allowed the app is refused
  // at consent with its own error (learning-tool-connections phase 6).
  if (url.searchParams.get("error") === "admin_policy_enforced") return finish("school_blocked");
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
    id_token?: string;
  };
  if (!token.access_token) return finish("failed");
  // Granular consent lets a user untick the Drive box and still "Allow". That
  // is a refusal, and saying so beats a connection that can read nothing.
  if (!(token.scope ?? "").split(" ").includes(DRIVE_SCOPE)) return finish("denied");
  if (!token.refresh_token) return finish("no_refresh");

  const who = idTokenClaims(token.id_token);
  try {
    await saveDriveCredentials(liveUserId, {
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expires_in: token.expires_in ?? 0,
      scope: token.scope ?? "",
      google_sub: who.sub,
      email: who.email,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "different_google_account") return finish("other_account");
    return finish("failed");
  }
  // Granular consent: the learner may have allowed Drive and unticked the
  // feature they came for. Drive is saved; the page says what is missing.
  const granted = (token.scope ?? "").split(" ");
  if (!(stored.want ?? [DRIVE_SCOPE]).every((s) => granted.includes(s))) return finish("partial");
  return finish("connected");
}

/**
 * The subject and email in the id_token Google's token endpoint returned.
 *
 * Read without checking the signature, which OpenID Connect allows for a
 * token received straight from the token endpoint over TLS (Core 1.0
 * §3.1.3.7): nothing between Google and this server could have written it.
 */
export function idTokenClaims(idToken: string | undefined): { sub: string; email: string } {
  const payload = idToken?.split(".")[1];
  if (!payload) return { sub: "", email: "" };
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; email?: unknown };
    return {
      sub: typeof json.sub === "string" ? json.sub : "",
      email: typeof json.email === "string" ? json.email : "",
    };
  } catch {
    return { sub: "", email: "" };
  }
}

/** Appends `drive=<notice>` to a relative path, keeping any query it has. */
export function withNotice(path: string, notice: DriveNotice): string {
  const url = new URL(path, "http://relative.invalid");
  url.searchParams.set("drive", notice);
  return `${url.pathname}${url.search}${url.hash}`;
}
