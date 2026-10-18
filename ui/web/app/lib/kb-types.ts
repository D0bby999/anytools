/**
 * kb-types.ts
 * The Knowledge Center's wire shapes, in a module with NO server imports.
 *
 * They live apart from kb.server.ts because components render them, and a
 * component that imports a `.server` module pulls the gateway token and the
 * OAuth secrets into the client bundle. Vite would usually tree-shake a
 * type-only import out — "usually" is not a security property, and
 * app/test/structural-guards.test.ts enforces the separation rather than
 * trusting it.
 */

/** Mirrors internal/knowledge.KB. */
export type KB = {
  id: string;
  name: string;
  embedding_model: string;
  dims: number;
  fts_config: string;
  needs_reembed: boolean;
  created_at: string;
  updated_at: string;
};

export type KBSummary = {
  kb: KB;
  documents: number;
  ready: number;
  failed: number;
  working: number;
};

/** Mirrors internal/knowledge.ProcessedBy. */
export type ProcessedBy = {
  parser?: string;
  model?: string;
  /** Who transcribed a video: "gemini", "builtin" (this server), or a speech provider id. */
  engine?: string;
  downgraded?: boolean;
  embedder?: string;
  embed_model?: string;
  note?: string;
};

/**
 * The document lifecycle, closed and matching the CHECK constraint on
 * documents.status. A status not in this union cannot be written.
 */
export type DocumentStatus = "queued" | "parsing" | "indexing" | "ready" | "failed" | "needs_transcript";

/** Where a video's transcript came from. An AI transcript is labelled wherever it shows. */
export type TranscriptSource = "captions" | "ai_transcript" | "learner";

/** Mirrors internal/knowledge.CaptionTrack. */
export type CaptionTrack = { lang: string; name?: string; auto?: boolean };

/** Mirrors internal/knowledge.VideoMedia: display facts, never a URL to load. */
export type VideoMedia = {
  channel?: string;
  duration_seconds?: number;
  tracks?: CaptionTrack[];
  language?: string;
  caption_error?: string;
  /** The transcript is YouTube's speech recognition, not the creator's captions. */
  auto_captions?: boolean;
  /** The creator's description (bounded) and the chapters read from it. Text only. */
  description?: string;
  chapters?: VideoChapter[];
};

/** A creator-defined chapter. Mirrors internal/connectors/youtube.Chapter. */
export type VideoChapter = { start: number; end: number; title: string };

/** Mirrors internal/knowledge.Document. */
export type KBDocument = {
  id: string;
  kb_id: string;
  source_kind: string;
  title: string;
  mime: string;
  bytes: number;
  sha256: string;
  page_count: number;
  status: DocumentStatus;
  error?: string;
  /**
   * Set when a parse failed because the original in the learner's Google
   * Drive was out of reach: drive_reconnect, drive_file_removed or
   * drive_full (drive-user-storage phase 4).
   */
  error_code?: string;
  processed_by: ProcessedBy;
  version: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
  // Links (learning-depth phase 4).
  source_url?: string;
  auto_sync?: boolean;
  last_synced_at?: string;
  sync_error?: string;
  sync_changes?: number;
  /** timeline[N-1] is page N's [start, end] in seconds, for a timed video. */
  timeline?: [number, number][];
  media_id?: string;
  media?: VideoMedia;
  transcript_source?: TranscriptSource;
  // Sites and repositories (up-methods phase 18).
  site_id?: string;
  repo_id?: string;
  source_path?: string;
  /** Set when the page or file is no longer in its site or repository. */
  removed_at?: string;
  /** "line" for a repository's code file, cited by line range. */
  page_unit?: "page" | "line";
  // Audio and video files (up-methods phase 15): the recording's own type,
  // sniffed from its bytes at upload, and size.
  media_mime?: string;
  media_bytes?: number;
};

