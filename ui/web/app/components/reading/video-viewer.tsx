import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import {
  embedURL,
  formatClock,
  isRecording,
  pageAtSeconds,
  transcriptText,
  type DocumentPage,
  type KBDocument,
} from "~/lib/kb-types";
import { READING_ACTIONS, type ReadingAction } from "~/lib/reading-types";
import type { VideoNotes } from "~/lib/video-notes-types";
import { providerName } from "~/lib/provider-names";
import { TextPages } from "./text-pages";
import { StudyNotes } from "./study-notes";
import { whisperLabel } from "./engine-picker";
import { initialListeningView, ListeningPractice, type ListeningData } from "./listening-practice";
import type { ListeningView } from "~/lib/ladder";
import { MediaPlayer, type MediaHandle } from "./media-player";

/**
 * video-viewer.tsx
 * A YouTube video document (learning-depth phase 4): YouTube's own
 * privacy-enhanced player beside the transcript, and the tutor asked about
 * the moment the learner chose.
 *
 * The player is a PLAIN iframe on www.youtube-nocookie.com: no IFrame API and
 * no YouTube script in this origin, so the CSP changes only `frame-src`.
 * Without the API the page cannot read the playhead, so the learner's moment
 * is the transcript line they chose; choosing one seeks by resetting the
 * frame's `src` with `start=`.
 *
 * Transcript lines are text. They came from a stranger's captions, a model's
 * hearing, or a paste, and React escapes them on render.
 *
 * Beside the transcript, the video's study notes (StudyNotes): sections with a
 * summary and key points, each time a seek. The creator's chapters, when the
 * description has them, head the transcript's lines, and the description
 * itself is shown as plain text.
 *
 * Up-methods phase 2 adds "Practise listening": the video's listening audit
 * (ListeningPractice). Its scaffold ladder decides what is on screen: at
 * stages 1, 2 and 5 the Transcript and Study notes tabs are gone (on a video
 * whose transcript has no times, and so no tabs, the transcript section is),
 * along with the questions about a moment, which go to the tutor. The page
 * hides the tutor itself (onTranscriptHidden).
 *
 * Up-methods phase 15 makes this the media viewer: an uploaded audio or video
 * file plays in a native element (MediaPlayer) instead of the iframe. That
 * element can be read, so seeking sets its `currentTime`, the current line
 * follows the playhead, and "Now" takes the moment actually playing. The
 * transcript, the study notes and the tutor work the same for both.
 */

type Segment = { page: number; start: number; text: string };

type Tab = "transcript" | "notes" | "listening";

/** The transcript as timed lines, from the pages and the document's timeline. */
export function segmentsOf(doc: KBDocument, pages: DocumentPage[] | null): Segment[] {
  const timeline = doc.timeline ?? [];
  return (pages ?? []).flatMap((p) => {
    const span = timeline[p.page - 1];
    if (!span) return [];
    // The stored page starts with its own "[MM:SS] "; the time is shown from
    // the timeline instead, so it cannot disagree with where the seek goes.
    const text = transcriptText(p.markdown).replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, "");
    return [{ page: p.page, start: span[0], text }];
  });
}

