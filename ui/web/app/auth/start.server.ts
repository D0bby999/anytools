/**
 * start.server.ts
 * Shared opening move for every provider's sign-in.
 *
 * Both start routes go through here so the CSRF state, the post-login
 * destination and the link target are minted identically. A provider added
 * later that hand-rolls its own start is a provider whose state handling nobody
 * reviewed against this one.
 */
import { assertSignInBudget } from "~/lib/ip-limit.server";
import { redirect } from "react-router";
import { buildGoogleAuthURL, OAuthConfigError } from "~/auth/google.server";
import { buildGitHubAuthURL } from "~/auth/github.server";
import { commitOAuthState, pkceChallenge, randomToken } from "~/auth/state-cookie.server";
import { getUserId } from "~/lib/auth.server";
import { sanitizeNextPath } from "~/lib/safe-redirect-target";

export type Provider = "google" | "github";

/**
 * Builds the provider redirect and the signed state cookie that the callback
 * will validate against.
 *
 * `next` and `linkToUserId` are resolved HERE, before leaving the app, and read
 * back from the signed cookie on return. Taking either from the callback URL
 * would let the provider round trip carry attacker-chosen input into a redirect
 * and into the account-linking decision.
 */
export async function startOAuth(request: Request, provider: Provider): Promise<Response> {
  assertSignInBudget(request);
  const url = new URL(request.url);
  const state = randomToken();
  const next = sanitizeNextPath(url.searchParams.get("next")) ?? undefined;

  // Present only when the visitor is already signed in and is adding a second
  // provider. The Go API cross-checks it against the verified user id, so a
  // stale value cannot graft an identity onto someone else's account.
  const linkToUserId = (await getUserId(request)) ?? undefined;

  try {
    if (provider === "google") {
      const nonce = randomToken();
      const codeVerifier = randomToken(48);
      const codeChallenge = await pkceChallenge(codeVerifier);

      return redirect(buildGoogleAuthURL({ state, nonce, codeChallenge }), {
        headers: {
          "Set-Cookie": await commitOAuthState({
            provider: "google",
            state,
            nonce,
            codeVerifier,
            next,
            linkToUserId,
          }),
        },
      });
    }

    // GitHub supports neither PKCE nor a nonce, so the signed state cookie is
    // the whole CSRF defense for that lane — which is why it is signed and
    // compared in constant time rather than merely present.
    return redirect(buildGitHubAuthURL({ state }), {
      headers: {
        "Set-Cookie": await commitOAuthState({ provider: "github", state, next, linkToUserId }),
      },
    });
  } catch (err) {
    if (err instanceof OAuthConfigError) {
      return redirect("/login?error=not_configured");
    }
    throw err;
  }
}