/**
 * One engine that could transcribe a video, with what it costs. Mirrors
 * internal/knowledge.EngineOption (up-methods phase 21).
 */
export type EngineOption = {
  engine: "builtin" | "byok" | "gemini";
  connection_id?: string;
  /** "builtin", "gemini", "openai", "groq" or "openai_compat". */
  provider: string;
  name?: string;
  model?: string;
  usable: boolean;
  reason?: string;
  /** The server fetches the audio from YouTube for it. */
  downloads: boolean;
  estimated_tokens?: number;
  audio_minutes?: number;
  wait_minutes?: number;
  daily_minutes?: number;
  used_minutes?: number;
  queue_ahead?: number;
};

/** GET /v1/documents/{id}: the document and, for a video, what an AI transcript costs. */
export type TranscribeEstimate = {
  available: boolean;
  duration_seconds: number;
  estimated_tokens: number;
  windows: number;
  free_tier_daily_seconds: number;
  /** Every engine the learner can use (phase 21). Absent from an older API. */
  engines?: EngineOption[];
  /** YouTube refused this server the audio last time. */
  audio_blocked?: boolean;
  /** Built-in jobs ahead of this video's, while it waits. */
  queue_ahead?: number | null;
  /** An uploaded recording whose length its header did not give (phase 15). */
  length_unknown?: boolean;
};

export type DocumentView = { document: KBDocument; transcribe?: TranscribeEstimate };

/** Mirrors internal/rag/retrieve.Hit. */
export type Hit = {
  chunk_id: string;
  document_id: string;
  kb_id: string;
  title: string;
  heading_path: string;
  page_start: number;
  page_end: number;
  text: string;
  score: number;
  from_text: boolean;
  from_vector: boolean;
};

export type DocumentPage = { page: number; markdown: string };

export type DocumentContent = {
  document: KBDocument;
  pages: DocumentPage[] | null;
};

/** True while anything in the list is still being worked on. */
export function isWorking(documents: KBDocument[]): boolean {
  return documents.some(
    (d) => d.status === "queued" || d.status === "parsing" || d.status === "indexing",
  );
}

/**
 * Audio and video files: anything-llm's list plus .mov, each sniffed from its
 * bytes on the server (internal/connectors/media).
 */
export const MEDIA_EXTENSIONS = [".mp3", ".wav", ".m4a", ".ogg", ".oga", ".opus", ".webm", ".mp4", ".mpeg", ".mov"] as const;

/** Mirrors knowledge.MaxUploadBytes and knowledge.MaxMediaBytes. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

/** The cap for a file of this name, as the server applies it (knowledge.UploadLimit). */
export function uploadLimit(filename: string): number {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return (MEDIA_EXTENSIONS as readonly string[]).includes(ext) ? MAX_MEDIA_BYTES : MAX_UPLOAD_BYTES;
}

/** Something heard on a clock: a YouTube video or an uploaded recording. */
export function isTimed(doc: Pick<KBDocument, "source_kind">): boolean {
  return doc.source_kind === "youtube" || doc.source_kind === "media";
}

/** An uploaded recording the page plays with a native element. */
export function isRecording(doc: Pick<KBDocument, "source_kind" | "media_mime">): boolean {
  return doc.source_kind === "media" && Boolean(doc.media_mime);
}

/** Whether a recording has a picture, so it plays in a <video>. */
export function isVideoRecording(doc: Pick<KBDocument, "media_mime">): boolean {
  return (doc.media_mime ?? "").startsWith("video/");
}

/** The BFF route that plays a recording from 'self' (documents.$docId.media.ts). */
export function recordingURL(docId: string): string {
  return `/documents/${encodeURIComponent(docId)}/media`;
}

/**
 * Accepted upload extensions, mirroring internal/rag/parse's allowlist.
 *
 * Restated here only as the file input's `accept` hint, which is a
 * convenience for the file picker. The decision is the server's: the browser
 * hint is trivially bypassed, and parse.Detect re-checks both the extension
 * and the file's own bytes.
 */
