/**
 * recorder.tsx
 * Record one take in the browser (up-methods phase 7): record, stop, listen,
 * then keep or discard. Nothing leaves the browser until "Keep".
 *
 * up's speaking chapter asks for the original recording — no denoising, no
 * cut pauses — so the microphone is opened with noise suppression, echo
 * cancellation and automatic gain all off, and the take is uploaded exactly
 * as MediaRecorder made it. A take stops itself at ten minutes, the API's
 * limit.
 *
 * Where the browser has no MediaRecorder, or the microphone is refused, the
 * learner can upload a file recorded elsewhere; it goes through the same
 * route and the same checks.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";
import type { DriveReason } from "~/lib/drive-storage";

/** The API's limit on one take, in seconds. */
export const MAX_SECONDS = 600;

/** MediaRecorder types, in order of preference: what the API accepts. */
export const RECORDING_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"] as const;

/** The first type this browser's MediaRecorder can make, or null. */
export function pickRecordingType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of RECORDING_TYPES) {
    if (typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}

/** The constraints that keep the take raw. */
export const RAW_AUDIO: MediaStreamConstraints = {
  audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false },
};

/** m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "recorded"; blob: Blob; url: string; seconds: number }
  | { kind: "keeping" };

/**
 * Why a take was not kept: the API's sentence, or the reason the learner's
 * Google Drive refused it (drive-user-storage phase 5).
 */
export type KeepFailure = string | { driveReason: DriveReason };

type Props = {
  /** Uploads a take; resolves to why it was not kept, or null once it is. */
  onKeep: (audio: Blob, type: string, seconds: number) => Promise<KeepFailure | null>;
  /** What the take is for, for the controls' accessible names. */
  label: string;
};

export function Recorder({ onKeep, label }: Props) {
  const { t } = useTranslation("toolkit");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<"unsupported" | "denied" | null>(null);
  const [error, setError] = useState<KeepFailure | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const url = useRef<string | null>(null);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  const forget = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  };
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      forget();
    },
    [],
  );

  const start = async () => {
    setError(null);
    const type = pickRecordingType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setProblem("unsupported");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(RAW_AUDIO);
    } catch {
      setProblem("denied");
      return;
    }
    stream.current = media;
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(media, { mimeType: type });
    const startedAt = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      release();
      const blob = new Blob(chunks, { type: rec.mimeType || type });
      forget();
      url.current = URL.createObjectURL(blob);
      const seconds = Math.min(MAX_SECONDS, (Date.now() - startedAt) / 1000);
      setPhase({ kind: "recorded", blob, url: url.current, seconds });
    };
    recorder.current = rec;
    rec.start();
    setElapsed(0);
    setPhase({ kind: "recording" });
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      setElapsed(s);
      if (s >= MAX_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const discard = () => {
    forget();
    setPhase({ kind: "idle" });
  };

  const keep = async (audio: Blob, type: string, seconds: number) => {
    setPhase({ kind: "keeping" });
    setError(null);
    const failed = await onKeep(audio, type, seconds);
    if (failed) {
      setError(failed);
      return false;
    }
    forget();
    setPhase({ kind: "idle" });
    return true;
  };

  if (problem) {
    return (
      <div className="space-y-2">
        <p role="status" className="text-sm text-muted-foreground">
          {problem === "denied" ? t("recordings.denied") : t("recordings.unsupported")}
        </p>
        <UploadFallback label={label} onPick={(file, seconds) => keep(file, file.type, seconds)} />
        {error ? <KeepError error={error} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {phase.kind === "idle" ? (
        <Button type="button" variant="outline" size="sm" onClick={start} aria-label={`${t("recordings.record")}: ${label}`}>
          {t("recordings.record")}
        </Button>
      ) : null}
      {phase.kind === "recording" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" onClick={stop} aria-label={`${t("recordings.stop")}: ${label}`}>
            {t("recordings.stop")}
          </Button>
          <span className="font-mono text-sm tabular-nums" role="timer" aria-live="off">
            {clock(elapsed)}
          </span>
          <span className="text-xs text-faint">{t("recordings.limit")}</span>
        </div>
      ) : null}
      {phase.kind === "recorded" ? (
        <div className="space-y-2">
          <audio controls src={phase.url} className="w-full max-w-sm" aria-label={`${t("recordings.preview")}: ${label}`} />
          <p className="text-xs text-faint">{t("recordings.previewHint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => keep(phase.blob, phase.blob.type, phase.seconds)}>
              {t("recordings.keep")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={discard}>
              {t("recordings.discard")}
            </Button>
          </div>
        </div>
      ) : null}
      {phase.kind === "keeping" ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("recordings.keeping")}
        </p>
      ) : null}
      {error ? (
        <div className="space-y-2">
          <KeepError error={error} />
          <Button type="button" variant="ghost" size="sm" onClick={discard}>
            {t("recordings.discard")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Why a take was not kept: Drive's reason with what to do, or the sentence. */
function KeepError({ error }: { error: KeepFailure }) {
  if (typeof error !== "string") return <DriveFileNotice reason={error.driveReason} />;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

/** How long an audio file plays, read by the browser; 0 when it cannot tell. */
function measure(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof URL.createObjectURL !== "function") return resolve(0);
    const src = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    const done = (seconds: number) => {
      URL.revokeObjectURL(src);
      resolve(Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    };
    const giveUp = setTimeout(() => done(0), 3000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(giveUp);
      done(audio.duration);
    };
    audio.onerror = () => {
      clearTimeout(giveUp);
      done(0);
    };
    audio.src = src;
  });
}

export function UploadFallback({ label, onPick }: { label: string; onPick: (file: File, seconds: number) => Promise<boolean> }) {
  const { t } = useTranslation("toolkit");
  const [busy, setBusy] = useState(false);
  return (
    <label className="block text-sm">
      <span className="font-medium">{t("recordings.upload")}</span>
      <span className="block text-xs text-faint">{t("recordings.uploadHint")}</span>
      <input
        type="file"
        accept="audio/webm,audio/ogg,audio/mp4,audio/x-m4a,.webm,.ogg,.m4a,.mp4"
        disabled={busy}
        aria-label={`${t("recordings.upload")}: ${label}`}
        className="mt-1 lp-file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const ok = await onPick(file, await measure(file));
          setBusy(false);
          if (ok) e.target.value = "";
        }}
      />
    </label>
  );
}
