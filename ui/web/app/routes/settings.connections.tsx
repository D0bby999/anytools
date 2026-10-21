/**
 * settings.connections.tsx
 * Add a key, verify it, remove it — and, when the experimental flag is on, the
 * two subscription lanes.
 *
 * The whole page is `<Form method="post">` and a loader. No fetch from the
 * browser, no client state to get out of sync with the server, and — the part
 * that matters — no path by which a pasted key reaches anything but this
 * server's action, which forwards it straight to the API.
 *
 * Phase 13: Google Drive appears here as its own row, with connect and
 * disconnect — and only when Drive is configured on both the BFF and the API.
 */
import { data, Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.connections";
import { requireUser } from "~/lib/auth.server";
import {
  connectGeminiSubscription,
  connectRelay,
  createConnection,
  geminiConsentURL,
  deleteConnection,
  finishClaude,
  finishCopilot,
  formErrorMessage,
  startClaude,
  startCopilot,
  listConnections,
  updateConnection,
  verifyConnection,
} from "~/lib/byok.server";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { ConnectionCard } from "~/components/settings/connection-card";
import { SubscriptionLaneCards } from "~/components/settings/subscription-lane-card";
import { DriveConnectionCard } from "~/components/settings/drive-connection-card";
import { DriveNoticeLine } from "~/components/knowledge/drive-grants";
import { disconnectDrive, loadDrive, type DriveAvailability } from "~/lib/drive.server";
import { parseDriveNotice } from "~/lib/drive-types";
import { ApiError } from "~/lib/api.server";
import type { ClaudeStart, CopilotStart } from "~/lib/byok.types";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const payload = await listConnections(user.id);

  // The Gemini lane's consent URL is built only when the user asks for one, by
  // submitting the redirect they registered with their own Google client. It is
  // a GET form, so the request is shareable and re-runnable and does not need
  // an action.
  const redirectURI = new URL(request.url).searchParams.get("gemini_redirect_uri") ?? "";
  let geminiAuthURL: string | null = null;
  if (payload.lanes_enabled && redirectURI) {
    try {
      geminiAuthURL = (await geminiConsentURL(user.id, redirectURI)).url;
    } catch {
      // A missing OAuth client on this deployment is the common case and the
      // card already explains it; failing the whole page over it would hide the
      // connections the user does have.
      geminiAuthURL = null;
    }
  }
  // Drive is a section of this page, not its subject: a status the API could
  // not produce must not take the keys list down with it.
  let drive: DriveAvailability = null;
  let driveUnavailable = false;
  try {
    drive = await loadDrive(user.id);
  } catch {
    driveUnavailable = true;
  }

  return { ...payload, redirectURI, geminiAuthURL, drive, driveUnavailable };
}

