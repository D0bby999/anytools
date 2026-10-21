import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { isRecording, thumbnailURL, type DocumentView, type TranscribeEstimate } from "~/lib/kb-types";
import { EnginePicker } from "./engine-picker";

/**
 * needs-transcript.tsx
 * A video with no transcript yet (learning-depth phase 4), and the three ways
 * to give it one, in the owner's order:
 *
 *  1. an AI transcript by the learner's own Gemini key reading the public URL,
 *     with its cost and limits shown BEFORE it runs;
 *  2. captions in another language, when the server could see the tracks;
 *  3. a subtitle file, or a pasted transcript.
 *
 * With `replacing`, the same forms replace a ready video's transcript: a
 * subtitle file can supersede an AI transcript at any time. Gemini is not
 * offered there; the server transcribes only a video that has no transcript.
 *
 * Up-methods phase 21: when an engine other than Gemini is available (the
 * server's built-in Whisper, the learner's Groq, OpenAI or own speech key),
 * the first way is the engine picker, which shows each engine's cost and
 * starts nothing until the learner picks one. With Gemini as the only engine,
 * the page is exactly what it was.
 *
 * The reason the server could not fetch captions is the document's own error
 * sentence, shown first: "YouTube did not let this server read the captions"
 * is what tells the learner that retrying will not help.
 *
 * Up-methods phase 15: an uploaded recording rests here too. It has no
 * thumbnail and no caption tracks, and every engine hears the stored file
 * (Gemini through its Files API), so the engine picker is always its first
 * way; the Gemini-only section speaks of public videos and is not shown.
 */
export type TranscriptActionData = { transcriptErrorKey?: string; transcriptErrorDetail?: string } | null;

/** The picker is shown when anything but Gemini can transcribe. */
function hasAudioEngines(transcribe?: TranscribeEstimate): boolean {
  return (transcribe?.engines ?? []).some((o) => o.engine !== "gemini");
}

