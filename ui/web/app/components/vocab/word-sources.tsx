/**
 * word-sources.tsx
 * A saved word's example sentences and recordings from open sources (plans/
 * a private plan, phase 6): Tatoeba's sentences with a
 * translation into the learner's language, each credited and one tap from
 * being the word's sentence (and its fill-in card); people saying the word,
 * from Lingua Libre and Wiktionary, credited.
 */
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { SourceRecording, SourceSentence, VocabNote } from "~/lib/vocab-types";
import { NOTE_JOIN } from "~/lib/sentence";
import { Button } from "~/components/ui/button";

const ROUTE = "/mastery/vocabulary/sources";
const LINK = "underline underline-offset-4";

type Failed = { error: string; unavailable: boolean };

export function WordSources({ note, onClose }: { note: Pick<VocabNote, "id" | "term" | "lang" | "contexts">; onClose: () => void }) {
  const { t, i18n } = useTranslation("vocab");
  const sentences = useFetcher<{ sentences: SourceSentence[] } | Failed>();
  const recordings = useFetcher<{ recordings: SourceRecording[] } | Failed>();
  const use = useFetcher<{ used: string } | Failed>();
  const to = i18n.language.split("-")[0]!;
  const query = (kind: string) => `${ROUTE}?${new URLSearchParams({ kind, lang: note.lang, term: note.term, to })}`;

  useEffect(() => {
    sentences.load(query("sentences"));
    recordings.load(query("recordings"));
    // Once per word opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // A stored sentence is the part of the source's that holds the word
  // (vocab.ContextSentence): a source sentence holding one is already in.
  const stored = note.contexts.map((c) => c.sentence);
  const isIn = (text: string) => stored.some((s) => s && text.includes(s));
  const done = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The button pressed is gone once its sentence is in: focus the line that says so.
    if (use.state === "idle" && use.data) done.current?.focus();
  }, [use.state, use.data]);
  const sentenceData = sentences.data;
  const recordingData = recordings.data;

  return (
    <section aria-label={t("sources.title", { term: note.term })} className="mt-2 border-t pt-2">
      <h4 className="font-sans text-sm font-medium">{t("sources.sentences")}</h4>
      {/* One status line, always mounted, so the result after a long wait is announced. */}
      <p className="mt-1 text-xs text-muted-foreground" role="status">
        {sentences.state !== "idle" || !sentenceData
          ? t("sources.lookingSentences")
          : "error" in sentenceData
            ? sentenceData.unavailable
              ? t("sources.down", { source: "Tatoeba" })
              : t("sources.failed")
            : sentenceData.sentences.length === 0
              ? t("sources.noSentences")
              : t("sources.foundSentences", { count: sentenceData.sentences.length })}
      </p>
      {!sentenceData || sentences.state !== "idle" || "error" in sentenceData || sentenceData.sentences.length === 0 ? null : (
        <ul className="mt-1 space-y-3">
          {sentenceData.sentences.map((s) => {
            const used = isIn(s.text) || (use.data && "used" in use.data && use.data.used === s.text);
            const credit = ["Tatoeba", s.author, s.licence].join(NOTE_JOIN);
            return (
              <li key={s.id} className="text-sm leading-prose">
                <p lang={note.lang}>{s.text}</p>
                {s.translation ? (
                  <p lang={to} className="text-muted-foreground">
                    {s.translation.text}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {credit}
                  </a>
                  {s.translation ? `${NOTE_JOIN}${t("sources.translatedBy", { author: s.translation.author, licence: s.translation.licence })}` : ""}
                </p>
                {used ? (
                  <p className="text-xs font-medium">{t("sources.isTheSentence")}</p>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    disabled={use.state !== "idle"}
                    aria-label={t("sources.useOf", { sentence: s.text })}
                    onClick={() => use.submit({ id: note.id, sentence: s.text, credit, url: s.url }, { method: "post", action: ROUTE })}
                  >
                    {t("sources.use")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p ref={done} tabIndex={-1} className="lp-status-line focus:outline-none" role="status" data-tone={use.data && "error" in use.data ? "error" : undefined}>
        {use.data ? ("error" in use.data ? use.data.error || t("sources.failed") : t("sources.used")) : null}
      </p>

      <h4 className="mt-4 font-sans text-sm font-medium">{t("sources.recordings")}</h4>
      <p className="mt-1 text-xs text-muted-foreground" role="status">
        {recordings.state !== "idle" || !recordingData
          ? t("sources.lookingRecordings")
          : "error" in recordingData
            ? recordingData.unavailable
              ? t("sources.down", { source: "Wikimedia Commons" })
              : t("sources.failed")
            : recordingData.recordings.length === 0
              ? t("sources.noRecordings")
              : t("sources.foundRecordings", { count: recordingData.recordings.length })}
      </p>
      {!recordingData || recordings.state !== "idle" || "error" in recordingData || recordingData.recordings.length === 0 ? null : (
        <ul className="mt-1 space-y-2">
          {recordingData.recordings.map((r) => (
            <li key={r.id} className="text-sm">
              <audio
                controls
                preload="none"
                src={`${ROUTE}?${new URLSearchParams({ kind: "audio", id: r.id })}`}
                aria-label={t("sources.recordingOf", { term: note.term, speaker: r.speaker })}
                className="h-11 w-full max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                <a href={r.page} target="_blank" rel="noopener noreferrer" className={LINK}>
                  {[r.speaker, r.source, r.licence].join(NOTE_JOIN)}
                </a>
              </p>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" size="sm" variant="ghost" className="mt-3" onClick={onClose}>
        {t("sources.close")}
      </Button>
    </section>
  );
}