/** What an action hands back: an error to show, and a sign-in in progress. */
type ActionResult = {
  ok: boolean;
  message: string | null;
  copilot?: CopilotStart | null;
  claude?: ClaudeStart | null;
};

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => String(form.get(k) ?? "");
  // A second-step form carries its started sign-in back, so a failed finish
  // can show the same code or link again instead of starting over.
  const copilotInFlight: CopilotStart | null =
    intent === "copilot-finish"
      ? { session_id: str("session_id"), user_code: str("user_code"), verification_uri: str("verification_uri") }
      : null;
  const claudeInFlight: ClaudeStart | null =
    intent === "claude-finish" ? { session_id: str("session_id"), authorize_url: str("authorize_url") } : null;

  try {
    switch (intent) {
      case "create": {
        await createConnection(user.id, {
          provider: String(form.get("provider") ?? ""),
          name: String(form.get("name") ?? ""),
          api_base: String(form.get("api_base") ?? ""),
          secret: String(form.get("secret") ?? ""),
        });
        return data<ActionResult>({ ok: true, message: null as string | null });
      }
      case "replace-key": {
        await updateConnection(user.id, String(form.get("id") ?? ""), {
          secret: String(form.get("secret") ?? ""),
        });
        return data<ActionResult>({ ok: true, message: null });
      }
      case "verify": {
        // Chat is the default probe: "does this key work" is what a person
        // means when they have just pasted one. Per-function verification
        // happens when a route is saved.
        const result = await verifyConnection(user.id, String(form.get("id") ?? ""), "chat");
        return data<ActionResult>({ ok: result.ok, message: result.ok ? null : (result.message ?? null) });
      }
      case "connect-relay": {
        await connectRelay(user.id, {
          name: String(form.get("name") ?? ""),
          access_token: String(form.get("access_token") ?? ""),
          refresh_token: String(form.get("refresh_token") ?? ""),
          expires_in: Number(form.get("expires_in") ?? 0),
          account_id: String(form.get("account_id") ?? ""),
        });
        return data<ActionResult>({ ok: true, message: null });
      }
      case "connect-gemini-sub": {
        await connectGeminiSubscription(user.id, {
          name: String(form.get("name") ?? ""),
          code: String(form.get("code") ?? ""),
          redirect_uri: String(form.get("redirect_uri") ?? ""),
        });
        return data<ActionResult>({ ok: true, message: null });
      }
      case "copilot-start": {
        return data<ActionResult>({ ok: true, message: null, copilot: await startCopilot(user.id) });
      }
      case "copilot-finish": {
        const result = await finishCopilot(user.id, { session_id: str("session_id"), name: "" });
        if ("status" in result) {
          return data<ActionResult>({
            ok: false,
            message: "GitHub has not seen the approval yet. Enter the code on GitHub, approve, then press Finish again.",
            copilot: copilotInFlight,
          });
        }
        return data<ActionResult>({ ok: true, message: null });
      }
      case "claude-start": {
        return data<ActionResult>({ ok: true, message: null, claude: await startClaude(user.id) });
      }
      case "claude-finish": {
        await finishClaude(user.id, { session_id: str("session_id"), code: str("code"), name: "" });
        return data<ActionResult>({ ok: true, message: null });
      }
      case "drive-disconnect": {
        await disconnectDrive(user.id);
        return data<ActionResult>({ ok: true, message: null });
      }
      case "delete": {
        await deleteConnection(user.id, String(form.get("id") ?? ""));
        return data<ActionResult>({ ok: true, message: null });
      }
      default:
        return data<ActionResult>({ ok: false, message: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    // A 404 on a finish means the sign-in expired: offer a fresh start
    // rather than the stale code.
    const expired = err instanceof ApiError && err.status === 404;
    return data<ActionResult>(
      {
        ok: false,
        message: formErrorMessage(err, "That did not work. Try again."),
        copilot: expired ? null : copilotInFlight,
        claude: expired ? null : claudeInFlight,
      },
      { status: 400 },
    );
  }
}

export default function Connections({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const [searchParams] = useSearchParams();
  const driveNotice = parseDriveNotice(searchParams.get("drive"));

  return (
    <div>
      {actionData?.message ? (
        <Alert variant="destructive" className="mb-5">
          {actionData.message}
        </Alert>
      ) : null}
      {driveNotice ? <DriveNoticeLine notice={driveNotice} /> : null}

      {/* Adding a key starts from the provider's own page (plan 261021-1100
          phase 4): forty-odd providers are a grid with a search, not a select. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link to="/settings/providers">{t("settings.providers.browse")}</Link>
        </Button>
        <p className="text-sm leading-prose text-muted-foreground">{t("settings.connections.addBody")}</p>
      </div>

      <section aria-labelledby="lp-connected" className="mt-10">
        <h2 id="lp-connected" className="lp-section">
          {t("settings.connections.connectedTitle")}
        </h2>

        {loaderData.connections.length === 0 ? (
          <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("settings.connections.empty")}</p>
        ) : (
          <ul className="lp-download-grid !list-none !p-0">
            {loaderData.connections.map((connection) => (
              <ConnectionCard key={connection.id} connection={connection} />
            ))}
          </ul>
        )}
      </section>

      {loaderData.drive ? (
        <DriveConnectionCard status={loaderData.drive.status} />
      ) : loaderData.driveUnavailable ? (
        <p className="mt-10 text-sm leading-prose text-muted-foreground">{t("settings.connections.drive.unavailable")}</p>
      ) : null}

      <SubscriptionLaneCards
        enabled={loaderData.lanes_enabled}
        geminiRedirectURI={loaderData.redirectURI}
        geminiAuthURL={loaderData.geminiAuthURL}
        copilot={actionData?.copilot ?? null}
        claude={actionData?.claude ?? null}
      />
    </div>
  );
}
