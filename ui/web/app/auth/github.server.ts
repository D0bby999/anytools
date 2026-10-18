/**
 * github.server.ts
 * GitHub's half of the OAuth dance. Ported from postclaw
 * internal/http/auth_login_github.go (lines 40, 50, 82, 115) into TypeScript.
 *
 * GitHub is not an OIDC provider: there is no id_token to verify, so identity
 * comes from two authenticated API calls. The important difference from the
 * postclaw original is the email rule below.
 */
import { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, redirectURI } from "~/lib/env.server";
import { OAuthConfigError, OAuthExchangeError } from "~/auth/google.server";
import type { VerifiedIdToken } from "~/auth/oidc-verify.server";

const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_EMAIL_URL = "https://api.github.com/user/emails";
const GITHUB_USER_URL = "https://api.github.com/user";

function credentials() {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) throw new OAuthConfigError("github");
  return { clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET };
}

export function buildGitHubAuthURL(params: { state: string }): string {
  const { clientId } = credentials();
  const url = new URL(GITHUB_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectURI("github"));
  // `user:email` only — enough to read the address, no repository access.
  url.searchParams.set("scope", "user:email");
  url.searchParams.set("state", params.state);
  return url.toString();
}

export async function exchangeGitHubCode(params: {
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedIdToken> {
  const { clientId, clientSecret } = credentials();
  const doFetch = params.fetchImpl ?? fetch;

  const tokenRes = await doFetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: redirectURI("github"),
    }),
  });

  if (!tokenRes.ok) {
    throw new OAuthExchangeError(`github token exchange returned ${tokenRes.status}`, "token_exchange_failed");
  }

  const token = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (token.error || !token.access_token) {
    throw new OAuthExchangeError("github token response contained no access_token", "token_exchange_failed");
  }

  const [email, profile] = await Promise.all([
    fetchPrimaryVerifiedEmail(token.access_token, doFetch),
    fetchProfile(token.access_token, doFetch),
  ]);

  return {
    subject: String(profile.id),
    email,
    // Only a primary+verified address ever reaches this point, so the claim is
    // true by construction rather than by assertion.
    emailVerified: true,
    displayName: profile.name || profile.login || "",
  };
}

type GitHubEmail = { email: string; primary: boolean; verified: boolean };
type GitHubProfile = { id: number; name: string | null; login: string };

/**
 * Returns the account's PRIMARY VERIFIED address, or throws.
 *
 * postclaw's version fell back to any verified address when the primary was not
 * verified. AnyTools does not: AnyTools' account-linking policy keys on the
 * email, so accepting a secondary address would let someone add a victim's
 * address as a secondary on their own GitHub account and collide with — or, if
 * the policy ever loosened, link to — the victim's AnyTools account. One
 * address, the primary, verified, or no sign-in.
 */
async function fetchPrimaryVerifiedEmail(accessToken: string, doFetch: typeof fetch): Promise<string> {
  const res = await doFetch(GITHUB_EMAIL_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new OAuthExchangeError(`github email fetch returned ${res.status}`, "email_fetch_failed");
  }

  const emails = (await res.json()) as GitHubEmail[];
  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) {
    throw new OAuthExchangeError(
      "your GitHub account has no verified primary email address",
      "email_unverified",
    );
  }
  return primary.email;
}

async function fetchProfile(accessToken: string, doFetch: typeof fetch): Promise<GitHubProfile> {
  const res = await doFetch(GITHUB_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new OAuthExchangeError(`github user fetch returned ${res.status}`, "profile_fetch_failed");
  }
  const profile = (await res.json()) as GitHubProfile;
  if (!profile.id) {
    throw new OAuthExchangeError("github profile has no id", "profile_fetch_failed");
  }
  return profile;
}
