import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { SubscriptionSignInCards } from "~/components/settings/subscription-signin-cards";
import type { ClaudeStart, CopilotStart } from "~/lib/byok.types";

/**
 * The experimental subscription lanes.
 *
 * This component exists as much for its warning as for its form. Both lanes ask
 * the user to do something with real consequences, and neither consequence is
 * guessable from the outside:
 *
 *  - The ChatGPT lane makes this server present itself to chatgpt.com as the
 *    first-party Codex CLI running on the user's own machine. It is not licensed
 *    for proxying and the account may be restricted.
 *  - The Gemini Code Assist lane asks Google for `cloud-platform` scope, so the
 *    token it stores is a full Google Cloud credential for that user, not an AI
 *    quota.
 *  - The Copilot and Claude lanes sign in as VS Code's Copilot extension and as
 *    Claude Code. Neither GitHub nor Anthropic licenses a subscription for use
 *    through another app.
 *
 * The warning is therefore rendered ABOVE the form, as an `Alert` with
 * role="alert", and is not collapsible. A disclosure a user can ship without
 * reading is not a disclosure.
 *
 * The whole card only renders when the server says the lanes are enabled
 * (ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES=1), which is off by default.
 */
export function SubscriptionLaneCards({
  enabled,
  geminiRedirectURI,
  geminiAuthURL,
  copilot = null,
  claude = null,
}: {
  enabled: boolean;
  geminiRedirectURI: string;
  geminiAuthURL: string | null;
  copilot?: CopilotStart | null;
  claude?: ClaudeStart | null;
}) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  if (!enabled) return null;

  const field =
    "h-10 w-full rounded-md border bg-sunken px-3 font-mono text-sm";

  return (
    <section aria-labelledby="lp-experimental" className="mt-10">
      <h2 id="lp-experimental" className="lp-kicker">
        {t("settings.experimental.title")}
      </h2>

      <Alert variant="destructive" className="mt-3">
        <p className="leading-prose">{t("settings.experimental.warning")}</p>
      </Alert>

      <div className="mt-4 space-y-6">
        <SubscriptionSignInCards copilot={copilot} claude={claude} />
        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-sans text-base font-medium">{t("settings.experimental.chatgpt.title")}</h3>
          <p className="mt-1 text-sm leading-prose text-muted-foreground">
            {t("settings.experimental.chatgpt.body")}
          </p>

          <Form method="post" className="mt-3 grid gap-3 sm:max-w-md">
            <input type="hidden" name="intent" value="connect-relay" />
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.chatgpt.accessToken")}</span>
              <input type="password" name="access_token" required autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.chatgpt.refreshToken")}</span>
              <input type="password" name="refresh_token" required autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.chatgpt.accountId")}</span>
              <input type="text" name="account_id" required autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.chatgpt.expiresIn")}</span>
              {/* Not optional in practice. With no expiry recorded the token is
                  treated as long-lived and is never refreshed, so the
                  connection works for about an hour and then fails in a way
                  that looks like a revoked account. */}
              <input
                type="number"
                name="expires_in"
                min={60}
                defaultValue={3600}
                required
                className={field}
              />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("settings.experimental.connect")}
              </Button>
            </div>
          </Form>
        </div>

        <div className="rounded-lg border bg-card p-5">
          <h3 className="font-sans text-base font-medium">{t("settings.experimental.gemini.title")}</h3>
          <p className="mt-1 text-sm leading-prose text-muted-foreground">
            {t("settings.experimental.gemini.body")}
          </p>

          {/* Step one: get a consent URL. Built server-side with the scope,
              access_type=offline and prompt=consent that make Google return a
              refresh token at all — get any of those wrong by hand and the
              connection works for an hour and then dies. */}
          <Form method="get" className="mt-3 grid gap-3 sm:max-w-md">
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.gemini.redirectUri")}</span>
              <input
                type="text"
                name="gemini_redirect_uri"
                defaultValue={geminiRedirectURI}
                className={field}
              />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("settings.experimental.gemini.buildUrl")}
              </Button>
            </div>
          </Form>

          {geminiAuthURL ? (
            <p className="mt-3 text-sm leading-prose">
              <a
                href={geminiAuthURL}
                rel="noreferrer noopener"
                target="_blank"
                className="text-primary underline underline-offset-2"
              >
                {t("settings.experimental.gemini.openConsent")}
              </a>
            </p>
          ) : null}

          {/* Step two: paste back what Google gave you. */}
          <Form method="post" className="mt-4 grid gap-3 sm:max-w-md">
            <input type="hidden" name="intent" value="connect-gemini-sub" />
            <input type="hidden" name="redirect_uri" value={geminiRedirectURI} />
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.gemini.code")}</span>
              <input type="password" name="code" required autoComplete="off" className={field} />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("settings.experimental.connect")}
              </Button>
            </div>
          </Form>
        </div>
      </div>
    </section>
  );
}
