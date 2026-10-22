package knowledge

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/youtube"
)

// UserID is the authenticated subject every entity here belongs to.
type UserID = uuid.UUID

// ErrDocumentFinal reports a write refused because the document has already
// reached a terminal state.
//
// It is not an error condition for the user — it means the system already
// settled this document and a straggler tried to move it. The caller stops,
// rather than treating it as a failure to report.
var ErrDocumentFinal = errors.New("knowledge: document has already finished")

// Attempt is which try of a job this is, and how many it gets.
//
// It reaches the handler because only the handler knows whether a failure is
// worth another go, and only the QUEUE knows whether another go remains. Split
// across the two, a retryable failure on the last attempt writes a
// non-terminal status that nothing will ever move again — which is exactly the
// stuck document this subsystem exists to prevent.
type Attempt struct {
	Number int
	Max    int
}

// IsLast reports whether this is the final try.
//
// Defensive about a zero value: an Attempt that was never populated must behave
// as the last one, so a caller that forgets to pass it settles the document
// rather than leaving it queued forever.
func (a Attempt) IsLast() bool {
	if a.Max <= 0 || a.Number <= 0 {
		return true
	}
	return a.Number >= a.Max
}

// Document lifecycle. The enum is closed and matches the CHECK constraint on
// documents.status; a state not in this list cannot be written.
const (
	// StatusQueued: accepted and stored, waiting for a worker.
	StatusQueued = "queued"
	// StatusParsing: a worker holds a lease and is producing Markdown.
	StatusParsing = "parsing"
	// StatusIndexing: Markdown exists; chunks are being embedded.
	StatusIndexing = "indexing"
	// StatusReady: retrievable.
	StatusReady = "ready"
	// StatusFailed: terminal, with a reason the user can act on.
	StatusFailed = "failed"
	// StatusNeedsTranscript: a video whose captions could not be fetched. It
	// rests here, like ready and failed, until the learner uploads subtitles,
	// pastes a transcript, or asks for an AI transcript.
	StatusNeedsTranscript = "needs_transcript"
)

// Source kinds. `drive` is phase 13's; the column accepts it now so that phase
// does not need a migration to add a value to a CHECK constraint.
const (
	SourceUpload = "upload"
	SourceDrive  = "drive"
	// SourceWeb and SourceYouTube are links (learning-depth phase 4): unique
	// per knowledge base by URL, not by content hash.
	SourceWeb     = "web"
	SourceYouTube = "youtube"
	// SourceSitePage and SourceRepoFile are pages of a crawled documentation
	// site and files of a GitHub repository (up-methods phase 18): each is a
	// document of its own, grouped under a sites or repos row.
	SourceSitePage = "site_page"
	SourceRepoFile = "repo_file"
	// SourceMedia is an uploaded audio or video file (up-methods phase 15).
	// It rests in needs_transcript like a captionless video, and its
	// recording stays beside the transcript (Document.MediaSHA256).
	SourceMedia = "media"
)

// Page units: what a document's chunk page numbers count. A repository's
// code file is cited by line range.
const (
	PageUnitPage = "page"
	PageUnitLine = "line"
)

// Where a video's transcript came from. An AI transcript can mishear and its
// times are approximate, so it is labelled wherever it is shown.
const (
	TranscriptCaptions = "captions"
	TranscriptAI       = "ai_transcript"
	TranscriptLearner  = "learner"
)

// VideoMedia is documents.media for a video: display facts only. The
// thumbnail is built from the id (youtube.ThumbnailURL), never stored.
type VideoMedia struct {
	Channel         string `json:"channel,omitempty"`
	DurationSeconds int    `json:"duration_seconds,omitempty"`
	// Tracks are the caption tracks the server saw, for "pick another track".
	Tracks   []CaptionTrack `json:"tracks,omitempty"`
	Language string         `json:"language,omitempty"`
	// CaptionError is why the server could not fetch captions (a
	// youtube.Reason*), shown on the needs-transcript panel.
	CaptionError string `json:"caption_error,omitempty"`
	// AutoCaptions: the transcript is a track YouTube's speech recognition
	// wrote, not the creator's own captions.
	AutoCaptions bool `json:"auto_captions,omitempty"`
	// Description is the creator's (bounded), and Chapters are read from it
	// by YouTube's rules. Both are a stranger's text, shown as text only.
	Description string            `json:"description,omitempty"`
	Chapters    []youtube.Chapter `json:"chapters,omitempty"`
}

