/**
 * card-example.tsx
 * An example and a voice on a word's card, without a click (the private design notes, phase 3): a word with no sentence of its own (a word
 * list from the Library, five hundred at once) gets Tatoeba's first sentence
 * with its translation, and the first recording of a person saying it,
 * credited, as the word's "Sentences and sound" panel finds them. Looked up
 * once per card as it is shown; "Keep this sentence" stores it the way "Use
 * this sentence" does, and the word's fill-in card is then made from it.
 */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { SourceRecording, SourceSentence } from "~/lib/vocab-types";
import { NOTE_JOIN } from "~/lib/sentence";

const ROUTE = "/mastery/vocabulary/sources";
type Failed = { error: string; unavailable: boolean };

export function CardExample({ noteId, term, lang, show }: { noteId: string; term: string; lang: string; show: boolean }) {
  const { t, i18n } = useTranslation("vocab");
  const sentences = useFetcher<{ sentences: SourceSentence[] } | Failed>();
  const recordings = useFetcher<{ recordings: SourceRecording[] } | Failed>();
  const keep = useFetcher<{ used: string } | Failed>();
  const to = i18n.language.split("-")[0]!;

  useEffect(() => {
    const query = (kind: string) => `${ROUTE}?${new URLSearchParams({ kind, lang, term, to })}`;
    sentences.load(query("sentences"));
    recordings.load(query("recordings"));
    // Once per card shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  if (!show) return null;
  const sentence = sentences.data && "sentences" in sentences.data ? sentences.data.sentences[0] : undefined;
  const recording = recordings.data && "recordings" in recordings.data ? recordings.data.recordings[0] : undefined;
  const looking = sentences.state !== "idle" || !sentences.data;
  if (!looking && !sentence && !recording) return null;
  const kept = keep.data && "used" in keep.data;

  return (
    <section aria-label={t("cardExample.title", { term })} className="mt-3 text-sm leading-prose">
      {looking ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("cardExample.looking")}
        </p>
      ) : null}
      {sentence ? (
        <div>
          <blockquote className="rounded-lg border bg-sunken p-4" lang={lang}>
            <p>{sentence.text}</p>
            {sentence.translation ? (
              <p lang={to} className="mt-1 text-muted-foreground">
                {sentence.translation.text}
              </p>
            ) : null}
          </blockquote>
          <p className="mt-1 text-xs text-muted-foreground">
            <a href={sentence.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              {["Tatoeba", sentence.author, sentence.licence].join(NOTE_JOIN)}
            </a>
          </p>
          {kept ? (
            <p role="status" className="text-xs font-medium">
              {t("cardExample.kept")}
            </p>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={keep.state !== "idle"}
              onClick={() =>
                keep.submit(
                  {
                    id: noteId,
                    sentence: sentence.text,
                    credit: ["Tatoeba", sentence.author, sentence.licence].join(NOTE_JOIN),
                    url: sentence.url,
                  },
                  { method: "post", action: ROUTE },
                )
              }
            >
              {t("cardExample.keep")}
            </Button>
          )}
        </div>
      ) : null}
      {recording ? (
        <div className="mt-2">
          <audio
            controls
            preload="none"
            src={`${ROUTE}?${new URLSearchParams({ kind: "audio", id: recording.id })}`}
            aria-label={t("sources.recordingOf", { term, speaker: recording.speaker })}
            className="h-11 w-full max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            <a href={recording.page} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              {[recording.speaker, recording.source, recording.licence].join(NOTE_JOIN)}
            </a>
          </p>
        </div>
      ) : null}
    </section>
  );
}
