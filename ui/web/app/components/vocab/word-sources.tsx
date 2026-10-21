/**
 * word-sources.tsx
 * A saved word's example sentences and recordings from open sources (plans/
 * a private plan, phase 6): Tatoeba's sentences with a
 * translation into the learner's language, each credited and one tap from
 * being the word's sentence (and its fill-in card); people saying the word,
 * from Lingua Libre and Wiktionary, credited.
 */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import type { SourceRecording, SourceSentence } from "~/lib/vocab.server";
import type { VocabNote } from "~/lib/vocab-types";
import { NOTE_JOIN } from "~/lib/sentence";
import { Button } from "~/components/ui/button";
import { StatusLine } from "~/components/doc/status-line";

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

  const have = new Set(note.contexts.map((c) => c.sentence));
  const sentenceData = sentences.data;
  const recordingData = recordings.data;

  return (
    <section aria-label={t("sources.title", { term: note.term })} className="mt-2 border-t pt-2">
      <h4 className="font-sans text-sm font-medium">{t("sources.sentences")}</h4>
      {sentences.state !== "idle" || !sentenceData ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("sources.lookingSentences")}
        </p>
      ) : "error" in sentenceData ? (
        <p className="mt-1 text-xs text-destructive" role="status">
          {sentenceData.unavailable ? t("sources.down", { source: "Tatoeba" }) : t("sources.failed")}
        </p>
      ) : sentenceData.sentences.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("sources.noSentences")}
        </p>
      ) : (
        <ul className="mt-1 space-y-3">
          {sentenceData.sentences.map((s) => {
            const used = have.has(s.text) || (use.data && "used" in use.data && use.data.used === s.text);
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
      <StatusLine tone={use.data && "error" in use.data ? "error" : "info"}>
        {use.data ? ("error" in use.data ? use.data.error || t("sources.failed") : t("sources.used")) : null}
      </StatusLine>

      <h4 className="mt-4 font-sans text-sm font-medium">{t("sources.recordings")}</h4>
      {recordings.state !== "idle" || !recordingData ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("sources.lookingRecordings")}
        </p>
      ) : "error" in recordingData ? (
        <p className="mt-1 text-xs text-destructive" role="status">
          {recordingData.unavailable ? t("sources.down", { source: "Wikimedia Commons" }) : t("sources.failed")}
        </p>
      ) : recordingData.recordings.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("sources.noRecordings")}
        </p>
      ) : (
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
