/**
 * knowledge.$kbId.tsx
 * One knowledge base: its documents with live status, the upload dropzone, the
 * reindex control and the retrieval debug panel.
 *
 * Live status is a STREAM: `GET /v1/kb/{id}/events` through the RR7 proxy under
 * topic `kb`. Each frame triggers a revalidation rather than patching a row in
 * place, because the frame says a document MOVED and the loader says what it
 * moved to — and only one of those two can be wrong about chunk counts,
 * `processed_by` and the reindex flag.
 *
 * The poll is kept as a fallback and nothing else. The fan-out behind the
 * stream is process-local (docs/architecture.md §2) and EventSource eventually
 * gives up, so when the connection is in the `error` state and work is still in
 * flight the interval takes over; a document that finished during a dropped
 * connection must not sit at "Reading" forever.
 *
 * Learning-depth phase 4 adds "Add a link": a web page or a YouTube video.
 *
 * Up-methods phase 18 adds "Add a site" and "Add a repository", and the list
 * of the knowledge base's sites and repositories with their progress.
 *
 * Up-methods phase 17 adds the knowledge base's feeds, with how many entries
 * are new; "Add a link" given a podcast feed or a YouTube playlist follows it.
 *
 * Phase 13 adds the Google Drive section — present only when Drive is
 * configured on both the BFF and the API (drive.server `loadDrive`), so a
 * deployment without a GCP project shows no Drive button at all.
 */
import { useCallback, useEffect, useState } from "react";
import { Form, Link, useFetcher, useRevalidator, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2 } from "lucide-react";
import { PanelTabs } from "~/components/ui/panel-tabs";
import type { Route } from "./+types/knowledge.$kbId";
import { appTitle, raw } from "~/lib/app-title";
import { AudioOverviews } from "~/components/audio/audio-overviews";
import { RelatedPapers } from "~/components/knowledge/related-papers";
import { ZoteroPanel } from "~/components/knowledge/zotero-panel";
import { loadOverviews } from "~/lib/audio.server";
import { KbBooks } from "~/components/book/kb-books";
import { loadBooks } from "~/lib/books.server";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  addLink,
  deleteDocument,
  deleteKB,
  getKB,
  listDocuments,
  queryKB,
  reindexKB,
  retryDocument,
  resyncDocument,
  setAutoSync,
  uploadDocument,
  uploadPhotos,
} from "~/lib/kb.server";
import { isWorking } from "~/lib/kb-types";
import {
  importFromDrive,
  listDriveGrants,
  loadDrive,
  parsePicked,
  syncDrive,
  type DriveAvailability,
  type DriveGrant,
} from "~/lib/drive.server";
import { parseDriveNotice } from "~/lib/drive-types";
import { useEventStream } from "~/hooks/use-event-stream";
import { Button } from "~/components/ui/button";
import { DocumentTable } from "~/components/knowledge/document-table";
import { UploadDropzone } from "~/components/knowledge/upload-dropzone";
import { ImportHighlights } from "~/components/knowledge/import-highlights";
import { RetrievalDebug } from "~/components/knowledge/retrieval-debug";
import { AddLink } from "~/components/knowledge/add-link";
import { AddSite } from "~/components/knowledge/add-site";
import { AddRepo } from "~/components/knowledge/add-repo";
import { KbSources } from "~/components/knowledge/kb-sources";
import { FeedPanel } from "~/components/knowledge/feed-panel";
import { listFeeds } from "~/lib/feeds.server";
import type { FeedsData } from "~/lib/feeds-types";
import { loadSources } from "~/lib/sources.server";
import type { SourcesData } from "~/lib/sources-types";
import { DriveGrants, DriveNoticeLine } from "~/components/knowledge/drive-grants";
import { driveReason } from "~/lib/drive-storage";
import { PageHeader } from "~/components/ui/page-header";
import { Alert, AlertTitle } from "~/components/ui/alert";
import { DateText } from "~/components/ui/date-text";
import { AtAGlance } from "~/components/doc/at-a-glance";
import { Badge } from "~/components/doc/badge";
import { BookMeta } from "~/components/doc/book-meta";
import { Dialog } from "~/components/doc/dialog";
import { DocSection, Prose } from "~/components/reading/doc-section";
import { NOTE_JOIN } from "~/lib/sentence";

