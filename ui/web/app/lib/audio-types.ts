/**
 * audio-types.ts
 * Wire shapes for audio overviews (internal/api/audioapi). Client-safe: the
 * player renders these, and a component importing a `.server.ts` module pulls
 * the gateway token into the browser bundle.
 */

export type AudioSegment = { speaker: "host" | "expert"; text: string; source_ids: string[] };

export type AudioSource = {
  id: string;
  title: string;
  page?: number;
  document_id?: string;
  report_id?: string;
};

/** Who speaks a script (up-methods phase 22): the server's Kokoro or a key on the tts route. */
export type VoicePair = { host: string; expert: string };

export type SpeechEngineOption = {
  engine: "builtin" | "byok";
  connection_id?: string;
  provider: string;
  name?: string;
  model: string;
  voices: VoicePair;
  usable: boolean;
  reason?: string;
  chars: number;
  speech_minutes: number;
  wait_minutes?: number;
  need_minutes?: number;
  daily_minutes?: number;
  used_minutes?: number;
  queue_ahead?: number;
};

export type AudioStatus = "scripting" | "synthesizing" | "ready" | "script_only" | "failed";

export type AudioOverview = {
  id: string;
  kb_id?: string;
  report_id?: string;
  title: string;
  language: "en" | "vi";
  minutes: number;
  topic?: string;
  status: AudioStatus;
  error?: string;
  script?: { title: string; segments: AudioSegment[] };
  sources: AudioSource[];
  chunks_done: number;
  chunks_total: number;
  audio_bytes: number;
  duration_seconds: number;
  created_at: string;
  tts_engine?: string;
  tts_model?: string;
  tts_voices?: VoicePair;
  /** What "Speak it" offers a finished script, for its language. */
  engines?: SpeechEngineOption[];
};

/** Statuses after which nothing changes by itself. */
export const AUDIO_FINAL: readonly AudioStatus[] = ["ready", "script_only", "failed"];

/**
 * Where each segment starts in the audio, in seconds. Speech runs at a
 * roughly steady rate, so a segment's share of the characters is its share of
 * the time; good enough to follow along, and it needs no timestamps from the
 * provider.
 */
export function segmentStarts(segments: AudioSegment[], duration: number): number[] {
  const lengths = segments.map((s) => s.text.length);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return lengths.map((n) => {
    const start = at;
    at += (n / total) * duration;
    return start;
  });
}

/** The segment playing at time t. */
export function currentSegment(starts: number[], t: number): number {
  let i = 0;
  while (i + 1 < starts.length && (starts[i + 1] ?? Infinity) <= t) i++;
  return i;
}
