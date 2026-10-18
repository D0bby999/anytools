/**
 * session.server.ts
 * Cookie-based session for the BFF. Server-side only.
 *
 * The cookie holds an AnyTools user uuid and `sat` (session-authenticated-at).
 * It never holds an email: the user id is the stable, revocable key, and an
 * email in a cookie is an email in every log that ever prints one.
 */
import { createCookieSessionStorage } from "react-router";
import { SESSION_SECRET, useSecureCookies } from "~/lib/env.server";

export const SESSION_COOKIE_NAME = "__anytools_session";

const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: SESSION_COOKIE_NAME,
    httpOnly: true, // the browser's JS must never read it
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
    sameSite: "lax", // survives the OAuth redirect back from the provider
    secrets: [SESSION_SECRET],
    secure: useSecureCookies,
  },
});

export type SessionData = {
  /** AnyTools user uuid. */
  userId: string;
  /** Unix seconds when this session was minted — compared to the watermark. */
  sat: number;
};

export async function getSession(request: Request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}

export async function commitSession(
  ...args: Parameters<typeof sessionStorage.commitSession>
) {
  return sessionStorage.commitSession(...args);
}

export async function destroySession(
  ...args: Parameters<typeof sessionStorage.destroySession>
) {
  return sessionStorage.destroySession(...args);
}

/** Builds the Set-Cookie header for a freshly authenticated user. */
export async function createUserSession(request: Request, userId: string): Promise<string> {
  const session = await getSession(request);
  session.set("userId", userId);
  session.set("sat", Math.floor(Date.now() / 1000));
  return commitSession(session);
}
