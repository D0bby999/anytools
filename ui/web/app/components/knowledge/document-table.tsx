import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { driveReason } from "~/lib/drive-storage";
import type { DocumentStatus, KBDocument } from "~/lib/kb-types";
import { ProcessedByBadge } from "./processed-by-badge";

/**
 * document-table.tsx
 *
 * The live status surface. Phase 6 adds an SSE stream on top of the same
 * events; until then the parent revalidates on an interval while anything is
 * working, and this component renders whatever the loader last returned.
 *
 * Hairline rows rather than cards (DESIGN.md: "a grid of identical
 * icon-and-heading cards as page structure" is an anti-pattern here). Status is
 * carried by an icon, a word AND a colour, never by colour alone.
 */

const STATUS_ICON: Record<DocumentStatus, typeof Clock> = {
  queued: Clock,
  parsing: Loader2,
  indexing: Loader2,
  ready: CheckCircle2,
  failed: AlertTriangle,
  needs_transcript: FileText,
};

const STATUS_TONE: Record<DocumentStatus, string> = {
  queued: "text-muted-foreground",
  parsing: "text-muted-foreground",
  indexing: "text-muted-foreground",
  // "ready" is the brand green, which in this world is also the primary action
  // and the current nav row — deliberately one ink, because they are one idea.
  ready: "text-primary",
  failed: "text-destructive",
  // Waiting for the learner, not broken: the warning ink, not the danger one.
  needs_transcript: "text-warning",
};

