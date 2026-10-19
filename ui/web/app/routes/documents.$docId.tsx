/**
 * documents.$docId.tsx
 * THE document viewer. Singular, deliberately.
 *
 * Red-team RT-15 found three citation representations and two viewers in the
 * plan's first draft. There is one of each: a citation is a document id plus a
 * page, and it opens this route at `?page=N`, which scrolls to `#page-N`. Phase
 * 8 upgraded what is inside IN PLACE — the route, the anchors and the `?page=`
 * contract are unchanged, so every citation written before keeps resolving.
 *
 * What phase 8 added:
 *  - a PDF renders with pdf.js (canvas + selectable text layer); every other
 *    format, and a PDF whose file cannot be loaded, renders the parsed text;
 *  - a reading workspace per document: progress is saved as you scroll and the
 *    viewer resumes there when no page is asked for;
 *  - selection actions (explain, vocabulary, quiz, translate) start a turn on
 *    the `reading` capability, streamed into the tutor pane on the right;
 *  - highlights, and saving a selection, a highlight or a tutor answer to the
 *    notebook with the page it came from.
 *
 * Learning-depth phase 4 adds videos: a YouTube document renders YouTube's
 * privacy-enhanced player beside its transcript (VideoViewer), and one without
 * a transcript yet renders the ways to give it one (NeedsTranscript). A
 * citation to a video opens at `?t=SECONDS` (or `?page=N`, mapped through the
 * document's timeline).
 *
 * Up-methods phase 2 adds "Practise listening" to a video: its listening
 * audits and fourteen-day experiments, loaded here, started here, and saved
 * through the worksheet's own page. While the audit's scaffold ladder keeps
 * the transcript away, the tutor and the highlights (which quote it) are put
 * away too.
 *
 * Up-methods phase 15 adds uploaded audio and video files: the same viewer,
 * the same three ways to a transcript, with a native player for the
 * recording, and a Cancel while a transcription runs.
 *
 * up-methods phase 5 adds "Read in five passes" to the activity panel: the
 * document's reading evidence worksheet, its current pass, and the barriers
 * marked from the selection toolbar. At pass 4 the text and the tutor are put
 * away while the learner rebuilds it (ReadingPasses).
 *
 * Up-methods phase 16 adds photos: a document read from photos shows each
 * page's photo beside its text (PhotoPages), with the same page anchors.
 *
 * This is a Read surface (DESIGN.md): the 780px measure for the document, and
 * the activity panel carries the tutor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, redirect, useFetcher, useRevalidator, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { Route } from "./+types/documents.$docId";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import {
  cancelTranscription,
  documentContent,
  getDocument,
  setTranscript,
  startTranscription,
  uploadTranscript,
} from "~/lib/kb.server";
import { formatClock, isPhotoMime, isRecording, isTimed, pageStartSeconds, type DocumentView } from "~/lib/kb-types";
import { getMessages, type ChatMessage } from "~/lib/chat.server";
import {
  captureNote,
  createHighlight,
  deleteHighlight,
  drawSelection,
  listHighlights,
  openWorkspace,
  saveProgress,
  startReadingAction,
} from "~/lib/reading.server";
import { READING_ACTIONS, type ReadingAction } from "~/lib/reading-types";
import { findTerms, listWords, saveWord, updateWord } from "~/lib/vocab.server";
import { decisionBody } from "~/lib/vocab-types";
import { ReadAloudBar } from "~/components/vocab/read-aloud";
import { plainText } from "~/lib/speech";
import { readSelection, transcriptPage, type ReaderSelection } from "~/lib/reading-selection";
import { liveTurnID } from "~/lib/turns";
import { useTurnStream, type Source } from "~/hooks/use-turn-stream";
import { ProcessedByBadge } from "~/components/knowledge/processed-by-badge";
import { RightPanel } from "~/components/layout/right-panel";
import { PdfViewer } from "~/components/reading/pdf-viewer";
import { TextPages } from "~/components/reading/text-pages";
import { PhotoPages } from "~/components/reading/photo-pages";
import { SelectionToolbar } from "~/components/reading/selection-toolbar";
import { HighlightsPanel } from "~/components/reading/highlights-panel";
import { TutorPane, type TutorExchange } from "~/components/reading/tutor-pane";
import { VideoViewer } from "~/components/reading/video-viewer";
import { NeedsTranscript } from "~/components/reading/needs-transcript";
import { generateVideoNotes, listVideoNotes } from "~/lib/video-notes.server";
import type { VideoNotes } from "~/lib/video-notes-types";
import { createWorksheet, getWorksheet, listWorksheets, patchWorksheet } from "~/lib/worksheets.server";
import { initialListeningView, type ListeningData } from "~/components/reading/listening-practice";
import {
  findReadingSheet,
  loadReadingPasses,
  markBarrier,
  openReadingSheet,
  type ReadingPassesData,
} from "~/lib/reading-passes.server";
import { BARRIERS, PASSES, closedForRebuild } from "~/lib/reading-passes";
import { ClosedForRebuild, ReadingPasses } from "~/components/reading/reading-passes";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";
import { PageHeader } from "~/components/ui/page-header";

const NO_PASSES: ReadingPassesData = { allowed: false, sheet: null };

/** The tutor lives in the activity panel, so the layout leaves the slot to us. */
export const handle = { ownsPanel: true };

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data?.content ? `${data.content.document.title} · AnyLearn` : "AnyLearn" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);

  let content;
  try {
    // The WHOLE document: the page parameter decides where to scroll, and a
    // reader who lands on a cited page almost always reads around it.
    content = await documentContent(user.id, params.docId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Response("Not found", { status: 404 });
    }
    if (error instanceof ApiError && error.status === 409) {
      // Not parsed yet: the document exists and is the user's, it is simply
      // not finished. Neither a 404 nor an error page. A video may be waiting
      // for its transcript, which is the learner's to give.
      const video: DocumentView | null = await getDocument(user.id, params.docId).catch(() => null);
      return {
        content: null,
        notReady: true as const,
        video: video && isTimed(video.document) ? video : null,
        workspace: null,
        highlights: [],
        messages: [],
        turns: [],
        notes: [] as VideoNotes[],
        listening: undefined,
        passes: NO_PASSES,
      };
    }
    throw error;
  }

  // Idempotent: returns this user's existing workspace for the document.
  const workspace = await openWorkspace(user.id, params.docId);
  const youtube = content.document.source_kind === "youtube";
  const [highlights, history, notes, listening, passes] = await Promise.all([
    listHighlights(user.id, workspace.id).then((r) => r.highlights),
    workspace.session_id
      ? getMessages(user.id, workspace.session_id).catch(() => ({ messages: [] as ChatMessage[], turns: [] }))
      : Promise.resolve({ messages: [] as ChatMessage[], turns: [] }),
    // A video's study notes. Swallowed: the video plays without them.
    isTimed(content.document)
      ? listVideoNotes(user.id, params.docId).catch((): VideoNotes[] => [])
      : Promise.resolve([] as VideoNotes[]),
    // Its listening practice (phase 2). Swallowed too: without it the tab is
    // simply absent.
    youtube || content.document.source_kind === "media"
      ? loadListening(user.id, params.docId).catch(() => undefined)
      : Promise.resolve(undefined),
    // The reading evidence card (up-methods phase 5). Swallowed: the
    // document reads without it.
    loadReadingPasses(user.id, params.docId, content.document.source_kind).catch(() => NO_PASSES),
  ]);

  return {
    content,
    notReady: false as const,
    video: null,
    workspace,
    highlights,
    messages: history.messages,
    turns: history.turns,
    notes,
    listening,
    passes,
  };
}

