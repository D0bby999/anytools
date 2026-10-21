/**
 * The two sign-in lanes that finish in a second step: GitHub Copilot (enter a
 * code on GitHub) and Claude Pro/Max (paste the code Claude shows).
 *
 * Plain forms like the rest of the page. The started sign-in comes back in the
 * action's data and rides hidden inputs into the second form; its handle is
 * bound to this user on the server, so carrying it through the page is safe.
 * They render inside SubscriptionLaneCards, under its warning.
 */
import { Form, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { ClaudeStart, CopilotStart } from "~/lib/byok.types";

export function SubscriptionSignInCards({ copilot, claude }: { copilot: CopilotStart | null; claude: ClaudeStart | null }) {
  const { t } = useTranslation("common");
  const busy = useNavigation().state !== "idle";
  const field = "h-10 w-full rounded-md border bg-sunken px-3 font-mono text-sm";

  return (
    <>
      <div className="lp-download-card min-w-0">
        <h3 className="font-sans text-base font-medium">{t("settings.experimental.copilot.title")}</h3>
        <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("settings.experimental.copilot.body")}</p>

        {copilot ? (
          <Form method="post" className="mt-3 grid gap-3 sm:max-w-md">
            <input type="hidden" name="intent" value="copilot-finish" />
            <input type="hidden" name="session_id" value={copilot.session_id} />
            <input type="hidden" name="user_code" value={copilot.user_code} />
            <input type="hidden" name="verification_uri" value={copilot.verification_uri} />
            <p className="text-sm leading-prose">
              {t("settings.experimental.copilot.enterCode")}{" "}
              <a
                href={copilot.verification_uri}
                rel="noreferrer noopener"
                target="_blank"
                className="text-primary underline underline-offset-2"
              >
                {copilot.verification_uri}
              </a>
            </p>
            <p className="font-mono text-2xl tracking-widest" aria-label={t("settings.experimental.copilot.codeLabel")}>
              {copilot.user_code}
            </p>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("settings.experimental.copilot.finish")}
              </Button>
            </div>
          </Form>
        ) : (
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="copilot-start" />
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {t("settings.experimental.copilot.start")}
            </Button>
          </Form>
        )}
      </div>

      <div className="lp-download-card min-w-0">
        <h3 className="font-sans text-base font-medium">{t("settings.experimental.claude.title")}</h3>
        <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("settings.experimental.claude.body")}</p>

        {claude ? (
          <Form method="post" className="mt-3 grid gap-3 sm:max-w-md">
            <input type="hidden" name="intent" value="claude-finish" />
            <input type="hidden" name="session_id" value={claude.session_id} />
            <input type="hidden" name="authorize_url" value={claude.authorize_url} />
            <p className="text-sm leading-prose">
              <a
                href={claude.authorize_url}
                rel="noreferrer noopener"
                target="_blank"
                className="text-primary underline underline-offset-2"
              >
                {t("settings.experimental.claude.open")}
              </a>
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="lp-kicker">{t("settings.experimental.claude.code")}</span>
              <input type="password" name="code" required autoComplete="off" className={field} />
            </label>
            <div>
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                {t("settings.experimental.connect")}
              </Button>
            </div>
          </Form>
        ) : (
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="claude-start" />
            <Button type="submit" variant="outline" size="sm" disabled={busy}>
              {t("settings.experimental.claude.start")}
            </Button>
          </Form>
        )}
      </div>
    </>
  );
}