export function NeedsTranscript({ view, replacing = false }: { view: DocumentView; replacing?: boolean }) {
  const { t, i18n } = useTranslation("knowledge");
  const fetcher = useFetcher<TranscriptActionData>();
  const { document: doc, transcribe } = view;
  const busy = fetcher.state !== "idle";
  const thumb = thumbnailURL(doc.media_id ?? "");
  const tracks = doc.media?.tracks ?? [];
  const minutes = transcribe ? Math.max(1, Math.round(transcribe.duration_seconds / 60)) : 0;
  const recording = isRecording(doc);
  const picker = recording || hasAudioEngines(transcribe);

  return (
    <section aria-labelledby={replacing ? undefined : "lp-needs-transcript"} className="space-y-8">
      {replacing ? null : (
      <div className="flex gap-4">
        {thumb ? (
          <img src={thumb} alt="" width={160} height={120} className="h-auto w-40 shrink-0 rounded-md border" />
        ) : null}
        <div>
          <h2 id="lp-needs-transcript" className="font-serif text-xl font-semibold">
            {recording ? t("media.needsTitle") : t("video.needs.title")}
          </h2>
          <p className="mt-2 text-sm leading-prose text-muted-foreground">
            {recording ? t("media.needsWhy") : t("video.needs.why")} {doc.error}
          </p>
        </div>
      </div>
      )}

      {fetcher.data?.transcriptErrorKey ? (
        <p role="alert" className="text-sm leading-snug text-destructive">
          {t(fetcher.data.transcriptErrorKey)}
          {fetcher.data.transcriptErrorDetail ? ` ${fetcher.data.transcriptErrorDetail}` : ""}
        </p>
      ) : null}

      {replacing || !picker || !transcribe ? null : (
        <section aria-labelledby="lp-transcribe" className="border-t pt-6">
          <h3 id="lp-transcribe" className="lp-section">
            {t("engines.title")}
          </h3>
          <EnginePicker estimate={transcribe} recording={recording} />
        </section>
      )}

      {replacing || picker ? null : (
      <section aria-labelledby="lp-transcribe" className="border-t pt-6">
        <h3 id="lp-transcribe" className="lp-section">
          {t("video.needs.gemini")}
        </h3>
        {transcribe?.available ? (
          <>
            <p className="mt-2 text-sm leading-prose">{t("video.needs.geminiBody")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-snug text-muted-foreground">
              <li>
                {transcribe.duration_seconds > 0
                  ? t("video.needs.estimate", {
                      tokens: transcribe.estimated_tokens.toLocaleString(i18n.language),
                      minutes,
                    })
                  : t("video.needs.estimateUnknown")}
              </li>
              <li>{t("video.needs.freeTier", { hours: Math.round(transcribe.free_tier_daily_seconds / 3600) })}</li>
              <li>{t("video.needs.publicOnly")}</li>
              <li>{t("video.needs.label")}</li>
            </ul>
            <fetcher.Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="transcribe" />
              <Button type="submit" disabled={busy}>
                {busy && fetcher.formData?.get("intent") === "transcribe"
                  ? t("video.needs.starting")
                  : t("video.needs.start")}
              </Button>
            </fetcher.Form>
          </>
        ) : (
          <p className="mt-2 text-sm leading-prose text-muted-foreground">
            {t("video.needs.noKey")}{" "}
            <Link to="/settings" className="text-primary underline-offset-2 hover:underline">
              {t("video.needs.settings")}
            </Link>
          </p>
        )}
      </section>
      )}

      {tracks.length > 0 ? (
        <section aria-labelledby="lp-track" className="border-t pt-6">
          <h3 id="lp-track" className="lp-section">
            {t("video.needs.track")}
          </h3>
          <fetcher.Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="intent" value="transcript-track" />
            <select
              name="track"
              aria-label={t("video.needs.track")}
              className="h-10 rounded-sm border border-control-border bg-card px-3 text-sm hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            >
              {tracks.map((tr) => (
                <option key={tr.lang + String(tr.auto)} value={tr.lang}>
                  {tr.name || tr.lang}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("video.needs.trackSubmit")}
            </Button>
          </fetcher.Form>
        </section>
      ) : null}

      <section aria-labelledby="lp-upload-subs" className="border-t pt-6">
        <h3 id="lp-upload-subs" className="lp-section">
          {t("video.needs.upload")}
        </h3>
        <fetcher.Form method="post" encType="multipart/form-data" className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="intent" value="transcript-upload" />
          <input
            type="file"
            name="file"
            accept=".vtt,.srt"
            required
            aria-label={t("video.needs.upload")}
            aria-describedby="lp-upload-subs-hint"
            className="lp-file w-auto"
          />
          <Button type="submit" variant="outline" disabled={busy}>
            {t("video.needs.uploadSubmit")}
          </Button>
        </fetcher.Form>
        <p id="lp-upload-subs-hint" className="mt-1 text-xs text-muted-foreground">
          {t("video.needs.uploadHint")}
        </p>
      </section>

      <section aria-labelledby="lp-paste" className="border-t pt-6">
        <h3 id="lp-paste" className="lp-section">
          {t("video.needs.paste")}
        </h3>
        <fetcher.Form method="post" className="mt-3 space-y-2">
          <input type="hidden" name="intent" value="transcript-paste" />
          <textarea
            name="text"
            required
            rows={8}
            aria-label={t("video.needs.paste")}
            aria-describedby="lp-paste-hint"
            className="w-full rounded-sm border border-control-border bg-card p-3 font-mono text-sm leading-snug hover:border-primary focus-visible:border-primary focus-visible:outline-none"
          />
          <p id="lp-paste-hint" className="text-xs text-muted-foreground">
            {t("video.needs.pasteHint")}
          </p>
          <Button type="submit" variant="outline" disabled={busy}>
            {t("video.needs.pasteSubmit")}
          </Button>
        </fetcher.Form>
      </section>
    </section>
  );
}