const LISTENING_AUDIT = "listening_audit";
const LISTENING_EXPERIMENT = "listening_experiment";

/** The video's listening audits and experiments, and the open audit in full. */
async function loadListening(userId: string, docId: string): Promise<ListeningData> {
  const [audits, experiments] = await Promise.all([
    listWorksheets(userId, { kind: LISTENING_AUDIT, documentId: docId }),
    listWorksheets(userId, { kind: LISTENING_EXPERIMENT, documentId: docId }),
  ]);
  const open = audits.find((a) => a.status === "open");
  const audit = open ? await getWorksheet(userId, open.id) : null;
  return { audit, audits, experiments };
}

/** A worksheet's title from the video's: "Listening audit: <title>", at most 200 characters. */
function sheetTitle(prefix: string, title: string): string {
  return `${prefix}: ${title}`.slice(0, 200);
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const page = Math.max(0, Math.floor(Number(form.get("page") ?? 0)) || 0);

  // A video's transcript (phase 4). Before the workspace: the document need
  // not be readable yet, and these name nothing but the document in the URL.
  if (intent === "transcribe" || intent === "transcribe-cancel" || intent.startsWith("transcript-")) {
    try {
      if (intent === "transcribe") {
        // The engine the learner picked (phase 21); none is the Gemini-only page.
        const engine = String(form.get("engine") ?? "");
        const connectionId = String(form.get("connection_id") ?? "");
        // A recording of unknown length, which the learner confirmed (phase 15).
        const confirmed = form.get("confirm_unknown_length") === "on";
        await startTranscription(
          user.id,
          params.docId,
          engine
            ? {
                engine,
                ...(connectionId ? { connection_id: connectionId } : {}),
                ...(confirmed ? { confirm_unknown_length: true } : {}),
              }
            : undefined,
        );
      }
      else if (intent === "transcribe-cancel") await cancelTranscription(user.id, params.docId);
      else if (intent === "transcript-paste")
        await setTranscript(user.id, params.docId, { text: String(form.get("text") ?? "") });
      else if (intent === "transcript-track")
        await setTranscript(user.id, params.docId, { track: String(form.get("track") ?? "") });
      else if (intent === "transcript-upload") {
        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) return { transcriptErrorKey: "errors.chooseSubtitles" };
        const result = await uploadTranscript(user.id, params.docId, file);
        if (result.status >= 400) {
          return { transcriptErrorKey: "errors.transcriptFailed", transcriptErrorDetail: result.error ?? "" };
        }
      }
      return { transcriptAccepted: true };
    } catch (error) {
      return {
        transcriptErrorKey:
          intent === "transcribe"
            ? "errors.transcribeFailed"
            : intent === "transcribe-cancel"
              ? "media.cancelFailed"
              : "errors.transcriptFailed",
        transcriptErrorDetail: error instanceof ApiError ? error.message : "",
      };
    }
  }

  // A video's study notes: one call to the reading model. Names nothing but
  // the document in the URL and a language code.
  if (intent === "study-notes") {
    try {
      await generateVideoNotes(user.id, params.docId, String(form.get("language") ?? ""));
      return { notesMade: true };
    } catch (error) {
      return { notesErrorDetail: error instanceof ApiError ? error.message : "" };
    }
  }

  // Listening practice on a video (phase 2): one open audit per video, so a
  // second start opens the first; an experiment opens on its own page. The
  // document is the URL's; the API resolves it with the caller's id and
  // refuses a document that is not a video.
  if (intent === "listening-start" || intent === "experiment-start") {
    try {
      const view = await getDocument(user.id, params.docId);
      if (intent === "listening-start") {
        const open = (await listWorksheets(user.id, { kind: LISTENING_AUDIT, documentId: params.docId })).find(
          (a) => a.status === "open",
        );
        if (!open) {
          await createWorksheet(user.id, {
            kind: LISTENING_AUDIT,
            title: sheetTitle("Listening audit", view.document.title),
            document_id: params.docId,
          });
        }
        return { listeningStarted: true };
      }
      const made = await createWorksheet(user.id, {
        kind: LISTENING_EXPERIMENT,
        title: sheetTitle("14-day listening experiment", view.document.title),
        document_id: params.docId,
      });
      return redirect(`/toolkit/${made.id}`);
    } catch (error) {
      return { errorKey: "errors.generic", errorDetail: error instanceof ApiError ? error.message : "" };
    }
  }

  // The reading evidence card (up-methods phase 5). Its worksheet is found
  // from the document the URL names, never from a posted id.
  if (intent === "passes-start" || intent === "barrier" || intent === "passes-save") {
    try {
      if (intent === "passes-start") {
        await openReadingSheet(user.id, params.docId);
        return { passesOpened: true };
      }
      if (intent === "barrier") {
        const selection = String(form.get("selection") ?? "");
        if (!selection.trim()) return { passesErrorKey: "passes.failed" };
        await markBarrier(user.id, params.docId, selection, page);
        return { barrierMarked: true };
      }
      const section = String(form.get("section") ?? "");
      const at = section === PASSES.section ? PASSES : section === BARRIERS.section ? BARRIERS : null;
      const sheet = at ? await findReadingSheet(user.id, params.docId) : undefined;
      if (!at || !sheet) return { passesErrorKey: "passes.failed" };
      let rows: unknown;
      try {
        rows = JSON.parse(String(form.get("rows") ?? ""));
      } catch {
        return { passesErrorKey: "passes.failed" };
      }
      await patchWorksheet(user.id, sheet.id, {
        revision: String(form.get("revision") ?? ""),
        answers: { [at.section]: { [at.field]: rows } },
      });
      return { passesSaved: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.code === "stale") {
        return { passesErrorKey: "passes.stale" };
      }
      return { passesErrorKey: "passes.failed", passesErrorDetail: error instanceof ApiError ? error.message : "" };
    }
  }

  // The workspace is resolved from the document the URL names, never from a
  // form field: a posted workspace id would be one more thing to authorize.
  const workspace = await openWorkspace(user.id, params.docId);

  try {
    switch (intent) {
      case "action": {
        const act = String(form.get("action") ?? "") as ReadingAction;
        if (!READING_ACTIONS.includes(act)) return { errorKey: "errors.actionFailed" };
        const rawAt = form.get("at");
        const at = rawAt === null || rawAt === "" ? undefined : Math.max(0, Math.floor(Number(rawAt)) || 0);
        const started = await startReadingAction(user.id, workspace.id, {
          action: act,
          selection: String(form.get("selection") ?? ""),
          page,
          ...(at !== undefined ? { at } : {}),
        });
        return { turnId: started.turn_id, sessionId: started.session_id };
      }
      case "diagram":
        await drawSelection(user.id, workspace.id, String(form.get("selection") ?? ""));
        return { drawn: true };
      case "highlight":
        await createHighlight(user.id, workspace.id, { page, text: String(form.get("text") ?? "") });
        return { highlighted: true };
      case "delete-highlight":
        await deleteHighlight(user.id, String(form.get("highlightId") ?? ""));
        return { removed: true };
      case "capture":
        await captureNote(user.id, workspace.id, {
          title: String(form.get("title") ?? "") || undefined,
          body_md: String(form.get("body_md") ?? ""),
          page,
          from: form.get("from") === "tutor" ? "tutor" : undefined,
          highlight_id: String(form.get("highlight_id") ?? "") || undefined,
        });
        return { saved: true };
      case "progress":
        await saveProgress(user.id, workspace.id, page, Number(form.get("percent") ?? 0) || 0);
        return { progressed: true };
      // Learning depth, phase 7: the vocabulary answer's words, and saving one.
      case "terms": {
        const found = await findTerms(user.id, workspace.id, { selection: String(form.get("selection") ?? ""), page });
        // up-methods phase 3: what the learner already decided about these
        // terms, so the picker offers a change instead of a second save.
        const existing = found.terms.length
          ? (await listWords(user.id, { terms: found.terms.map((x) => x.term).slice(0, 50) })).notes
          : [];
        return { terms: found.terms, lang: found.lang, existing };
      }
      case "save-word": {
        const decided = decisionBody(form);
        const saved = await saveWord(user.id, {
          workspace_id: workspace.id,
          page,
          selection: String(form.get("selection") ?? ""),
          term: String(form.get("term") ?? ""),
          meaning: String(form.get("meaning") ?? ""),
          pos: String(form.get("pos") ?? "") || undefined,
          lang: String(form.get("lang") ?? "") || undefined,
          ...(decided ? { decision: decided.decision, record: decided.record, task_impact: decided.task_impact } : {}),
        });
        return { savedWord: true, created: saved.created, note: saved.note, week: saved.week };
      }
      // A decision changes through PATCH; saving the term again would only
      // add the sentence (up-methods phase 3).
      case "decide-word": {
        const decided = decisionBody(form);
        if (!decided) return { errorKey: "errors.generic" };
        const { week, ...note } = await updateWord(user.id, String(form.get("id") ?? ""), decided);
        return { savedWord: true, changed: true, note, week };
      }
    }
  } catch (error) {
    const key =
      intent === "action" || intent === "diagram" ? "errors.actionFailed" : intent === "capture" ? "errors.saveFailed" : "errors.generic";
    return { errorKey: key, errorDetail: error instanceof ApiError ? error.message : "" };
  }
  return null;
}

