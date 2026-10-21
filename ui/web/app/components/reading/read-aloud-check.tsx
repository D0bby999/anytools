import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { clock, pickRecordingType, RAW_AUDIO, UploadFallback } from "~/components/worksheet/recorder";

/**
 * read-aloud-check.tsx
 * "Check my reading aloud" on a selection (the private design notes,
 * phase 2): record yourself reading the passage, and see which words a
 * speech engine did not get. It says whether the words were understood, not
 * how close an accent is.
 *
 * The take goes to documents.$docId.speaking-check, which forwards it to the
 * learner's own speech-to-text connection or the server's built-in engine;
 * nothing is kept. Each word's state is said in text as well as colour.
 */

/** The API's limit on one take, in seconds. */
export const CHECK_SECONDS = 30;

/** The most words a check takes; the server refuses more. */
export const CHECK_WORDS = 80;

export type CheckWord = { text: string; state: "ok" | "missed" | "heard_as"; heard?: string; added?: string };

export type CheckResult = {
  words: CheckWord[];
  before?: string;
  ok: number;
  heard: string;
  by: { kind: "own" | "builtin"; name?: string };
  lang: string;
};

/** Whether a selection is short enough to check. */
export function checkable(text: string): boolean {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  return n > 0 && n <= CHECK_WORDS;
}

type Phase =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "sending" }
  | { kind: "done"; result: CheckResult }
  | { kind: "failed"; message: string };

export function ReadAloudCheck({
  docId,
  page,
  text,
  onClose,
}: {
  docId: string;
  page: number;
  text: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("reading");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [problem, setProblem] = useState<"unsupported" | "denied" | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [],
  );

  const send = async (audio: Blob) => {
    setPhase({ kind: "sending" });
    const body = new FormData();
    body.set("page", String(page));
    body.set("text", text);
    body.set("audio", audio, "take");
    try {
      const res = await fetch(`/documents/${encodeURIComponent(docId)}/speaking-check`, { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<CheckResult> & { error?: string };
      if (!res.ok || !data.words) {
        setPhase({ kind: "failed", message: data.error || t("check.failed") });
        return false;
      }
      setPhase({ kind: "done", result: data as CheckResult });
      return true;
    } catch {
      setPhase({ kind: "failed", message: t("check.failed") });
      return false;
    }
  };

  const start = async () => {
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
      void send(new Blob(chunks, { type: rec.mimeType || type }));
    };
    recorder.current = rec;
    rec.start();
    setElapsed(0);
    setPhase({ kind: "recording" });
    timer.current = setInterval(() => {
      const s = (Date.now() - startedAt) / 1000;
      setElapsed(s);
      if (s >= CHECK_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  };

  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-popover flex justify-center px-4 lg:bottom-6">
      <section
        aria-labelledby="lp-read-check"
        className="pointer-events-auto max-h-[70vh] w-full max-w-xl overflow-y-auto rounded-lg border bg-card p-3 shadow-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="lp-read-check" className="lp-section">
            {t("check.title")}
          </h2>
          <Button type="button" size="icon" variant="ghost" aria-label={t("check.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>
        {phase.kind !== "done" ? (
          <>
            <blockquote className="mt-2 text-base leading-prose">{text}</blockquote>
            <p className="mt-2 text-xs leading-snug text-muted-foreground">{t("check.privacy")}</p>
          </>
        ) : null}

        {problem ? (
          <div className="mt-3 space-y-2">
            <p role="status" className="text-sm text-muted-foreground">
              {problem === "denied" ? t("check.denied") : t("check.unsupported")}
            </p>
            <UploadFallback label={t("check.title")} onPick={(file) => send(file)} />
          </div>
        ) : phase.kind === "idle" || phase.kind === "failed" ? (
          <div className="mt-3 space-y-2">
            {phase.kind === "failed" ? (
              <p role="alert" className="text-sm text-destructive">
                {phase.message}
              </p>
            ) : null}
            <Button type="button" onClick={start}>
              {phase.kind === "failed" ? t("check.again") : t("check.record")}
            </Button>
          </div>
        ) : phase.kind === "recording" ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={stop}>
              {t("check.stop")}
            </Button>
            <span className="font-mono text-sm tabular-nums" role="timer" aria-live="off">
              {clock(elapsed)}
            </span>
            <span className="text-xs text-faint">{t("check.limit", { seconds: CHECK_SECONDS })}</span>
          </div>
        ) : phase.kind === "sending" ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            {t("check.sending")}
          </p>
        ) : (
          <CheckOutcome result={phase.result} onAgain={() => setPhase({ kind: "idle" })} />
        )}
      </section>
    </div>
  );
}

/** The passage with each word's state, then the same in lists, in words. */
export function CheckOutcome({ result, onAgain }: { result: CheckResult; onAgain: () => void }) {
  const { t } = useTranslation("reading");
  const missed = result.words.filter((w) => w.state === "missed");
  const heardAs = result.words.filter((w) => w.state === "heard_as");
  const added = [result.before, ...result.words.map((w) => w.added)].filter((s): s is string => !!s);
  return (
    <div className="mt-2 space-y-3" role="status">
      <p className="text-sm font-medium">{t("check.summary", { ok: result.ok, count: result.words.length })}</p>
      <p className="text-base leading-prose" lang={result.lang}>
        {result.words.map((w, i) => (
          <span key={i}>
            {i > 0 ? " " : ""}
            {w.state === "ok" ? (
              w.text
            ) : w.state === "missed" ? (
              <span className="rounded-sm bg-destructive-soft px-0.5 line-through decoration-destructive">
                {w.text}
                <span className="sr-only"> ({t("check.missedWord")})</span>
              </span>
            ) : (
              <span className="rounded-sm bg-warning-soft px-0.5 underline decoration-wavy decoration-warning">
                {w.text}
                <span className="sr-only"> ({t("check.heardAsWord", { heard: w.heard })})</span>
              </span>
            )}
          </span>
        ))}
      </p>
      {missed.length > 0 ? (
        <p className="text-sm">
          <span className="font-medium">{t("check.missed")}: </span>
          <span lang={result.lang}>{missed.map((w) => w.text).join(", ")}</span>
        </p>
      ) : null}
      {heardAs.length > 0 ? (
        <ul className="text-sm">
          <li className="font-medium">{t("check.heardAs")}:</li>
          {heardAs.map((w, i) => (
            <li key={i} lang={result.lang}>
              {w.text} → {w.heard}
            </li>
          ))}
        </ul>
      ) : null}
      {added.length > 0 ? (
        <p className="text-sm">
          <span className="font-medium">{t("check.added")}: </span>
          <span lang={result.lang}>{added.join(" · ")}</span>
        </p>
      ) : null}
      <p className="text-xs leading-snug text-muted-foreground">
        {result.by.kind === "own" ? t("check.byOwn", { name: result.by.name ?? "" }) : t("check.byBuiltin")}{" "}
        {t("check.heardText")}: <span lang={result.lang}>“{result.heard}”</span>
      </p>
      <p className="text-xs leading-snug text-muted-foreground">{t("check.notAScore")}</p>
      <Button type="button" variant="outline" onClick={onAgain}>
        {t("check.again")}
      </Button>
    </div>
  );
}
