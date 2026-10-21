/**
 * mic-button.tsx — say the question instead of typing it (after postclaw's
 * composer mic).
 *
 * Where the browser recognises speech itself (Chrome, Edge, Safari), the words
 * are written into the composer as they are heard, in the learner's language.
 * Elsewhere the question is recorded, up to 30 seconds, and heard by the
 * learner's speech-to-text route or the server's engine (app.api.dictate.ts).
 * With neither a recogniser nor a microphone, there is no button. Nothing is
 * sent: the words land in the box, to read before sending.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Square } from "lucide-react";
import { pickRecordingType } from "~/components/worksheet/recorder";
import { cn } from "~/lib/utils";

const MAX_SECONDS = 30;

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

type Mode = "recognise" | "record" | null;

export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation("common");
  const [mode, setMode] = useState<Mode>(null);
  const [state, setState] = useState<"idle" | "listening" | "hearing">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const sink = useRef(onText);
  sink.current = onText;

  // Known only in a browser: the server and the first render draw no button.
  useEffect(() => {
    if (recognitionClass()) setMode("recognise");
    else if (pickRecordingType() && typeof navigator.mediaDevices?.getUserMedia === "function") setMode("record");
  }, []);

  useEffect(
    () => () => {
      recognition.current?.stop();
      if (recorder.current?.state === "recording") recorder.current.stop();
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!mode) return null;
  const lang = (i18n.language || "en").slice(0, 2);

  function recognise() {
    const Rec = recognitionClass();
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = i18n.language || "en";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) sink.current(r[0].transcript.trim());
      }
    };
    rec.onerror = (e) => setProblem(e.error === "not-allowed" ? t("chat.mic.denied") : t("chat.mic.failed"));
    rec.onend = () => setState("idle");
    recognition.current = rec;
    setProblem(null);
    rec.start();
    setState("listening");
  }

  async function record() {
    const type = pickRecordingType();
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setProblem(t("chat.mic.denied"));
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = async () => {
      media.getTracks().forEach((track) => track.stop());
      if (timer.current) window.clearTimeout(timer.current);
      setState("hearing");
      const body = new FormData();
      body.set("lang", lang);
      body.set("audio", new File(chunks, "question", { type: rec.mimeType || type || "audio/webm" }));
      try {
        const res = await fetch("/app/api/dictate", { method: "POST", credentials: "same-origin", body });
        const data = (await res.json()) as { text?: string; error?: string };
        if (res.ok && data.text) sink.current(data.text);
        else setProblem(data.error || t("chat.mic.failed"));
      } catch {
        setProblem(t("chat.mic.failed"));
      }
      setState("idle");
    };
    recorder.current = rec;
    setProblem(null);
    rec.start();
    setState("listening");
    timer.current = window.setTimeout(() => rec.state === "recording" && rec.stop(), MAX_SECONDS * 1000);
  }

  function toggle() {
    if (state === "listening") {
      recognition.current?.stop();
      if (recorder.current?.state === "recording") recorder.current.stop();
      return;
    }
    if (mode === "recognise") recognise();
    else void record();
  }

  const listening = state === "listening";
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || state === "hearing"}
        aria-pressed={listening}
        aria-label={listening ? t("chat.mic.stop") : t("chat.mic.start")}
        title={listening ? t("chat.mic.stop") : t("chat.mic.start")}
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50",
          listening ? "bg-destructive-soft text-destructive" : "text-muted-foreground hover:bg-hover hover:text-foreground",
        )}
      >
        {listening ? <Square aria-hidden="true" className="size-4" /> : <Mic aria-hidden="true" className="size-4" />}
      </button>
      <span role="status" className="sr-only">
        {listening ? t("chat.mic.listening") : state === "hearing" ? t("chat.mic.hearing") : ""}
      </span>
      {problem ? (
        <span role="alert" className="absolute right-0 bottom-full mb-1 w-56 rounded-md border bg-card px-2 py-1 text-xs text-destructive shadow-sm">
          {problem}
        </span>
      ) : null}
    </span>
  );
}
