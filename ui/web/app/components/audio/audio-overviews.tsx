import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { AudioActionData } from "~/routes/app.api.audio";
import { AUDIO_FINAL, currentSegment, segmentStarts, type AudioOverview, type AudioSource } from "~/lib/audio-types";
import { SpeakIt, SpokenBy } from "./speak-it";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";

const ACTION = "/app/api/audio";

/**
 * Audio overviews of a knowledge base or a research report (learning depth,
 * phase 10): start one, watch it being written and spoken, listen, delete.
 *
 * Two steps, as the API has them: the script comes first, then "Speak it"
 * offers the ways to hear it that have voices for its language, each with its
 * cost (speak-it.tsx): the server's built-in voices, the learner's own speech
 * key, or the browser. The page reloads the list every few seconds while
 * something is still being made.
 */
export function AudioOverviews({
  overviews,
  kbId,
  reportId,
}: {
  overviews: AudioOverview[];
  kbId?: string;
  reportId?: string;
}) {
  const { t } = useTranslation("common");
  const revalidator = useRevalidator();
  const working = overviews.some((o) => !AUDIO_FINAL.includes(o.status));

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [working, revalidator]);

  return (
    <section aria-labelledby="lp-audio-title" className="mt-10">
      <h2 id="lp-audio-title" className="lp-kicker">
        {t("audio.title")}
      </h2>
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{t("audio.lead")}</p>
      <NewOverview kbId={kbId} reportId={reportId} />
      {overviews.length > 0 ? (
        <ul className="mt-6 border-t">
          {overviews.map((o) => (
            <li key={o.id} className="border-b py-4">
              <OverviewRow overview={o} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function NewOverview({ kbId, reportId }: { kbId?: string; reportId?: string }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<AudioActionData>();
  const busy = fetcher.state !== "idle";
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;
  return (
    <fetcher.Form method="post" action={ACTION} className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="intent" value="create" />
      {kbId ? <input type="hidden" name="kbId" value={kbId} /> : null}
      {reportId ? <input type="hidden" name="reportId" value={reportId} /> : null}
      <label className="text-sm">
        <span className="block font-medium">{t("audio.minutes")}</span>
        <select name="minutes" defaultValue="5" className="mt-1 min-h-11 rounded-md border border-control-border bg-background px-3">
          {[3, 5, 10, 15].map((m) => (
            <option key={m} value={m}>
              {t("audio.minutesValue", { count: m })}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="block font-medium">{t("audio.language")}</span>
        <select name="language" defaultValue="" className="mt-1 min-h-11 rounded-md border border-control-border bg-background px-3">
          <option value="">{t("audio.languageAuto")}</option>
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </label>
      {kbId ? (
        <label className="min-w-48 flex-1 text-sm">
          <span className="block font-medium">{t("audio.topic")}</span>
          <input
            name="topic"
            maxLength={200}
            placeholder={t("audio.topicPlaceholder")}
            className="mt-1 min-h-11 w-full rounded-md border border-control-border bg-background px-3"
          />
        </label>
      ) : null}
      <Button type="submit" disabled={busy}>
        {t("audio.create")}
      </Button>
      {failed ? (
        <p role="alert" className="w-full text-sm text-destructive">
          {failed}
        </p>
      ) : null}
    </fetcher.Form>
  );
}

function OverviewRow({ overview: o }: { overview: AudioOverview }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<AudioActionData>();
  const busy = fetcher.state !== "idle";
  const inProgress = !AUDIO_FINAL.includes(o.status);
  const act = (intent: "cancel" | "delete") =>
    void fetcher.submit({ intent, id: o.id }, { method: "post", action: ACTION });
  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{o.title || o.topic || t("audio.untitled")}</p>
        <p role="status" className="text-xs text-muted-foreground">
          {o.status === "synthesizing"
            ? t("audio.status.synthesizing", { done: o.chunks_done, total: o.chunks_total })
            : t(`audio.status.${o.status}`)}
        </p>
      </div>
      {o.status === "failed" && o.error ? <p className="mt-1 text-sm text-destructive">{o.error}</p> : null}
      {o.status === "script_only" && o.error ? (
        <p className="mt-1 text-sm text-muted-foreground">{t("audio.speakFailed", { reason: o.error })}</p>
      ) : null}

      {o.status === "ready" && o.script ? (
        <>
          <SpokenBy overview={o} />
          <Player overview={o} />
        </>
      ) : null}
      {o.status === "script_only" && o.script ? (
        <div className="mt-3">
          <SpeakIt overview={o} />
          <Transcript overview={o} current={-1} />
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {inProgress ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => act("cancel")}>
            {t("audio.cancel")}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (window.confirm(t("audio.deleteConfirm"))) act("delete");
          }}
        >
          {t("audio.delete")}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {failed}
        </p>
      ) : null}
    </div>
  );
}

/** The WAV, from 'self', with the transcript following along. */
export function Player({ overview: o }: { overview: AudioOverview }) {
  const player = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  // An overview kept in the learner's Drive says why it will not play
  // (drive-user-storage phase 3).
  const [reason, checkReason] = useDriveReason();
  const segments = o.script?.segments ?? [];
  const starts = useMemo(() => segmentStarts(segments, o.duration_seconds), [segments, o.duration_seconds]);
  return (
    <div className="mt-3">
      <audio
        ref={player}
        controls
        preload="metadata"
        src={`/audio-overviews/${o.id}.wav`}
        className="w-full"
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onError={() => checkReason(`/audio-overviews/${o.id}.wav`)}
      />
      {reason ? <DriveFileNotice reason={reason} className="mt-2" /> : null}
      <Transcript overview={o} current={currentSegment(starts, now)} />
    </div>
  );
}

function Transcript({ overview: o, current }: { overview: AudioOverview; current: number }) {
  const { t } = useTranslation("common");
  const byId = new Map(o.sources.map((s) => [s.id, s]));
  return (
    <details className="mt-3" open={current >= 0}>
      <summary className="cursor-pointer text-sm text-muted-foreground">{t("audio.transcript")}</summary>
      <ol className="mt-2 space-y-2 text-sm leading-prose">
        {(o.script?.segments ?? []).map((seg, i) => (
          <li key={i} aria-current={i === current ? "true" : undefined} className={i === current ? "rounded-md bg-selected px-2" : "px-2"}>
            <span className="lp-kicker mr-2">{seg.speaker === "host" ? t("audio.host") : t("audio.expert")}</span>
            {seg.text}
            {seg.source_ids.map((id) => {
              const src = byId.get(id);
              return src ? <SourceChip key={id} source={src} /> : null;
            })}
          </li>
        ))}
      </ol>
    </details>
  );
}

function SourceChip({ source: s }: { source: AudioSource }) {
  const href = s.report_id
    ? `/research/${s.report_id}`
    : s.document_id
      ? `/documents/${s.document_id}${s.page ? `?page=${s.page}` : ""}`
      : null;
  const label = s.page ? `${s.title} · p.${s.page}` : s.title;
  if (!href) return null;
  return (
    <a href={href} className="lp-chip ml-1 text-xs text-primary underline underline-offset-4">
      {label}
    </a>
  );
}
