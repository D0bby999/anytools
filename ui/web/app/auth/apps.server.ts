/**
 * apps.server.ts
 * Connecting Canva or Notion (learning-tool-connections phases 8 and 9):
 * the consent round trip, as Drive's is, with the exchange on the API.
 *
 * This server owns the state cookie and the PKCE verifier; the API builds
 * the authorize URL (it holds the client id) and exchanges the code (it holds
 * the secret). The callback refuses unless the live session is the user who
 * started, and it says what happened with `?app=<notice>`.
 */
import { createCookie, redirect } from "react-router";
import { APP_URL, SESSION_SECRET, useSecureCookies } from "~/lib/env.server";
import { pkceChallenge, randomToken, timingSafeEqual } from "~/auth/state-cookie.server";
import { getUserId, requireUserId } from "~/lib/auth.server";
import { apiFetch, ApiError } from "~/lib/api.server";

export const APP_PROVIDERS = ["canva", "notion"] as const;
export type AppProvider = (typeof APP_PROVIDERS)[number];

export function isAppProvider(v: string | undefined): v is AppProvider {
  return (APP_PROVIDERS as readonly string[]).includes(v ?? "");
}

type AppState = { provider: AppProvider; state: string; codeVerifier: string; userId: string };

const appStateCookie = createCookie("__anytools_app_state", {
  httpOnly: true,
  path: "/auth/app",
  sameSite: "lax",
  secure: useSecureCookies,
  secrets: [SESSION_SECRET],
  maxAge: 600,
});

export function appRedirectURI(provider: AppProvider): string {
  return `${APP_URL}/auth/app/${provider}/callback`;
}

const back = (provider: AppProvider, notice: string) => `/apps?app=${provider}-${notice}`;

/** GET /auth/app/:provider — sends a signed-in user to the app's consent. */
export async function startAppConnect(request: Request, provider: string | undefined): Promise<Response> {
  const userId = await requireUserId(request);
  if (!isAppProvider(provider)) throw new Response("Not found", { status: 404 });
  const state = randomToken();
  const codeVerifier = randomToken(48);
  let url: string;
  try {
    ({ url } = await apiFetch<{ url: string }>(`/v1/apps/${provider}/authorize`, userId, {
      method: "POST",
      body: { state, code_challenge: await pkceChallenge(codeVerifier), redirect_uri: appRedirectURI(provider) },
    }));
  } catch (error) {
    if (error instanceof ApiError) return redirect(back(provider, error.code === "not_configured" ? "unavailable" : "failed"));
    throw error;
  }
  return redirect(url, {
    headers: { "Set-Cookie": await appStateCookie.serialize({ provider, state, codeVerifier, userId } satisfies AppState) },
  });
}

/** GET /auth/app/:provider/callback — where the app sends the user back. */
export async function handleAppCallback(request: Request, provider: string | undefined): Promise<Response> {
  if (!isAppProvider(provider)) throw new Response("Not found", { status: 404 });
  const clear = await appStateCookie.serialize("", { maxAge: 0 });
  const finish = (notice: string) => redirect(back(provider, notice), { headers: { "Set-Cookie": clear } });
  const stored = (await appStateCookie.parse(request.headers.get("Cookie"))) as AppState | null;

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return finish("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!stored || stored.provider !== provider || !code || !state || !timingSafeEqual(stored.state, state)) return finish("failed");
  const liveUserId = await getUserId(request);
  if (!liveUserId || liveUserId !== stored.userId) return finish("failed");

  try {
    await apiFetch(`/v1/apps/${provider}/connect`, liveUserId, {
      method: "POST",
      body: { code, code_verifier: stored.codeVerifier, redirect_uri: appRedirectURI(provider) },
    });
  } catch {
    return finish("failed");
  }
  return finish("connected");
}
