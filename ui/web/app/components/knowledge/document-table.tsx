import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { asSentence } from "~/lib/sentence";
import { cn } from "~/lib/utils";
import { driveReason } from "~/lib/drive-storage";
import type { DocumentStatus, KBDocument } from "~/lib/kb-types";
import { Badge, type BadgeType } from "~/components/doc/badge";
import { Flyout, FLYOUT_ITEM } from "~/components/doc/flyout";
import { DateText } from "~/components/ui/date-text";
import { ProcessedByBadge } from "./processed-by-badge";
import { useOverflowTabStop } from "~/components/doc/scroll-box";

/**
 * document-table.tsx
 *
 * The live status surface, as up's tables (pattern P5): Document, Type,
 * Status, Updated, and the row's actions in a flyout (I9). The parent
 * revalidates on every stream frame; this renders whatever the loader last
 * returned.
 *
 * Status is a badge (I6) carrying the word, so it is never colour alone:
 * work in progress is info, ready is tip, a failure is danger, and a video
 * waiting for its transcript is warning (waiting for the learner, not broken).
 */

const STATUS_BADGE: Record<DocumentStatus, BadgeType> = {
  queued: "info",
  parsing: "info",
  indexing: "info",
  ready: "tip",
  failed: "danger",
  needs_transcript: "warning",
};

function StatusCell({ document }: { document: KBDocument }) {
  const { t } = useTranslation("knowledge");
  const { t: tc } = useTranslation("common");
  // A parse that could not reach the original in the learner's Drive says
  // what to do about it (drive-user-storage phase 4).
  const drive = document.status === "failed" ? driveReason(document.error_code) : null;

  return (
    <div>
      <Badge type={STATUS_BADGE[document.status]}>{t(`status.${document.status}`)}</Badge>
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
          {asSentence(document.error)}
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

/** What a document is, for the Type column: the link's kind, or a file's extension. */
export function documentKind(doc: KBDocument, t: (key: string) => string): string {
  switch (doc.source_kind) {
    case "web":
      return t("source.web");
    case "youtube":
      return t("source.youtube");
    case "site_page":
      return t("sources.docKind.sitePage");
    case "repo_file":
      return t("sources.docKind.repoFile");
    case "media":
      return t((doc.media_mime ?? "").startsWith("video/") ? "media.kindVideo" : "media.kindAudio");
  }
  const ext = /\.([a-z0-9]{2,5})$/i.exec(doc.title)?.[1];
  return ext ? ext.toUpperCase() : t("table.kindFile");
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
  const [scrollTable, tableTabIndex] = useOverflowTabStop<HTMLTableElement>();

  if (documents.length === 0) {
    return <p className="my-4 text-base leading-[1.85] text-muted-foreground">{t("detail.empty")}</p>;
  }

  return (
    // lp-table scrolls sideways inside its own box, so a phone's page never
    // does. From 768 the table fits the column and the box lets the row's
    // flyout menu hang below the table instead of clipping it.
    <table ref={scrollTable} tabIndex={tableTabIndex} className="lp-table md:!overflow-visible">
      <caption className="sr-only">{t("detail.documents")}</caption>
      <thead>
        <tr>
          {["name", "kind", "status", "updated"].map((key) => (
            <th key={key} scope="col">
              {t(`table.${key}`)}
            </th>
          ))}
          <th scope="col">
            <span className="sr-only">{t("table.actions")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {documents.map((doc) => {
          const deleting = fetcher.state !== "idle" && fetcher.formData?.get("documentId") === doc.id;
          const facts = [
            doc.page_count ? t("table.pageCount", { count: doc.page_count }) : null,
            doc.chunk_count ? t("table.passageCount", { count: doc.chunk_count }) : null,
          ].filter(Boolean);

          return (
            <tr key={doc.id} className={cn(deleting && "opacity-50")}>
              <th scope="row" className="min-w-48">
                {doc.status === "ready" || doc.status === "needs_transcript" ? (
                  <Link
                    to={`/documents/${doc.id}`}
                    className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
                  >
                    {doc.title}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{doc.title}</span>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal">
                  {facts.length > 0 ? <span>{facts.join(" · ")}</span> : null}
                  <span className="sr-only">{t("table.processedBy")}:</span>
                  <ProcessedByBadge processedBy={doc.processed_by} />
                </div>
                <LinkMeta kbId={kbId} document={doc} />
              </th>
              <td className="whitespace-nowrap text-muted-foreground">{documentKind(doc, t)}</td>
              <td className="min-w-32">
                <StatusCell document={doc} />
              </td>
              <td className="whitespace-nowrap text-muted-foreground">
                <DateText iso={doc.updated_at} />
              </td>
              <td className="w-0">
                <Flyout
                  label={t("table.actionsFor", { title: doc.title })}
                  icon={<span aria-hidden="true">{t("table.actions")}</span>}
                  buttonClassName="h-8 rounded-sm px-2 whitespace-nowrap"
                  menuClassName="top-full mt-1"
                >
                  {doc.status === "ready" || doc.status === "needs_transcript" ? (
                    <Link to={`/documents/${doc.id}`} className={FLYOUT_ITEM}>
                      {t("table.view")}
                    </Link>
                  ) : null}
                  {doc.status === "failed" ? (
                    <fetcher.Form method="post" action={`/knowledge/${kbId}`}>
                      <input type="hidden" name="intent" value="retry-document" />
                      <input type="hidden" name="documentId" value={doc.id} />
                      <button type="submit" disabled={fetcher.state !== "idle"} className={cn(FLYOUT_ITEM, "disabled:opacity-50")}>
                        {t("table.retry")}
                      </button>
                    </fetcher.Form>
                  ) : null}
                  <fetcher.Form method="post" action={`/knowledge/${kbId}`}>
                    <input type="hidden" name="intent" value="delete-document" />
                    <input type="hidden" name="documentId" value={doc.id} />
                    <button
                      type="submit"
                      disabled={deleting}
                      // A destructive action with no confirmation is one
                      // mis-click from deleting a 400-page parse; the native
                      // confirm is keyboard-correct everywhere.
                      onClick={(event) => {
                        if (!window.confirm(t("table.removeConfirm"))) event.preventDefault();
                      }}
                      className={cn(FLYOUT_ITEM, "hover:text-destructive disabled:opacity-50")}
                    >
                      {t("table.remove")}
                    </button>
                  </fetcher.Form>
                </Flyout>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
      {host || transcript ? (
        <p className="text-xs text-muted-foreground">{[host, transcript].filter(Boolean).join(" · ")}</p>
      ) : null}
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