/** How often the document list is refetched when the stream is not available. */
const POLL_MS = 2500;

/** Wire names knowledge.Events publishes. */
const KB_EVENTS = ["document.status", "document.fallback"] as const;

export function meta({ data, matches }: Route.MetaArgs) {
  return [
    { title: data?.kb ? appTitle(matches, raw(data.kb.name)) : appTitle(matches) },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const kbId = params.kbId;

  try {
    // Both calls are scoped by the session's user id. The API answers 404 for
    // a knowledge base that is not this user's, identically to one that does
    // not exist, so there is nothing to distinguish here either.
    const [kb, documents] = await Promise.all([
      getKB(user.id, kbId),
      listDocuments(user.id, kbId),
    ]);
    return {
      kb,
      documents: documents.documents,
      overviews: await loadOverviews(user.id, { kb_id: kbId }),
      books: await loadBooks(user.id, kbId),
      sources: await loadSourcesSection(user.id, kbId),
      feeds: await loadFeedsSection(user.id, kbId),
      ...(await loadDriveSection(user.id, kbId)),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

/**
 * Sites and repositories, kept from failing the page like Drive: null means
 * the section could not load (or the server has no source support).
 */
async function loadSourcesSection(userId: string, kbId: string): Promise<SourcesData | null> {
  try {
    return await loadSources(userId, kbId);
  } catch {
    return null;
  }
}

/** Feeds (up-methods phase 17), kept from failing the page the same way. */
async function loadFeedsSection(userId: string, kbId: string): Promise<FeedsData | null> {
  try {
    return await listFeeds(userId, kbId);
  } catch {
    return null;
  }
}

/**
 * The Drive half of the loader, kept from failing the page.
 *
 * A Drive status the API could not produce is news about one section, not
 * about the knowledge base: the document list must still render. The section
 * then says it could not load, rather than vanishing — vanishing is what an
 * unconfigured deployment looks like, and an outage must not pass for that.
 */
async function loadDriveSection(
  userId: string,
  kbId: string,
): Promise<{ drive: DriveAvailability; grants: DriveGrant[]; driveUnavailable: boolean }> {
  try {
    const drive = await loadDrive(userId);
    const grants = drive ? (await listDriveGrants(userId, kbId)).grants : [];
    return { drive, grants, driveUnavailable: false };
  } catch {
    return { drive: null, grants: [], driveUnavailable: true };
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const kbId = params.kbId;
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  switch (intent) {
    case "upload": {
      const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
      const file = files[0];
      if (!file) {
        return { uploadErrorKey: "errors.chooseFile", uploadErrorDetail: "" };
      }
      // Up-methods phase 16: several photos the learner said belong together
      // are one document; otherwise each file is its own, one request each,
      // so each failure is reported with its own name.
      if (files.length > 1 && form.get("one_document") === "true") {
        const result = await uploadPhotos(user.id, kbId, files);
        if (result.status >= 400) {
          const reason = driveReason(result.code);
          return {
            uploadErrorKey: "errors.uploadFailed",
            uploadErrorDetail: result.error ?? "",
            ...(reason ? { driveReason: reason } : {}),
          };
        }
        return { uploaded: file.name };
      }
      if (files.length > 1) {
        const failed: string[] = [];
        let reason: ReturnType<typeof driveReason> = null;
        for (const one of files) {
          const result = await uploadDocument(user.id, kbId, one);
          if (result.status >= 400) failed.push(result.error ? `${one.name}: ${result.error}` : one.name);
          reason ??= driveReason(result.code);
        }
        if (failed.length > 0) {
          return {
            uploadErrorKey: "errors.uploadFailed",
            uploadErrorDetail: failed.join("; "),
            ...(reason ? { driveReason: reason } : {}),
          };
        }
        return { uploaded: file.name };
      }
      const result = await uploadDocument(user.id, kbId, file);
      // Branch on the STATUS, not on whether a message came back. The API's
      // body is parsed with `.catch(() => ({}))`, so any non-JSON failure — a
      // 413 from a proxy, a 502 HTML page, an empty 500 — produced no message,
      // fell through this check, and reported a silent success with no new
      // row. The copy promises "up to 50 MB", which makes 413 the single most
      // likely failure on this surface.
      if (result.status >= 400) {
        const reason = driveReason(result.code);
        return {
          uploadErrorKey: "errors.uploadFailed",
          uploadErrorDetail: result.error ? `${file.name}: ${result.error}` : file.name,
          // Kept in the learner's Google Drive, which refused the file
          // (drive-user-storage phase 3): the dropzone says why.
          ...(reason ? { driveReason: reason } : {}),
        };
      }
      return { uploaded: file.name };
    }

    case "add-link": {
      const url = String(form.get("url") ?? "").trim();
      if (!url) return { linkErrorKey: "errors.linkFailed", linkErrorDetail: "" };
      try {
        const { document, feed } = await addLink(user.id, kbId, url, form.get("auto_sync") === "on");
        if (feed) return { feedAdded: { id: feed.id, title: feed.title || feed.url, entries: feed.entries } };
        if (!document) return { linkErrorKey: "errors.linkFailed", linkErrorDetail: "" };
        return { linkAdded: { title: document.title, needsTranscript: document.status === "needs_transcript" } };
      } catch (error) {
        // A page or video kept in the learner's Google Drive, which refused
        // it (drive-user-storage phase 5): the form says why.
        const reason = error instanceof ApiError ? driveReason(error.code) : null;
        return {
          linkErrorKey: "errors.linkFailed",
          linkErrorDetail: error instanceof ApiError ? error.message : "",
          ...(reason ? { driveReason: reason } : {}),
        };
      }
    }

    case "auto-sync":
    case "resync": {
      const documentId = String(form.get("documentId") ?? "");
      if (!documentId) return null;
      try {
        if (intent === "auto-sync") {
          await setAutoSync(user.id, documentId, form.get("auto_sync") === "on");
          return null;
        }
        const { changed } = await resyncDocument(user.id, documentId);
        return { resynced: { changed } };
      } catch (error) {
        return { syncErrorKey: "errors.syncFailed", syncErrorDetail: error instanceof ApiError ? error.message : "" };
      }
    }

    case "delete-document": {
      const documentId = String(form.get("documentId") ?? "");
      if (!documentId) return null;
      try {
        await deleteDocument(user.id, kbId, documentId);
      } catch (error) {
        // A 404 here means it is already gone, which is the outcome the user
        // asked for; reporting it as a failure would be a lie.
        if (error instanceof ApiError && error.status === 404) return null;
        return actionFailure("errors.deleteFailed", error);
      }
      return null;
    }

    case "retry-document": {
      const documentId = String(form.get("documentId") ?? "");
      if (!documentId) return null;
      try {
        await retryDocument(user.id, documentId);
      } catch (error) {
        return actionFailure("errors.retryFailed", error);
      }
      return null;
    }

    case "reindex": {
      try {
        await reindexKB(user.id, kbId);
      } catch (error) {
        // Not left to the error boundary. A 429 from the embedding provider is
        // the likeliest failure on this route, and an unhandled throw unmounts
        // the whole knowledge base — losing the document list — to report
        // something that belongs beside one button.
        return actionFailure("errors.reindexFailed", error);
      }
      return null;
    }

    case "delete-kb": {
      try {
        await deleteKB(user.id, kbId);
      } catch (error) {
        return actionFailure("errors.deleteKbFailed", error);
      }
      // A redirect, because this route's own resource no longer exists.
      throw new Response(null, { status: 302, headers: { Location: "/knowledge" } });
    }

    case "drive-import": {
      const picked = parsePicked(String(form.get("picked") ?? ""));
      if (!picked) return { driveErrorKey: "drive.errors.badSelection", driveErrorDetail: "" };
      try {
        return { driveReport: await importFromDrive(user.id, kbId, picked) };
      } catch (error) {
        return driveFailure("drive.errors.importFailed", error);
      }
    }

    case "drive-sync": {
      try {
        return { syncReport: await syncDrive(user.id) };
      } catch (error) {
        return driveFailure("drive.errors.syncFailed", error);
      }
    }

    case "query": {
      const query = String(form.get("query") ?? "").trim();
      if (!query) return { queryErrorKey: "errors.emptyQuery", queryErrorDetail: "" };
      try {
        const { hits } = await queryKB(user.id, kbId, query);
        return { hits };
      } catch (error) {
        return {
          queryErrorKey: "errors.queryFailed",
          queryErrorDetail: error instanceof ApiError ? error.message : "",
        };
      }
    }
  }
  return null;
}

/**
 * actionFailure returns an i18n KEY plus, when the API supplied one, its own
 * sentence.
 *
 * The API writes its messages for a person and keeps internals out of them
 * (kbapi.fail logs the cause and returns a sentence), so passing one through is
 * safe — but it is English from a Go binary and no locale can translate it. The
 * key is what a second locale renders; the detail is the specific reason.
 */
function actionFailure(key: string, error: unknown) {
  return {
    actionErrorKey: key,
    actionErrorDetail: error instanceof ApiError ? error.message : "",
  };
}

/**
 * driveFailure is actionFailure for the Drive controls, with the two refusals
 * that have their own sentence: a connection Google stopped honouring, and no
 * connection at all. Both tell the user what to press next.
 */
function driveFailure(key: string, error: unknown) {
  // The learner's own storage Drive refused the copy (drive-user-storage
  // phase 5): its reason, with what to do.
  const reason = error instanceof ApiError ? driveReason(error.code) : null;
  if (reason) return { driveErrorKey: key, driveErrorDetail: "", driveReason: reason };
  if (error instanceof ApiError && error.code === "needs_reconnect") {
    return { driveErrorKey: "drive.errors.reconnect", driveErrorDetail: "" };
  }
  if (error instanceof ApiError && error.code === "not_connected") {
    return { driveErrorKey: "drive.errors.notConnected", driveErrorDetail: "" };
  }
  return { driveErrorKey: key, driveErrorDetail: error instanceof ApiError ? error.message : "" };
}

export default function KnowledgeDetail({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("knowledge");
  const { kb, documents, drive, grants, driveUnavailable } = loaderData;
  const [searchParams] = useSearchParams();
  const driveNotice = parseDriveNotice(searchParams.get("drive"));
  // `?add=highlights` (the knowledge list's "Import highlights") opens that tab.
  const addTab = searchParams.get("add") ?? undefined;
  const revalidator = useRevalidator();
  const reindexFetcher = useFetcher();

  const working = isWorking(documents);
  const ready = documents.filter((d) => d.status === "ready").length;

  const refresh = useCallback(() => {
    if (revalidator.state === "idle") revalidator.revalidate();
  }, [revalidator]);

  // The stream: one frame per status change, each a cue to revalidate.
  const { status } = useEventStream({
    url: `/app/api/stream/kb/${kb.id}`,
    events: KB_EVENTS,
    onFrame: refresh,
  });

  // The fallback: poll only while the stream is down AND something is still
  // working, so a dropped connection cannot leave a row at "Reading".
  const streamDown = status === "error";
  useEffect(() => {
    if (!working || !streamDown) return;
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [working, streamDown, refresh]);

  const h3 = "mt-8 text-xl leading-7 font-semibold first:mt-0";

  return (
    <div>
      <PageHeader title={kb.name} lede={t("detail.lede")} />

      <BookMeta
        label={t("detail.metaLabel")}
        items={[
          { label: documents.length === 0 ? t("card.none") : t("card.documents", { count: documents.length }) },
          { label: t("detail.metaReady", { count: ready }) },
          { label: t("detail.metaBooks", { count: loaderData.books.length }) },
          {
            label: (
              <>
                {t("card.updated")} <DateText iso={kb.updated_at} />
              </>
            ),
          },
          { label: kb.embedding_model ? `${kb.embedding_model} · ${kb.dims}d` : t("detail.notIndexed") },
        ]}
      />

      {kb.needs_reembed ? (
        <Alert variant="warning" role="status" className="mt-6">
          <AlertTitle>{t("detail.needsReembedTitle")}</AlertTitle>
          <p className="mt-1 text-sm leading-6">{t("detail.needsReembedBody")}</p>
        </Alert>
      ) : null}

      <StudyActions kbId={kb.id} ready={ready > 0} />

      <DocSection
        n={1}
        title={t("detail.documents")}
        id="lp-kb-documents"
        aside={
          <reindexFetcher.Form method="post">
            <input type="hidden" name="intent" value="reindex" />
            <Button type="submit" variant="outline" size="sm" disabled={reindexFetcher.state !== "idle"}>
              <RefreshCw aria-hidden="true" />
              {t("detail.reindex")}
            </Button>
          </reindexFetcher.Form>
        }
      >
        <p className="text-sm leading-6 text-muted-foreground">{t("detail.reindexHint")}</p>
        <ActionError data={reindexFetcher.data} />

        <DocumentTable kbId={kb.id} documents={documents} />

        {working ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t("status.live")}
          </p>
        ) : null}
      </DocSection>

      <DocSection n={2} title={t("add.label")} id="lp-kb-add">
        <PanelTabs
          label={t("add.label")}
          initial={addTab}
          tabs={[
            {
              id: "file",
              label: t("add.file"),
              panel: (
                <>
                  <UploadDropzone kbId={kb.id} />
                  {driveNotice ? <DriveNoticeLine notice={driveNotice} /> : null}
                  {drive ? (
                    <DriveGrants kbId={kb.id} picker={drive.picker} status={drive.status} grants={grants} />
                  ) : driveUnavailable ? (
                    <p className="mt-6 text-sm leading-6 text-muted-foreground">{t("drive.unavailable")}</p>
                  ) : null}
                </>
              ),
            },
            {
              id: "link",
              label: t("add.link"),
              panel: (
                <>
                  <AddLink kbId={kb.id} />
                  <section aria-labelledby="lp-kb-feeds" className="mt-8">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 id="lp-kb-feeds" className="text-xl leading-7 font-semibold">
                        {t("feed.label")}
                      </h3>
                      {loaderData.feeds && loaderData.feeds.new > 0 ? (
                        <Badge type="tip">{t("feed.kbNew", { count: loaderData.feeds.new })}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-3">
                      {loaderData.feeds ? (
                        <FeedPanel feeds={loaderData.feeds.feeds} />
                      ) : (
                        <p className="text-sm leading-6 text-muted-foreground">{t("feed.unavailable")}</p>
                      )}
                    </div>
                  </section>
                </>
              ),
            },
            { id: "zotero", label: t("add.zotero"), panel: <ZoteroPanel kbId={kb.id} /> },
            {
              id: "highlights",
              label: t("add.highlights"),
              panel: <ImportHighlights titles={documents.map((d) => d.title)} />,
            },
            {
              id: "site",
              label: t("add.siteRepo"),
              panel: loaderData.sources ? (
                <>
                  <h3 className={h3}>{t("site.label")}</h3>
                  <div className="mt-3">
                    <AddSite kbId={kb.id} limits={loaderData.sources.limits} />
                  </div>
                  <h3 className={h3}>{t("repo.label")}</h3>
                  <div className="mt-3">
                    <AddRepo kbId={kb.id} defaults={loaderData.sources.defaults} />
                  </div>
                  <h3 className={h3}>{t("sources.label")}</h3>
                  <div className="mt-3">
                    <KbSources sites={loaderData.sources.sites} repos={loaderData.sources.repos} />
                  </div>
                </>
              ) : (
                <p className="text-sm leading-6 text-muted-foreground">{t("sources.unavailable")}</p>
              ),
            },
          ]}
        />
      </DocSection>

      <KbBooks n={3} kbId={kb.id} books={loaderData.books} />

      <AudioOverviews n={4} overviews={loaderData.overviews} kbId={kb.id} />

      <RelatedPapers n={5} kbId={kb.id} />

      <RetrievalDebug kbId={kb.id} blocked={kb.needs_reembed} />

      <DeleteKnowledgeBase name={kb.name} />
    </div>
  );
}

/**
 * "At a glance": the ways to study from this knowledge base, at the top of
 * it, as up opens a chapter with a short list. Before, the page was all
 * intake and upkeep, and asking a question about these documents meant
 * leaving for Chat and finding them again there.
 */
function StudyActions({ kbId, ready }: { kbId: string; ready: boolean }) {
  const { t } = useTranslation("knowledge");
  if (!ready) {
    return (
      <Prose>
        <AtAGlance items={[t("study.waiting")]} title={t("study.label")} id="lp-kb-study" />
      </Prose>
    );
  }
  return (
    <Prose>
      <AtAGlance
        title={t("study.label")}
        id="lp-kb-study"
        items={[
          // Starting a chat is a POST (it creates the session), so this item
          // is a form whose button reads as the list's other links.
          <Form key="chat" method="post" action="/chat" className="inline">
            <input type="hidden" name="kb_id" value={kbId} />
            <button
              type="submit"
              className="cursor-pointer font-medium text-primary underline underline-offset-2 hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              {t("study.chat")}
            </button>
            {NOTE_JOIN}
            {t("study.chatNote")}
          </Form>,
          <span key="quiz">
            <Link to={`/quiz?kb=${kbId}#lp-quiz-generate`}>{t("study.quiz")}</Link>
            {NOTE_JOIN}
            {t("study.quizNote")}
          </span>,
          <span key="path">
            <Link to={`/mastery?kb=${kbId}#lp-mastery-new`}>{t("study.path")}</Link>
            {NOTE_JOIN}
            {t("study.pathNote")}
          </span>,
          <span key="book">
            <a href="#lp-kb-books">{t("study.book")}</a>
            {NOTE_JOIN}
            {t("study.bookNote")}
          </span>,
        ]}
      />
    </Prose>
  );
}

/**
 * The destructive control: last on the page under "Danger zone", in the
 * danger ink, behind a confirmation dialog (I12) that names what goes.
 */
function DeleteKnowledgeBase({ name }: { name: string }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);

  return (
    <DocSection title={t("detail.danger")} id="lp-kb-danger">
      <p className="text-sm leading-6 text-muted-foreground">{t("detail.dangerNote")}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={fetcher.state !== "idle"}
        onClick={() => setConfirming(true)}
        className="mt-4 border-destructive text-destructive hover:bg-destructive-soft"
      >
        <Trash2 aria-hidden="true" />
        {t("detail.delete")}
      </Button>
      <ActionError data={fetcher.data} />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("detail.deleteTitle", { name })}
        description={t("detail.deleteConfirm")}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {t("detail.keep")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={fetcher.state !== "idle"}
              onClick={() => {
                setConfirming(false);
                void fetcher.submit({ intent: "delete-kb" }, { method: "post" });
              }}
            >
              {t("detail.delete")}
            </Button>
          </>
        }
      />
    </DocSection>
  );
}

/**
 * ActionError renders whatever `actionFailure` returned, beside the control that
 * produced it.
 *
 * Beside the control, and not thrown: an unhandled throw unmounts the whole
 * route through the error boundary, which loses the document list — and the
 * likeliest failure on this screen is a 429 from the embedding provider, which
 * is news about one button, not about the page.
 *
 * The key is translated; the detail is the API's own English sentence, appended
 * only when it sent one. kbapi.fail logs the cause and returns a sentence
 * written for a person, so passing it through is safe — but no locale can
 * translate a string that came out of a Go binary, which is why the key exists
 * at all.
 */
function ActionError({ data }: { data: unknown }) {
  const { t } = useTranslation("knowledge");
  if (!data || typeof data !== "object" || !("actionErrorKey" in data)) return null;

  const { actionErrorKey, actionErrorDetail } = data as {
    actionErrorKey: string;
    actionErrorDetail?: string;
  };
  return (
    <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
      {t(actionErrorKey)}
      {actionErrorDetail ? ` ${actionErrorDetail}` : ""}
    </p>
  );
}
