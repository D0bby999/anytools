import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { StatusPill } from "~/components/settings/readiness-matrix";
import { DrivePickerButton } from "~/components/knowledge/drive-picker";
import type { DriveGrant, DriveNotice, DriveStatus, GrantState, PickerConfig, SyncReport } from "~/lib/drive-types";
import { cn } from "~/lib/utils";
import type { ReadinessStatus } from "~/lib/byok.types";

/**
 * drive-grants.tsx
 *
 * The knowledge base's Google Drive section: what was picked, whether each
 * item is still in sync, and the three controls that act on it — connect (or
 * reconnect), Sync now, and Pick more.
 *
 * It states the connector's promise in plain words, under the controls. Spike C
 * could not prove that a file added to a picked folder LATER is visible under
 * drive.file, and the evidence leans no — so the page says that such files
 * need Pick more, instead of letting a user wait for a sync that will never
 * bring them in (AC2, fallback wording).
 *
 * The parent renders this only when Drive is configured on both the BFF and the
 * API. There is no "not configured" state here to design, by construction.
 */

const GRANT_TONE: Record<GrantState, ReadinessStatus> = {
  active: "green",
  "re-pick": "warn",
  removed: "blocked",
};

export function DriveGrants({
  kbId,
  picker,
  status,
  grants,
}: {
  kbId: string;
  picker: PickerConfig;
  status: DriveStatus;
  grants: DriveGrant[];
}) {
  const { t } = useTranslation("knowledge");
  const connectHref = `/auth/drive?next=${encodeURIComponent(`/knowledge/${kbId}`)}`;

  return (
    <section aria-labelledby="lp-kb-drive" className="mt-8">
      <h2 id="lp-kb-drive" className="lp-kicker">
        {t("drive.label")}
      </h2>

      {!status.connected ? (
        <div className="mt-3">
          <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
            {t("drive.connectBody")}
          </p>
          <div className="mt-3">
            {/* A document navigation, not a client transition: /auth/drive is
                a resource route that redirects to Google. */}
            <Button asChild variant="outline" size="sm">
              <a href={connectHref}>{t("drive.connect")}</a>
            </Button>
          </div>
        </div>
      ) : status.needs_reconnect ? (
        <div className="mt-3">
          <p role="status" className="max-w-(--lp-measure-read) text-sm leading-prose text-warning">
            {t("drive.needsReconnect")}
          </p>
          <div className="mt-3">
            <Button asChild variant="outline" size="sm">
              <a href={connectHref}>{t("drive.reconnect")}</a>
            </Button>
          </div>
          <GrantList grants={grants} />
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap items-start gap-2">
            <DrivePickerButton
              kbId={kbId}
              picker={picker}
              label={grants.length === 0 ? t("drive.add") : t("drive.pickMore")}
            />
            {grants.length > 0 ? <SyncNow /> : null}
          </div>

          <p className="mt-3 max-w-(--lp-measure-read) text-xs leading-snug text-muted-foreground">
            {t("drive.pickMoreHint")}
          </p>

          <LastSync status={status} />
          <GrantList grants={grants} />
        </div>
      )}
    </section>
  );
}

/**
 * Sync now. The sync is per ACCOUNT rather than per knowledge base — Drive's
 * change feed is one stream per user — so pressing it here also refreshes the
 * user's other knowledge bases, which is harmless and what they would expect.
 */