export const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".pptx",
  ".epub",
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".txt",
  ".xlsx",
  ".csv",
  ".tsv",
  // Audio and video (up-methods phase 15), internal/connectors/media.Extensions.
  ...MEDIA_EXTENSIONS,
  // Up-methods phase 16: photos of pages and notes, read by the parse route.
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".heic",
] as const;

/** Photos of pages and notes (up-methods phase 16), mirroring internal/rag/parse/photo.go. */
export const PHOTO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".heic"] as const;
/** parse.MaxPhotoBytes: one photo, after the browser has scaled it. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** parse.MaxPhotosPerDocument. */
export const MAX_PHOTOS_PER_DOCUMENT = 30;
/** parse.MimePhotoSet: several photos kept as one document, one page each. */
export const PHOTO_SET_MIME = "application/vnd.longplay.photo-set";

/** Whether a document is read from photos: one, or a set of them. */
export function isPhotoMime(mime: string | undefined): boolean {
  return (
    mime === PHOTO_SET_MIME ||
    mime === "image/png" ||
    mime === "image/jpeg" ||
    mime === "image/webp" ||
    mime === "image/heic"
  );
}

/** Whether a chosen file is a photo, by its name: the server sniffs the bytes. */
export function isPhotoFile(file: { name: string }): boolean {
  const name = file.name.toLowerCase();
  return PHOTO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Seconds as MM:SS, or H:MM:SS from an hour on (youtube.FormatClock). */
export function formatClock(seconds: number): string {
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * A moment written as MM:SS (minutes may run past 59) or H:MM:SS, in seconds;
 * null for anything else. The same shape the listening audit's Check accepts
 * (internal/learning/worksheet/kinds_listening_audit.go).
 */
export function parseClock(text: string): number | null {
  const m = /^(?:(\d{1,3}):([0-5]\d)|(\d{1,2}):([0-5]\d):([0-5]\d))$/.exec(text.trim());
  if (!m) return null;
  if (m[1] !== undefined) return Number(m[1]) * 60 + Number(m[2]);
  return Number(m[3]) * 3600 + Number(m[4]) * 60 + Number(m[5]);
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The privacy-enhanced player URL. Built only from a validated id, so no
 * stored or model-written string ever becomes a frame source, and the only
 * frame host is the one the CSP names.
 *
 * `end` stops the player there (the embed's own `end=` parameter), for a
 * segment replayed on its own; it is ignored unless it comes after `start`.
 */
export function embedURL(videoId: string, start: number, autoplay = false, end?: number): string | null {
  if (!VIDEO_ID.test(videoId)) return null;
  const from = Math.max(0, Math.floor(start));
  const params = new URLSearchParams({ start: String(from), rel: "0" });
  if (end !== undefined && Math.ceil(end) > from) params.set("end", String(Math.ceil(end)));
  if (autoplay) params.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

/** The thumbnail, from the id, on the one image host the CSP allows for it. */
export function thumbnailURL(videoId: string): string | null {
  return VIDEO_ID.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

/** The second page N starts at, when the document has a timeline. */
export function pageStartSeconds(doc: Pick<KBDocument, "timeline">, page: number): number | undefined {
  return doc.timeline?.[page - 1]?.[0];
}

/** The page whose segment holds second t. */
export function pageAtSeconds(doc: Pick<KBDocument, "timeline">, t: number): number | undefined {
  const timeline = doc.timeline ?? [];
  let found: number | undefined;
  timeline.forEach(([start], i) => {
    if (start <= t) found = i + 1;
  });
  return found;
}

/**
 * A transcript page's text for display. The server escapes `<`, `>` and `&`
 * in transcript text before it is stored (youtube.Index); React escapes again
 * on render, so the entities are decoded here and never reach the DOM as markup.
 */
export function transcriptText(markdown: string): string {
  return markdown.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
