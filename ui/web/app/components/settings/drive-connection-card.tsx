/**
 * Google Drive, as a connection.
 *
 * Deliberately a row of its own rather than a ConnectionCard: a BYOK connection
 * is a key the user pasted, and this is a consent the user gave to Google. It
 * has no key to replace and no Verify — Google either honours the grant or the
 * row says "reconnect" — and its Disconnect also REVOKES the grant at Google,
 * which the confirmation says, because that is the part a user would not guess.
 *
 * The route renders this only when Drive is configured on both the BFF and the
 * API. There is no "not configured" state here, by construction.
 */
import { Dialog } from "~/components/doc/dialog";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import { Timestamp } from "~/components/knowledge/drive-grants";
import { useFileStorage } from "~/components/storage/save-to-drive";
import type { DriveStatus } from "~/lib/drive-types";
import type { ReadinessStatus } from "~/lib/byok.types";

export function driveStatusTone(status: DriveStatus): ReadinessStatus {
  if (!status.connected) return "warn";
  if (status.needs_reconnect) return "blocked";
  if (status.re_pick > 0 || status.sync?.last_error) return "warn";
  return "green";
}

export function DriveConnectionCard({ status, storage }: { status: DriveStatus; storage?: "server" | "drive" }) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const tone = driveStatusTone(status);
  const connectHref = `/auth/drive?next=${encodeURIComponent("/settings")}`;
  // Drive-user-storage phase 3: with the learner's own files kept in this
  // Drive, Disconnect first says what happens to them. Phase 4: so it does
  // when new files are set to go there (Settings → Storage), even before
  // the first one has.
  const inDrive = status.files_in_drive ?? 0;
  const shell = useFileStorage();
  const keeps = inDrive > 0 || (storage ?? shell) === "drive";
  const [confirming, setConfirming] = useState(false);

  const label = !status.connected
    ? t("settings.connections.drive.notConnected")
    : tone === "green"
      ? t("settings.readiness.ready")
      : tone === "warn"
        ? t("settings.readiness.attention")
        : t("settings.readiness.blocked");

  return (
    <section aria-labelledby="lp-drive" className="mt-10">
      <h2 id="lp-drive" className="lp-section">
        {t("settings.connections.drive.title")}
      </h2>

      <div className="lp-download-card mt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-sans text-base font-medium">{t("settings.connections.drive.name")}</h3>
          <StatusPill status={tone} label={label} />
        </div>

        {!status.connected ? (
          <>
            <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
              {t("settings.connections.drive.body")}
            </p>
            {inDrive > 0 ? (
              <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose text-warning">
                {t("settings.connections.drive.inDriveDisconnected", { count: inDrive })}
              </p>
            ) : null}
          </>
        ) : (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {status.email ? (
              <>
                <dt className="lp-kicker">{t("settings.connections.drive.account")}</dt>
                <dd className="text-muted-foreground">{status.email}</dd>
              </>
            ) : null}
            <dt className="lp-kicker">{t("settings.connections.drive.files")}</dt>
            <dd className="tabular-nums text-muted-foreground">{status.grants}</dd>
            {inDrive > 0 ? (
              <>
                <dt className="lp-kicker">{t("settings.connections.drive.inDrive")}</dt>
                <dd className="tabular-nums text-muted-foreground">{inDrive}</dd>
              </>
            ) : null}
            {status.sync?.last_sync_at ? (
              <>
                <dt className="lp-kicker">{t("settings.connections.drive.lastSync")}</dt>
                <dd className="text-xs text-muted-foreground">
                  <Timestamp iso={status.sync.last_sync_at} />
                </dd>
              </>
            ) : null}
          </dl>
        )}

        {status.needs_reconnect ? (
          <p className="mt-2 text-sm leading-prose text-destructive">{t("settings.connections.drive.needsReconnect")}</p>
        ) : null}
        {status.connected && status.re_pick > 0 ? (
          <p className="mt-2 text-sm leading-prose text-warning">{t("settings.connections.drive.rePick", { count: status.re_pick })}</p>
        ) : null}
        {status.sync?.last_error ? <p className="mt-2 text-sm leading-prose text-destructive">{status.sync.last_error}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          {!status.connected || status.needs_reconnect ? (
            // A document navigation: /auth/drive redirects to Google.
            <Button asChild variant="outline" size="sm">
              <a href={connectHref}>
                {status.connected ? t("settings.connections.drive.reconnect") : t("settings.connections.drive.connect")}
              </a>
            </Button>
          ) : null}
          {status.connected ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              {t("settings.connections.drive.disconnect")}
            </Button>
          ) : null}
        </div>

        <Dialog
          open={status.connected && confirming}
          onClose={() => setConfirming(false)}
          title={keeps ? t("settings.connections.drive.disconnectFilesTitle") : t("settings.connections.drive.disconnect")}
        >
          {keeps ? (
            <DisconnectWithFiles busy={busy} onKeep={() => setConfirming(false)} />
          ) : (
            <>
              <p>{t("settings.connections.drive.confirmDisconnect")}</p>
              <Form method="post" className="mt-4 flex justify-end gap-2">
                <input type="hidden" name="intent" value="drive-disconnect" />
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  {t("settings.connections.drive.keepConnected")}
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  {t("settings.connections.drive.disconnect")}
                </Button>
              </Form>
            </>
          )}
        </Dialog>
      </div>
    </section>
  );
}

/**
 * What Disconnect says when the learner's own files are kept in this Drive
 * (drive-user-storage phase 3): they stay there, AnyTools cannot open them
 * until a reconnect, and they can be moved back to the server first (phase
 * 2's move, on Settings → Storage). Disconnecting anyway is the same post as
 * before.
 */
function DisconnectWithFiles({ busy, onKeep }: { busy: boolean; onKeep: () => void }) {
  const { t } = useTranslation("common");
  return (
    <div role="region" aria-labelledby="lp-drive-disconnect" className="mt-4 rounded-md border px-4 py-3">
      <h3 id="lp-drive-disconnect" className="lp-section">
        {t("settings.connections.drive.disconnectFilesTitle")}
      </h3>
      <ul className="mt-2 max-w-(--lp-measure-read) space-y-1 text-sm leading-prose">
        <li>{t("settings.connections.drive.disconnectFilesStay")}</li>
        <li>{t("settings.connections.drive.disconnectFilesClosed")}</li>
        <li>{t("settings.connections.drive.disconnectFilesMove")}</li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/storage">{t("settings.connections.drive.moveBackFirst")}</Link>
        </Button>
        <Form method="post">
          <input type="hidden" name="intent" value="drive-disconnect" />
          <Button type="submit" variant="ghost" size="sm" className="text-destructive" disabled={busy}>
            {t("settings.connections.drive.disconnectAnyway")}
          </Button>
        </Form>
        <Button type="button" variant="ghost" size="sm" onClick={onKeep}>
          {t("settings.connections.drive.keepConnected")}
        </Button>
      </div>
    </div>
  );
}