export function VideoViewer({
  document: doc,
  pages,
  initialSeconds,
  busy,
  onAsk,
  onMoment,
  notes = [],
  listening,
  initialTab,
  onTranscriptHidden,
}: {
  document: KBDocument;
  pages: DocumentPage[] | null;
  /** The video's study notes, one per language. */
  notes?: VideoNotes[];
  initialSeconds: number;
  busy: boolean;
  /** Ask the tutor about the chosen moment. */
  onAsk: (action: ReadingAction, moment: { at: number; page: number; text: string }) => void;
  /** The learner moved to a page (progress). */
  onMoment?: (page: number, total: number) => void;
  /** The video's listening audits and experiments (up-methods phase 2). */
  listening?: ListeningData;
  /** Open on this tab (`?view=listening` from a worksheet's page). */
  initialTab?: Tab;
  /** The ladder has put the transcript away, or brought it back: the tutor follows. */
  onTranscriptHidden?: (hidden: boolean) => void;
}) {
  const { t } = useTranslation("knowledge");
  const { t: tr } = useTranslation("reading");
  const { t: tl } = useTranslation("listening");
  const segments = useMemo(() => segmentsOf(doc, pages), [doc, pages]);
  const timed = segments.length > 0;

  const initialPage = pageAtSeconds(doc, initialSeconds) ?? segments[0]?.page ?? 1;
  const [current, setCurrent] = useState(initialPage);
  const [src, setSrc] = useState(() => embedURL(doc.media_id ?? "", initialSeconds));
  // "Now" in listening practice. A YouTube frame's playhead cannot be read,
  // so there it is the moment last chosen here; a recording's is followed
  // as it plays.
  const [lastChosen, setLastChosen] = useState(initialSeconds);
  const [playhead, setPlayhead] = useState(initialSeconds);
  // A replayed segment's end on a recording, where playback stops.
  const stopAt = useRef<number | null>(null);
  const [view, setView] = useState<ListeningView>(() => initialListeningView(listening));
  const hidden = view.hidden !== null;
  useEffect(() => onTranscriptHidden?.(hidden), [hidden]);
  const listRef = useRef<HTMLOListElement>(null);
  const recording = isRecording(doc);
  const player = useRef<MediaHandle>(null);
  // The exact second "Now" took from a recording's playhead, until another
  // line is chosen.
  const [moment, setMoment] = useState<number | null>(null);

  // Bring the current line into view in the transcript's own scroller,
  // without moving the page.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`);
    if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
  }, [current]);

  const play = (seconds: number) => {
    stopAt.current = null;
    if (recording) player.current?.seek(seconds, true);
    else setSrc(embedURL(doc.media_id ?? "", seconds, true));
  };
  const seek = (segment: Segment) => {
    setCurrent(segment.page);
    setLastChosen(segment.start);
    setMoment(null);
    play(segment.start);
    onMoment?.(segment.page, segments.length);
  };
  // A time from the notes or a chapter: the player jumps there, and the
  // transcript line that covers it becomes the moment to ask about.
  const seekSeconds = (seconds: number) => {
    const page = pageAtSeconds(doc, seconds);
    if (page) {
      setCurrent(page);
      onMoment?.(page, segments.length);
    }
    setLastChosen(seconds);
    setMoment(null);
    play(seconds);
  };
  // A recording's playhead moved: the line it is in becomes the current one.
  const follow = (seconds: number) => {
    setPlayhead(seconds);
    if (stopAt.current !== null && seconds >= stopAt.current) {
      stopAt.current = null;
      player.current?.pause();
    }
    const page = pageAtSeconds(doc, seconds);
    if (page && page !== current) {
      setCurrent(page);
      setMoment(null);
      onMoment?.(page, segments.length);
    }
  };
  // "Now": the moment playing, read from the element itself.
  const takeNow = () => {
    const at = player.current?.now() ?? 0;
    const page = pageAtSeconds(doc, at);
    if (page) setCurrent(page);
    setMoment(at);
  };
  // A segment replayed on its own: from start, stopping at end.
  const playRange = (start: number, end: number) => {
    setLastChosen(start);
    if (recording) {
      stopAt.current = end;
      player.current?.seek(start, true);
    } else setSrc(embedURL(doc.media_id ?? "", start, true, end));
  };
  const chosen = segments.find((s) => s.page === current) ?? segments[0];
  const ai = doc.transcript_source === "ai_transcript";
  // Who heard it (up-methods phase 21): this server's Whisper, the learner's
  // speech key, or their Gemini key (and any transcript from before phase 21).
  const engine = doc.processed_by?.engine;
  const keys = recording
    ? { builtin: "media.transcriptBuiltin", key: "media.transcriptKey", gemini: "media.transcriptGemini" }
    : { builtin: "engines.transcriptBuiltin", key: "engines.transcriptKey", gemini: "video.aiTranscriptNote" };
  const aiNote =
    engine === "builtin"
      ? t(keys.builtin, { model: whisperLabel(doc.processed_by?.model ?? "") })
      : engine && engine !== "gemini"
        ? t(keys.key, { provider: providerName(t, engine), model: doc.processed_by?.model ?? "" })
        : t(keys.gemini);
  const [chosenTab, setTab] = useState<Tab>(() =>
    initialTab && (initialTab !== "listening" || listening)
      ? initialTab
      : hidden
        ? "listening"
        : notes.length > 0
          ? "notes"
          : "transcript",
  );
  // While the ladder hides the transcript, only "Practise listening" is left.
  const tab: Tab = hidden && view.hidden === "stage" ? "listening" : chosenTab;
  const tabs: Tab[] = view.hidden === "stage" ? ["listening"] : listening ? ["notes", "transcript", "listening"] : ["notes", "transcript"];
  const chapters = doc.media?.chapters ?? [];
  // The chapter that begins at or before each line, shown once, above the
  // first line inside it.
  const chapterBefore = useMemo(() => {
    const out = new Map<number, (typeof chapters)[number]>();
    let next = 0;
    for (const s of segments) {
      let hit: (typeof chapters)[number] | undefined;
      while (next < chapters.length && chapters[next]!.start <= s.start + 0.5) hit = chapters[next++];
      if (hit) out.set(s.page, hit);
    }
    return out;
  }, [segments, chapters]);
  const captionKey =
    doc.transcript_source === "learner"
      ? "video.source.learner"
      : doc.transcript_source === "captions"
        ? doc.media?.auto_captions
          ? "video.source.auto"
          : "video.source.creator"
        : null;

  return (
    <div className="space-y-6">
      {recording ? (
        <MediaPlayer ref={player} document={doc} initialSeconds={initialSeconds} onTime={follow} />
      ) : src ? (
        <div className="aspect-video w-full overflow-hidden rounded-lg border bg-sunken">
          <iframe
            src={src}
            title={t("video.player", { title: doc.title })}
            className="size-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            // No top navigation and no downloads: the player may run its own
            // scripts inside its own origin, and nothing else.
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            loading="lazy"
          />
        </div>
      ) : null}

      {ai ? (
        <p role="note" className="rounded-md border border-warning bg-warning-soft p-3 text-sm leading-snug">
          {aiNote}
        </p>
      ) : null}

      {doc.media?.description ? (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted-foreground">{t("video.description")}</summary>
          <p className="mt-2 whitespace-pre-line break-words leading-prose">{doc.media.description}</p>
        </details>
      ) : null}

      {timed && chosen && !hidden ? (
        <section aria-labelledby="lp-video-ask" className="space-y-2">
          <h2 id="lp-video-ask" className="lp-kicker">
            {t("video.about", { time: formatClock(moment ?? chosen.start) })}
          </h2>
          <div className="flex flex-wrap gap-2">
            {recording ? (
              <button
                type="button"
                onClick={takeNow}
                className="inline-flex min-h-11 items-center rounded-md border border-control-border bg-card px-3 font-mono text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                {t("media.now")}
              </button>
            ) : null}
            {READING_ACTIONS.map((act) => (
              <button
                key={act}
                type="button"
                disabled={busy}
                onClick={() => onAsk(act, { at: moment !== null ? Math.floor(moment) : chosen.start, page: chosen.page, text: chosen.text })}
                className="inline-flex min-h-11 items-center rounded-md border border-control-border bg-card px-3 text-sm transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
              >
                {tr(`actions.${act}`)}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {timed ? (
        <div role="tablist" aria-label={t("video.views")} className="flex gap-1 border-b">
          {tabs.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              id={`lp-video-tab-${v}`}
              aria-selected={tab === v}
              aria-controls={`lp-video-panel-${v}`}
              onClick={() => setTab(v)}
              className="-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3 text-sm transition-colors aria-selected:border-primary aria-selected:font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              {v === "notes" ? t("video.notes.title") : v === "transcript" ? t("video.transcript") : tl("tab")}
            </button>
          ))}
        </div>
      ) : null}

      {timed && tab === "notes" ? (
        <section id="lp-video-panel-notes" role="tabpanel" aria-labelledby="lp-video-tab-notes">
          <StudyNotes document={doc} notes={notes} onSeek={seekSeconds} />
        </section>
      ) : null}

      <section
        id="lp-video-panel-transcript"
        role={timed ? "tabpanel" : undefined}
        aria-labelledby={timed ? "lp-video-tab-transcript" : "lp-video-transcript"}
        hidden={timed ? tab !== "transcript" || hidden : hidden}
      >
        {timed ? null : (
          <h2 id="lp-video-transcript" className="lp-kicker">
            {t("video.transcript")}
          </h2>
        )}
        {captionKey ? <p className="mt-2 text-xs text-muted-foreground">{t(captionKey)}</p> : null}
        {timed ? (
          <ol ref={listRef} className="mt-3 max-h-[32rem] overflow-y-auto border-t">
            {segments.map((s) => {
              const isCurrent = s.page === current;
              const chapter = chapterBefore.get(s.page);
              return (
                <li key={s.page} data-page={s.page} id={`page-${s.page}`} className="border-b">
                  {chapter ? (
                    <button
                      type="button"
                      onClick={() => seekSeconds(chapter.start)}
                      className="flex w-full gap-3 bg-sunken px-2 py-2 text-left text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                    >
                      <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">
                        {formatClock(chapter.start)}
                      </span>
                      <span>{chapter.title}</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => seek(s)}
                    aria-current={isCurrent ? "true" : undefined}
                    aria-label={`${t("video.seek", { time: formatClock(s.start) })}: ${s.text}`}
                    className={cn(
                      "flex w-full gap-3 px-2 py-2 text-left text-sm leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
                      isCurrent ? "bg-selected text-selected-foreground" : "hover:bg-muted",
                    )}
                  >
                    <span className="shrink-0 font-mono text-2xs tabular-nums text-faint">{formatClock(s.start)}</span>
                    <span>{s.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">{t("video.noTimes")}</p>
            <TextPages pages={pages?.map((p) => ({ ...p, markdown: transcriptText(p.markdown) })) ?? null} />
          </>
        )}
      </section>

      {listening ? (
        <section
          id="lp-video-panel-listening"
          role={timed ? "tabpanel" : undefined}
          aria-labelledby={timed ? "lp-video-tab-listening" : "lp-video-listening"}
          hidden={timed && tab !== "listening"}
        >
          {timed ? null : (
            <h2 id="lp-video-listening" className="lp-kicker mb-3">
              {tl("tab")}
            </h2>
          )}
          <ListeningPractice data={listening} moment={recording ? playhead : lastChosen} onPlay={playRange} onView={setView} />
        </section>
      ) : null}
    </div>
  );
}