function SyncNow() {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<{ syncReport?: SyncReport; driveErrorKey?: string; driveErrorDetail?: string }>();
  const busy = fetcher.state !== "idle";
  const data = fetcher.data;

  return (
    <div>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="drive-sync" />
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          <RefreshCw aria-hidden="true" className={busy ? "motion-safe:animate-spin" : undefined} />
          {busy ? t("drive.syncing") : t("drive.syncNow")}
        </Button>
      </fetcher.Form>
      {data?.syncReport ? (
        <p role="status" className="mt-2 text-sm leading-snug text-muted-foreground">
          {data.syncReport.baselined
            ? t("drive.syncBaselined")
            : t("drive.syncResult", {
                checked: data.syncReport.checked,
                reimported: data.syncReport.reimported,
              })}
        </p>
      ) : null}
      {data?.driveErrorKey ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t(data.driveErrorKey)}
          {data.driveErrorDetail ? ` ${data.driveErrorDetail}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function LastSync({ status }: { status: DriveStatus }) {
  const { t } = useTranslation("knowledge");
  const sync = status.sync;
  if (!sync?.last_sync_at && !sync?.last_error) return null;

  return (
    <p className="mt-2 text-xs leading-snug text-muted-foreground">
      {sync.last_sync_at ? (
        <>
          {t("drive.lastSync")} <Timestamp iso={sync.last_sync_at} />
        </>
      ) : null}
      {sync.last_error ? <span className="block text-destructive">{sync.last_error}</span> : null}
    </p>
  );
}

/**
 * The grants, one hairline row each.
 *
 * A folder's children are shown under their folder's name rather than nested
 * visually: the folder row is the record of what was picked, and the children
 * are what it contained at that moment — which is exactly the thing the hint
 * above asks the user to understand.
 */
export function GrantList({ grants }: { grants: DriveGrant[] }) {
  const { t } = useTranslation("knowledge");
  if (grants.length === 0) {
    return <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("drive.empty")}</p>;
  }

  const folderNames = new Map(grants.filter((g) => g.kind === "folder").map((g) => [g.file_id, g.name]));
  const stateLabel: Record<GrantState, string> = {
    active: t("drive.state.active"),
    "re-pick": t("drive.state.rePick"),
    removed: t("drive.state.removed"),
  };

  return (
    <ul aria-label={t("drive.grantsLabel")} className="mt-4 border-t">
      {grants.map((grant) => {
        const parent = grant.parent_file_id ? folderNames.get(grant.parent_file_id) : undefined;
        return (
          <li key={grant.id} className="border-b py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-sans text-sm font-medium">
                <span className="mr-2 font-mono text-2xs font-semibold tracking-label text-faint uppercase">
                  {grant.kind === "folder" ? t("drive.kind.folder") : t("drive.kind.file")}
                </span>
                {grant.document_id ? (
                  <Link
                    to={`/documents/${grant.document_id}`}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {grant.name}
                  </Link>
                ) : (
                  grant.name
                )}
              </p>
              <StatusPill status={GRANT_TONE[grant.state] ?? "warn"} label={stateLabel[grant.state] ?? grant.state} />
            </div>
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {parent ? `${t("drive.inFolder")} ${parent}` : null}
              {parent && grant.synced_at ? " · " : null}
              {grant.synced_at ? (
                <>
                  {t("drive.synced")} <Timestamp iso={grant.synced_at} />
                </>
              ) : null}
            </p>
            {grant.last_error ? (
              <p className="mt-1 max-w-prose text-xs leading-snug text-destructive">{grant.last_error}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The one sentence /auth/drive/callback sends the user back with, on whichever
 * page the flow started from. The notice is a closed set (DRIVE_NOTICES), so
 * only copy that exists can render.
 */
export function DriveNoticeLine({ notice }: { notice: DriveNotice }) {
  const { t } = useTranslation("knowledge");
  const ok = notice === "connected";
  return (
    <p role={ok ? "status" : "alert"} className={cn("mt-6 text-sm leading-snug", ok ? "text-primary" : "text-destructive")}>
      {t(`drive.notice.${notice}`)}
    </p>
  );
}

/**
 * A UTC timestamp, formatted identically on the server and in the browser. A
 * locale-aware format would render one string during SSR and another after
 * hydration, and React would warn about the mismatch on every page load.
 *
 * Normalised through Date first: the API serialises timestamptz in the
 * server's own zone, so slicing the raw string could label a +07:00 time UTC.
 */
export function Timestamp({ iso }: { iso: string }) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const utc = date.toISOString();
  return (
    <time dateTime={utc} className="font-mono tabular-nums">
      {`${utc.slice(0, 16).replace("T", " ")} UTC`}
    </time>
  );
}