function StatusCell({ document }: { document: KBDocument }) {
  const { t } = useTranslation("knowledge");
  const { t: tc } = useTranslation("common");
  const Icon = STATUS_ICON[document.status];
  // A parse that could not reach the original in the learner's Drive says
  // what to do about it (drive-user-storage phase 4).
  const drive = document.status === "failed" ? driveReason(document.error_code) : null;
  const spinning = document.status === "parsing" || document.status === "indexing";

  return (
    <div>
      <span className={cn("inline-flex items-center gap-1.5 text-sm", STATUS_TONE[document.status])}>
        <Icon
          aria-hidden="true"
          // motion-safe only: the world's motion rule is state feedback, and a
          // permanent spinner is exactly what a reduced-motion setting is for.
          className={cn("size-4", spinning && "motion-safe:animate-spin")}
        />
        {t(`status.${document.status}`)}
      </span>
      {(document.status === "failed" || document.status === "needs_transcript") && document.error ? (
        // The reason, in full, next to the failure. A truncated error is a
        // support ticket; parse failures already carry an actionable sentence
        // ("add a key in Settings") and hiding it wastes it.
        <p
          data-drive-reason={drive ?? undefined}
          className={cn(
            "mt-1 max-w-prose text-xs leading-snug",
            document.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {document.error}
          {drive === "drive_reconnect" ? (
            <>
              {" "}
              <Link to="/settings" className="text-primary underline underline-offset-4">
                {tc("driveStorage.reconnectLink")}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

export function DocumentTable({
  kbId,
  documents,
}: {
  kbId: string;
  documents: KBDocument[];
}) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher();

  if (documents.length === 0) {
    return <p className="py-6 text-sm leading-prose text-muted-foreground">{t("detail.empty")}</p>;
  }

  return (
    // The one horizontally scrollable element on the page. The shell's own
    // rule is that the body never scrolls sideways; a wide table has to carry
    // its own overflow or it breaks that at every phone width.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr className="border-b">
            {["name", "status", "pages", "passages", "processedBy"].map((key) => (
              <th
                key={key}
                scope="col"
                className="py-2 pr-4 font-mono text-2xs font-semibold tracking-label text-faint uppercase"
              >
                {t(`table.${key}`)}
              </th>
            ))}
            <th scope="col" className="py-2 text-right">
              <span className="sr-only">{t("table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const deleting =
              fetcher.state !== "idle" && fetcher.formData?.get("documentId") === doc.id;

            return (
              <tr key={doc.id} className={cn("border-b align-top", deleting && "opacity-50")}>
                <th scope="row" className="py-3 pr-4 font-sans text-sm font-medium">
                  {doc.status === "ready" || doc.status === "needs_transcript" ? (
                    <Link
                      to={`/documents/${doc.id}`}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {doc.title}
                    </Link>
                  ) : (
                    <span>{doc.title}</span>
                  )}
                  <LinkMeta kbId={kbId} document={doc} />
                </th>
                <td className="py-3 pr-4">
                  <StatusCell document={doc} />
                </td>
                <td className="py-3 pr-4 text-sm tabular-nums text-muted-foreground">
                  {doc.page_count || "—"}
                </td>
                <td className="py-3 pr-4 text-sm tabular-nums text-muted-foreground">
                  {doc.chunk_count || "—"}
                </td>
                <td className="py-3 pr-4">
                  <ProcessedByBadge processedBy={doc.processed_by} />
                </td>
                <td className="py-3 text-right">
                  <fetcher.Form method="post" action={`/knowledge/${kbId}`}>
                    <input type="hidden" name="intent" value="delete-document" />
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button
                      type="submit"
                      disabled={deleting}
                      // A destructive action with no confirmation is one
                      // mis-click from deleting a 400-page parse. The native
                      // confirm is deliberate: a modal here would need a focus
                      // trap to be accessible, and this is not the phase to
                      // build one.
                      onClick={(event) => {
                        if (!window.confirm(t("table.removeConfirm"))) event.preventDefault();
                      }}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-destructive-soft hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      <span className="sr-only sm:not-sr-only">{t("table.remove")}</span>
                    </button>
                  </fetcher.Form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The source line under a link's title: what kind of link, where it points,
 * and for a web page the sync controls. Files get nothing here.
 */
function LinkMeta({ kbId, document: doc }: { kbId: string; document: KBDocument }) {
  const { t } = useTranslation("knowledge");
  const sync = useFetcher<{ resynced?: { changed: boolean }; syncErrorKey?: string; syncErrorDetail?: string }>();
  const grouped = doc.source_kind === "site_page" || doc.source_kind === "repo_file";
  const recording = doc.source_kind === "media";
  if (doc.source_kind !== "web" && doc.source_kind !== "youtube" && !grouped && !recording) return null;

  let host = "";
  try {
    host = doc.source_url ? new URL(doc.source_url).hostname : "";
  } catch {
    host = "";
  }
  const kind =
    doc.source_kind === "web"
      ? t("source.web")
      : doc.source_kind === "site_page"
        ? t("sources.docKind.sitePage")
        : doc.source_kind === "repo_file"
          ? t("sources.docKind.repoFile")
          : recording
            ? t((doc.media_mime ?? "").startsWith("video/") ? "media.kindVideo" : "media.kindAudio")
            : t("source.youtube");
  const transcript =
    doc.transcript_source === "ai_transcript"
      ? t("source.aiTranscript")
      : doc.transcript_source === "learner"
        ? t("source.learner")
        : doc.transcript_source === "captions"
          ? t("source.captions")
          : null;
  const working = sync.state !== "idle";
  const done = doc.status === "ready" || doc.status === "failed";

  return (
    <div className="mt-1 space-y-1 font-normal">
      <p className="font-mono text-2xs tracking-label text-faint uppercase">
        {kind}
        {host ? ` · ${host}` : ""}
        {transcript ? ` · ${transcript}` : ""}
      </p>
      {doc.removed_at ? (
        <p className="text-xs text-warning">
          {doc.source_kind === "repo_file" ? t("sources.docKind.removedFromRepo") : t("sources.docKind.removedFromSite")}
        </p>
      ) : null}
      {doc.source_kind === "web" ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <sync.Form method="post" action={`/knowledge/${kbId}`}>
            <input type="hidden" name="intent" value="auto-sync" />
            <input type="hidden" name="documentId" value={doc.id} />
            <input type="hidden" name="auto_sync" value={doc.auto_sync ? "off" : "on"} />
            <label className="inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(doc.auto_sync)}
                disabled={working}
                onChange={(event) => sync.submit(event.currentTarget.form)}
                className="size-4"
              />
              {t("sync.auto")}
            </label>
          </sync.Form>
          <sync.Form method="post" action={`/knowledge/${kbId}`}>
            <input type="hidden" name="intent" value="resync" />
            <input type="hidden" name="documentId" value={doc.id} />
            <button
              type="submit"
              disabled={working || !done}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
            >
              <RefreshCw aria-hidden="true" className={cn("size-3.5", working && "motion-safe:animate-spin")} />
              {working ? t("sync.resyncing") : t("sync.resync")}
            </button>
          </sync.Form>
        </div>
      ) : null}
      {sync.data?.resynced ? (
        <p role="status" className="text-xs text-muted-foreground">
          {sync.data.resynced.changed ? t("sync.changed") : t("sync.unchanged")}
        </p>
      ) : null}
      {sync.data?.syncErrorKey ? (
        <p role="alert" className="text-xs text-destructive">
          {t(sync.data.syncErrorKey)}
          {sync.data.syncErrorDetail ? ` ${sync.data.syncErrorDetail}` : ""}
        </p>
      ) : null}
      {doc.sync_error ? (
        <p className="text-xs text-muted-foreground">{t("sync.failed", { reason: doc.sync_error })}</p>
      ) : null}
      {doc.auto_sync && (doc.sync_changes ?? 0) >= 3 ? (
        <p className="text-xs text-muted-foreground">{t("sync.weekly")}</p>
      ) : null}
    </div>
  );
}