/** Pairs each stored reading question with the answer that followed it. */
function storedExchanges(messages: ChatMessage[]): TutorExchange[] {
  const out: TutorExchange[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const next = messages[i + 1];
    const answer = next && next.role === "assistant" ? next : null;
    out.push({
      id: m.id,
      question: m.content,
      answer: answer?.content ?? "",
      sources: (answer?.attachments?.sources ?? []) as Source[],
      page: transcriptPage(m.content),
      answerId: answer?.id,
      answerCapability: answer?.capability,
    });
  }
  return out;
}

type ActionData = { turnId?: string; sessionId?: string; errorKey?: string; errorDetail?: string } | null;
type PassesData = { barrierMarked?: boolean; passesErrorKey?: string; passesErrorDetail?: string } | null;

export default function DocumentViewer({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("knowledge");
  const { t: tr } = useTranslation("reading");
  const { t: tl } = useTranslation("listening");
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const actionFetcher = useFetcher<ActionData>();
  const toolFetcher = useFetcher<ActionData>();
  const progressFetcher = useFetcher();
  const passesFetcher = useFetcher<PassesData>();

  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  // Why the original would not load, when it is kept in the learner's Drive
  // (drive-user-storage phase 3). The parsed text is shown either way.
  const [fileReason, checkFileReason] = useDriveReason();
  // Learning depth, phase 7: the text being read aloud, if any.
  const [aloud, setAloud] = useState<string | null>(null);
  // Up-methods phase 2: the listening ladder has put the transcript away, and
  // the tutor with it. From the stored answers first, so nothing flashes.
  const [tutorHidden, setTutorHidden] = useState(() => initialListeningView(loaderData.listening).hidden !== null);

  // A turn that was still running when the page loaded is re-attached to.
  const [turnId, setTurnId] = useState<string | null>(() => liveTurnID(loaderData.turns));
  const [pending, setPending] = useState<{ question: string; page: number } | null>(null);
  const stream = useTurnStream(turnId);

  const requestedPage = Number(searchParams.get("page") ?? "");
  const citedPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 0;
  const startPage = citedPage || loaderData.workspace?.progress.page || 0;

  // A video's starting moment: the cited second, else the cited or resumed
  // page's start on the timeline.
  const requestedSeconds = Number(searchParams.get("t") ?? "");
  const loadedDoc = loaderData.content?.document;
  const startSeconds =
    Number.isFinite(requestedSeconds) && requestedSeconds >= 0 && searchParams.get("t") !== null
      ? Math.floor(requestedSeconds)
      : (loadedDoc && startPage > 0 ? pageStartSeconds(loadedDoc, startPage) : undefined) ?? 0;

  // A video being transcribed or indexed: poll until it is ready. The page
  // has no stream for one document, and the job takes minutes.
  const videoStatus = loaderData.video?.document.status;
  const videoWorking = videoStatus === "queued" || videoStatus === "parsing" || videoStatus === "indexing";
  useEffect(() => {
    if (!videoWorking) return;
    const id = window.setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 4000);
    return () => window.clearInterval(id);
  }, [videoWorking, revalidator]);

  useEffect(() => {
    const data = actionFetcher.data;
    if (data?.turnId) setTurnId(data.turnId);
  }, [actionFetcher.data]);

  // A finished turn is replaced by the stored transcript.
  useEffect(() => {
    if (!stream.finished || !turnId) return;
    setTurnId(null);
    setPending(null);
    revalidator.revalidate();
  }, [stream.finished, turnId, revalidator]);

  // Selection tracking. Pointer and key UP, not selectionchange: the toolbar
  // should appear once a selection is made, not flicker on every character.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => setSelection(readSelection(root, window.getSelection()));
    root.addEventListener("pointerup", update);
    root.addEventListener("keyup", update);
    return () => {
      root.removeEventListener("pointerup", update);
      root.removeEventListener("keyup", update);
    };
  }, [loaderData.content]);

  // Scroll to the cited or resumed page for the TEXT renderer; the PDF viewer
  // does the same once its pages exist.
  const isPdf = loaderData.content?.document.mime === "application/pdf" && !pdfFailed;
  useEffect(() => {
    if (isPdf || startPage < 1) return;
    const target = document.getElementById(`page-${startPage}`);
    if (!target) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [isPdf, startPage]);

  // Progress: the most visible page, saved at most every few seconds.
  const lastSaved = useRef({ page: loaderData.workspace?.progress.page ?? 0, at: 0 });
  const reportPage = useCallback(
    (page: number, total: number) => {
      const now = Date.now();
      if (page === lastSaved.current.page || now - lastSaved.current.at < 4000) return;
      lastSaved.current = { page, at: now };
      progressFetcher.submit(
        { intent: "progress", page: String(page), percent: String(total > 0 ? Math.round((page / total) * 100) : 0) },
        { method: "post" },
      );
    },
    [progressFetcher],
  );

  // The text renderer's pages already exist, so it is tracked here.
  useEffect(() => {
    const root = rootRef.current;
    if (isPdf || !root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section[data-page]"));
    const total = sections.length;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.find((e) => e.isIntersecting);
        if (top) reportPage(Number((top.target as HTMLElement).dataset.page), total);
      },
      { threshold: 0.5 },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [isPdf, loaderData.content, reportPage]);

  const exchanges = useMemo(() => {
    const list = storedExchanges(loaderData.messages);
    if (pending) {
      list.push({
        id: "live",
        question: pending.question,
        answer: stream.answer,
        sources: stream.sources,
        page: pending.page,
        streaming: !stream.finished,
      });
    }
    return list;
  }, [loaderData.messages, pending, stream.answer, stream.sources, stream.finished]);

  if (loaderData.notReady || !loaderData.content) {
    const video = loaderData.video;
    return (
      <div className="lp-measure">
        {video ? (
          <>
            <Link
              to={`/knowledge/${video.document.kb_id}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t("viewer.back")}
            </Link>
            <PageHeader title={video.document.title} className="mt-2 mb-0" />
          </>
        ) : null}
        <div className="mt-6">
          {video && !videoWorking ? (
            <NeedsTranscript view={video} />
          ) : (
            <>
              <p role="status" className="text-sm leading-prose text-muted-foreground">
                {video ? t("video.needs.working") : t("viewer.notReady")}
                {typeof video?.transcribe?.queue_ahead === "number"
                  ? ` ${t("engines.queueAhead", { count: video.transcribe.queue_ahead })}`
                  : null}
              </p>
              {video && videoStatus === "parsing" ? <CancelTranscription /> : null}
            </>
          )}
        </div>
      </div>
    );
  }

  const { document: doc, pages } = loaderData.content;
  const isVideo = (doc.source_kind === "youtube" && Boolean(doc.media_id)) || isRecording(doc);
  // Five passes (up-methods phase 5): where the card attaches, and pass 4's
  // rule — the text and the tutor are put away while the learner rebuilds.
  const passesOn = loaderData.passes.allowed && !isVideo;
  const closed = passesOn && closedForRebuild(loaderData.passes.sheet);
  const passesBusy = passesFetcher.state !== "idle";
  const passesError = passesFetcher.data?.passesErrorKey
    ? `${tr(passesFetcher.data.passesErrorKey)}${passesFetcher.data.passesErrorDetail ? ` ${passesFetcher.data.passesErrorDetail}` : ""}`
    : null;
  const busy = actionFetcher.state !== "idle" || (turnId !== null && !stream.finished);

  const runAction = (act: ReadingAction) => {
    if (!selection) return;
    // Shaped like the transcript line readingapi stores, so the question does
    // not change wording when the stored transcript replaces it.
    const head = `${tr(`actionLabels.${act}`)}${selection.page > 0 ? ` (page ${selection.page})` : ""}`;
    setPending({ question: `${head}:\n\n> ${selection.text}`, page: selection.page });
    actionFetcher.submit(
      { intent: "action", action: act, selection: selection.text, page: String(selection.page) },
      { method: "post" },
    );
  };
  // A video's tutor is asked about a moment, not a selection: the server
  // builds the window around `at` from the stored transcript.
  const askAboutMoment = (act: ReadingAction, moment: { at: number; page: number; text: string }) => {
    const head = `${tr(`actionLabels.${act}`)} (at ${formatClock(moment.at)})`;
    setPending({ question: `${head}:\n\n> ${moment.text}`, page: moment.page });
    actionFetcher.submit(
      { intent: "action", action: act, selection: moment.text, page: String(moment.page), at: String(moment.at) },
      { method: "post" },
    );
  };
  const dismiss = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const failure =
    stream.failure?.message ??
    (actionFetcher.data?.errorKey
      ? `${tr(actionFetcher.data.errorKey)}${actionFetcher.data.errorDetail ? ` ${actionFetcher.data.errorDetail}` : ""}`
      : null);

  return (
    <div className="-mx-4 -my-6 flex min-h-0 flex-1 flex-col lg:-mx-8 lg:-my-8 lg:min-h-[calc(100%+4rem)] lg:flex-row">
      <div className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <div className="lp-measure">
          <Link
            to={`/knowledge/${doc.kb_id}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("viewer.back")}
          </Link>

          <header className="lp-page-enter mt-2">
            <h1 className="text-3xl leading-tight break-words lg:text-4xl">{doc.title}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <span>
                {t("viewer.pages")}: {doc.page_count}
              </span>
              <ProcessedByBadge processedBy={doc.processed_by} />
            </div>
            <p className="mt-2 text-xs leading-snug text-muted-foreground">
              {isVideo ? tr("videoHint") : tr("hint")}
            </p>
            {isPhotoMime(doc.mime) ? (
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{t("photos.viewerHint")}</p>
            ) : null}
            {pdfFailed && fileReason ? (
              <DriveFileNotice reason={fileReason} className="mt-2" />
            ) : pdfFailed ? (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                {tr("pdfFallback")}
              </p>
            ) : null}
          </header>

          <div ref={rootRef} className="mt-8">
            {closed ? (
              <ClosedForRebuild />
            ) : isVideo ? (
              <>
                <VideoViewer
                  document={doc}
                  pages={pages}
                  notes={loaderData.notes}
                  initialSeconds={startSeconds}
                  busy={busy}
                  onAsk={askAboutMoment}
                  onMoment={reportPage}
                  listening={loaderData.listening}
                  initialTab={searchParams.get("view") === "listening" ? "listening" : undefined}
                  onTranscriptHidden={setTutorHidden}
                />
                <details className="mt-8 border-t pt-4">
                  <summary className="min-h-11 cursor-pointer text-sm text-muted-foreground">
                    {t("video.replace")}
                  </summary>
                  <div className="mt-4">
                    <NeedsTranscript view={{ document: doc }} replacing />
                  </div>
                </details>
              </>
            ) : isPdf ? (
              <PdfViewer
                url={`/documents/${doc.id}/file`}
                initialPage={startPage}
                onVisiblePage={reportPage}
                onFailed={() => {
                  setPdfFailed(true);
                  checkFileReason(`/documents/${doc.id}/file`);
                }}
                label={doc.title}
              />
            ) : isPhotoMime(doc.mime) ? (
              <PhotoPages
                docId={doc.id}
                pages={pages}
                onReadPage={(markdown) => setAloud(plainText(markdown))}
                readPageLabel={tr("actions.readPage")}
              />
            ) : (
              <TextPages pages={pages} onReadPage={(markdown) => setAloud(plainText(markdown))} readPageLabel={tr("actions.readPage")} />
            )}
          </div>
        </div>
      </div>

      <RightPanel title={passesOn ? tr("passes.panel") : tr("tutor.title")}>
        {isVideo && tutorHidden ? (
          <p role="status" className="text-sm leading-prose text-muted-foreground">
            {tl("tutorHidden")}
          </p>
        ) : (
          <>
            {passesOn ? (
              <ReadingPasses
                sheet={loaderData.passes.sheet}
                busy={passesBusy}
                error={passesError}
                askLayer={passesFetcher.state === "idle" && passesFetcher.data?.barrierMarked === true}
                onStart={() => passesFetcher.submit({ intent: "passes-start" }, { method: "post" })}
                onSave={(section, rows, revision) =>
                  passesFetcher.submit(
                    { intent: "passes-save", section, rows: JSON.stringify(rows), revision },
                    { method: "post" },
                  )
                }
              />
            ) : null}
            {closed ? null : passesOn ? (
              <section aria-labelledby="lp-tutor">
                <h2 id="lp-tutor" className="lp-section">
                  {tr("tutor.title")}
                </h2>
                <TutorPane exchanges={exchanges} failure={failure} sessionId={loaderData.workspace?.session_id} />
              </section>
            ) : (
              <TutorPane exchanges={exchanges} failure={failure} sessionId={loaderData.workspace?.session_id} />
            )}
            {closed ? null : <HighlightsPanel highlights={loaderData.highlights} />}
          </>
        )}
      </RightPanel>

      {selection && !closed ? (
        <SelectionToolbar
          selection={selection}
          busy={busy}
          onAction={(act) => {
            runAction(act);
            dismiss();
          }}
          onHighlight={() => {
            toolFetcher.submit(
              { intent: "highlight", text: selection.text, page: String(selection.page) },
              { method: "post" },
            );
            dismiss();
          }}
          onSave={() => {
            toolFetcher.submit(
              { intent: "capture", body_md: `> ${selection.text}`, page: String(selection.page) },
              { method: "post" },
            );
            dismiss();
          }}
          onDraw={() => {
            actionFetcher.submit({ intent: "diagram", selection: selection.text }, { method: "post" });
            dismiss();
          }}
          onDismiss={dismiss}
          onReadAloud={() => {
            setAloud(selection.text);
            dismiss();
          }}
          onMarkBarrier={
            passesOn
              ? () => {
                  passesFetcher.submit(
                    { intent: "barrier", selection: selection.text, page: String(selection.page) },
                    { method: "post" },
                  );
                  dismiss();
                }
              : undefined
          }
        />
      ) : null}

      {aloud && !selection && !closed ? <ReadAloudBar text={aloud} onClose={() => setAloud(null)} /> : null}

      {toolFetcher.data?.errorKey ? (
        <p role="alert" className="sr-only">
          {tr(toolFetcher.data.errorKey)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Stop a transcription after the window in flight (up-methods phase 15). The
 * windows not yet heard are not billed; the page then offers the three ways
 * to a transcript again.
 */
function CancelTranscription() {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher<{ transcriptErrorKey?: string; transcriptErrorDetail?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <fetcher.Form method="post" className="mt-3">
      <input type="hidden" name="intent" value="transcribe-cancel" />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 items-center rounded-md border border-control-border bg-card px-3 text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
      >
        {busy ? t("media.cancelling") : t("media.cancel")}
      </button>
      <p className="mt-1 text-xs text-muted-foreground">{t("media.cancelHint")}</p>
      {fetcher.data?.transcriptErrorKey ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t(fetcher.data.transcriptErrorKey)}
          {fetcher.data.transcriptErrorDetail ? ` ${fetcher.data.transcriptErrorDetail}` : ""}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
