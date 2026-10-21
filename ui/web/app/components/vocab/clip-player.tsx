import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { embedURL, recordingURL } from "~/lib/kb-types";
import type { VocabClip } from "~/lib/vocab-types";
import { Button } from "~/components/ui/button";

/**
 * clip-player.tsx
 * Plays one transcript line for a listening card (the private design notes, phase 1): a YouTube video in the nocookie embed, cut to the
 * line by start= and end=; an uploaded recording from 'self', seeked to the
 * line and paused at its end. A second press plays the line again.
 *
 * The line is padded by a second at its end: a transcript's timings are
 * whole seconds, and a word said at the edge would otherwise be cut off.
 */
export function ClipPlayer({ clip }: { clip: VocabClip }) {
  const { t } = useTranslation("vocab");
  const [plays, setPlays] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const end = clip.end + 1;

  // A recording stops at the line's end.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const stop = () => {
      if (el.currentTime >= end) el.pause();
    };
    el.addEventListener("timeupdate", stop);
    return () => el.removeEventListener("timeupdate", stop);
  }, [end]);

  const play = () => {
    setPlays((n) => n + 1);
    const el = audio.current;
    if (el) {
      el.currentTime = clip.start;
      void el.play().catch(() => {});
    }
  };

  const src = clip.video_id && plays > 0 ? embedURL(clip.video_id, clip.start, true, end) : null;
  return (
    <div className="mt-3 space-y-3">
      <Button type="button" variant="outline" onClick={play}>
        {plays === 0 ? t("listen.play") : t("listen.again")}
      </Button>
      {clip.video_id ? (
        src ? (
          <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border">
            <iframe
              key={plays}
              src={src}
              title={t("listen.player")}
              allow="autoplay; encrypted-media"
              className="size-full"
            />
          </div>
        ) : null
      ) : (
        <audio ref={audio} src={recordingURL(clip.document_id)} preload="metadata" aria-label={t("listen.player")} />
      )}
    </div>
  );
}