// CaptionTrack is one caption track a video offers.
type CaptionTrack struct {
	Lang string `json:"lang"`
	Name string `json:"name,omitempty"`
	Auto bool   `json:"auto,omitempty"`
}

// KB is a knowledge base.
type KB struct {
	ID     uuid.UUID `json:"id"`
	UserID uuid.UUID `json:"-"`
	Name   string    `json:"name"`
	// EmbeddingModel and Dims are PINNED once the first document is embedded.
	// Changing either sets NeedsReembed.
	EmbeddingModel string `json:"embedding_model"`
	Dims           int    `json:"dims"`
	FTSConfig      string `json:"fts_config"`
	// NeedsReembed blocks queries until POST /v1/kb/{id}/reindex. See
	// retrieve.ErrNeedsReembed for why this is a block and not a warning.
	NeedsReembed bool      `json:"needs_reembed"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// KBSummary is a KB with its document counts, for the list screen.
type KBSummary struct {
	KB        KB  `json:"kb"`
	Documents int `json:"documents"`
	Ready     int `json:"ready"`
	Failed    int `json:"failed"`
	Working   int `json:"working"`
}

// ProcessedBy is the provenance record stored on documents.processed_by.
//
// RT-14: the failure this makes visible is a BYOK chain that silently re-sends
// a document to the next provider when the first one 429s. Without a stored,
// displayed record, the user's data went somewhere they did not choose and
// nothing ever said so.
type ProcessedBy struct {
	// Parser is the lane: "gemini", "openai", "anthropic", or "local:…".
	Parser string `json:"parser,omitempty"`
	// Model is the specific model id, empty for local lanes.
	Model string `json:"model,omitempty"`
	// Engine names who transcribed a video (up-methods phase 21): "gemini",
	// "builtin" (this server's Whisper), or the learner's speech provider.
	Engine string `json:"engine,omitempty"`
	// Downgraded is true when the first choice in the chain was not the lane
	// that succeeded.
	Downgraded bool `json:"downgraded,omitempty"`
	// Embedder and EmbedModel record the same for the vector side.
	Embedder   string `json:"embedder,omitempty"`
	EmbedModel string `json:"embed_model,omitempty"`
	// Note carries a short human sentence, e.g. which provider was tried first
	// and why it was abandoned.
	Note string `json:"note,omitempty"`
}

// Document is one uploaded file.
type Document struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	KBID       uuid.UUID `json:"kb_id"`
	SourceKind string    `json:"source_kind"`
	Title      string    `json:"title"`
	MIME       string    `json:"mime"`
	Bytes      int64     `json:"bytes"`
	SHA256     string    `json:"sha256"`
	PageCount  int       `json:"page_count"`
	Status     string    `json:"status"`
	Error      string    `json:"error,omitempty"`
	// ErrorCode names a failure the page answers with an action of its own:
	// a parse that could not read the original from the learner's Drive
	// (drive_reconnect, drive_file_removed, drive_full), or no route to index
	// it with (no_embed_route). Derived from Error on read, never stored
	// (drive-user-storage phase 4).
	ErrorCode string `json:"error_code,omitempty"`
	// ProcessedBy is raw JSON here rather than the struct because the store
	// round-trips it and an unknown field written by a later phase must survive
	// a read-modify-write rather than being dropped.
	ProcessedBy        json.RawMessage `json:"processed_by"`
	Version            int             `json:"version"`
	ParsedMarkdownPath string          `json:"-"`
	ChunkCount         int             `json:"chunk_count"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`

	// Links (phase 4). SourceURL is the canonical URL of a web or youtube
	// document and empty for files.
	SourceURL    string     `json:"source_url,omitempty"`
	AutoSync     bool       `json:"auto_sync"`
	LastSyncedAt *time.Time `json:"last_synced_at,omitempty"`
	SyncError    string     `json:"sync_error,omitempty"`
	// SyncChanges counts consecutive syncs that found new content; at
	// WeeklyAfterChanges the page drops to a weekly re-sync.
	SyncChanges int `json:"sync_changes,omitempty"`
	// Timeline[N-1] is page N's [start, end] seconds, for a timed video.
	Timeline         [][2]int    `json:"timeline,omitempty"`
	MediaID          string      `json:"media_id,omitempty"`
	Media            *VideoMedia `json:"media,omitempty"`
	TranscriptSource string      `json:"transcript_source,omitempty"`

	// Sites and repositories (up-methods phase 18). SourcePath is a
	// repository file's path; RemovedAt is set when the page or file is no
	// longer in its site or repository.
	SiteID     *uuid.UUID `json:"site_id,omitempty"`
	RepoID     *uuid.UUID `json:"repo_id,omitempty"`
	SourcePath string     `json:"source_path,omitempty"`
	RemovedAt  *time.Time `json:"removed_at,omitempty"`
	PageUnit   string     `json:"page_unit,omitempty"`

	// An uploaded recording (up-methods phase 15). SHA256, MIME and Bytes
	// describe what parse_document reads, which for a media document is its
	// transcript once it has one; these name the recording itself, which the
	// viewer plays and a transcription reads.
	MediaSHA256 string `json:"-"`
	MediaMIME   string `json:"media_mime,omitempty"`
	MediaBytes  int64  `json:"media_bytes,omitempty"`

	// ZoteroKey is the Zotero item an upload came from (up-methods phase
	// 20); one per knowledge base. Written on create only.
	ZoteroKey string `json:"-"`
}

// Timed reports whether the document is something heard on a clock: a
// YouTube video or an uploaded recording. Both are transcribed the same ways
// and read in the same viewer.
func (d *Document) Timed() bool {
	return d.SourceKind == SourceYouTube || d.SourceKind == SourceMedia
}

// IsLink reports whether the document came from a URL.
func (d *Document) IsLink() bool {
	switch d.SourceKind {
	case SourceWeb, SourceYouTube, SourceSitePage, SourceRepoFile:
		return true
	}
	return false
}

// StoredChunk is a chunk on its way into or out of the database.
type StoredChunk struct {
	Ord         int
	HeadingPath string
	PageStart   int
	PageEnd     int
	Text        string
	// Embedding is ALREADY PADDED to embed.StorageDims when written. Dims is
	// the native width before padding, and is what a query filters on.
	Embedding []float32
	Dims      int
}

// ParseJobPayload is the body of a parse_document job.
type ParseJobPayload struct {
	DocumentID uuid.UUID `json:"document_id"`
	KBID       uuid.UUID `json:"kb_id"`
}

// TranscribeJobPayload is the body of a transcribe_video job. The duration
// is fixed when the job is queued, so a retry plans the same windows and
// resumes at the first unfinished one.
type TranscribeJobPayload struct {
	DocumentID      uuid.UUID `json:"document_id"`
	DurationSeconds int       `json:"duration_seconds"`
	// Engine is who hears it (up-methods phase 21): "" or "gemini" reads the
	// URL; "builtin" and "byok" hear the audio (transcribe_engines.go).
	Engine string `json:"engine,omitempty"`
	// ConnectionID and Provider name the byok engine's one connection. The
	// id is re-resolved on the caller's own stt route for every window.
	ConnectionID uuid.UUID `json:"connection_id,omitempty"`
	Provider     string    `json:"provider,omitempty"`
	// ChargedDay and ChargedSeconds are what the built-in allowance took at
	// start; the reaper gives back what a failed job did not use.
	ChargedDay     string `json:"charged_day,omitempty"`
	ChargedSeconds int    `json:"charged_seconds,omitempty"`
	// File: the audio is the document's own uploaded recording, not a
	// YouTube video (up-methods phase 15). With engine "gemini" it is sent
	// through Gemini's Files API rather than read from a URL.
	File bool `json:"file,omitempty"`
}

// ReindexJobPayload is the body of a reindex_kb job.
type ReindexJobPayload struct {
	KBID uuid.UUID `json:"kb_id"`
}

// NoEmbedRouteReason is the failure stored when a document reached indexing
// with no embed route. The store reads it back as error_code no_embed_route,
// which the page answers with a link to the route.
const NoEmbedRouteReason = "no embedding model is configured — add one in Settings, then retry"
