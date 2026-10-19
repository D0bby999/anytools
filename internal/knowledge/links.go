package knowledge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	feedconn "github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/security"
)

// links.go — a web page or a YouTube video as a knowledge-base document
// (learning-depth phase 4).
//
// A link becomes a document the way an upload does: its bytes are stored as
// the original, and parse_document chunks and embeds them. What differs is
// where the bytes come from and that a link is identified by its URL:
//
//   - a web page is fetched through security.FetchPage (5 MB, HTML or PDF,
//     the fetch guard's redirect cap), after robots.txt, and may re-sync;
//   - a video's original is its TRANSCRIPT (youtube.Transcript as JSON). It
//     comes from the video's own captions, from the learner's Gemini key
//     reading the public URL, or from a subtitle file or paste — in that
//     order. With none of them yet the video rests in needs_transcript.

// MaxAutoSyncLinks caps a user's auto-syncing pages: each one can re-embed
// on the learner's key every day.
const MaxAutoSyncLinks = 20

// WeeklyAfterChanges is how many consecutive changed syncs drop a page to a
// weekly re-sync.
const WeeklyAfterChanges = 3

// TranscriptMIME is the stored type of a video's original.
const TranscriptMIME = "application/vnd.longplay.transcript+json"

// pendingMIME is a video with no transcript yet (the phase's design: sha256
// of the canonical URL, 0 bytes, text/vtt, replaced when a transcript comes).
const pendingMIME = "text/vtt"

// transcriptObjects is the blob.ObjectStore namespace for a transcription's
// per-window results, kept until the whole transcript is assembled.
const transcriptObjects = "transcripts"

// maxWindows is the most windows a transcription has (youtube.Windows:
// MaxTranscribeSeconds in 20-minute windows).
const maxWindows = 12

// ErrAutoSyncLimit refuses a 21st auto-syncing link.
var ErrAutoSyncLimit = fmt.Errorf("you can auto-sync at most %d links; turn one off first", MaxAutoSyncLinks)

// LinkError is a refusal whose message is written for the learner. Code is
// stable for the API; Msg never carries anything a site or a provider sent.
type LinkError struct {
	Code  string
	Msg   string
	cause error
}

func (e *LinkError) Error() string { return e.Msg }
func (e *LinkError) Unwrap() error { return e.cause }

// LinkError codes.
const (
	LinkBadURL         = "bad_url"
	LinkRobots         = "robots"
	LinkFetchFailed    = "fetch_failed"
	LinkTooLarge       = "too_large"
	LinkUnsupported    = "unsupported_type"
	LinkBusy           = "busy"
	LinkNotVideo       = "not_video"
	LinkNoTranscriber  = "no_transcriber"
	LinkBadTranscript  = "bad_transcript"
	LinkCaptionsFailed = "captions_failed"
)

func linkErr(code, msg string, cause error) error {
	return &LinkError{Code: code, Msg: msg, cause: cause}
}

// LinkContent is a link's new content, for LinkStore.ReplaceLinkContent.
type LinkContent struct {
	Title            string
	MIME             string
	Bytes            int64
	SHA256           string
	PageCount        int
	Timeline         [][2]int
	TranscriptSource string
	Media            *VideoMedia
	ProcessedBy      ProcessedBy
	// From are the statuses the row may be moved out of.
	From []string
}

// SyncResult is one re-sync's outcome.
type SyncResult struct {
	At      time.Time
	Changed bool
	Err     string
}

// LinkStore is the persistence links need. A separate surface from Store, as
// drive_import.go's ExternalDocuments is: widening Store would oblige every
// fake to grow methods it has no use for.
type LinkStore interface {
	CreateLinkDocument(ctx context.Context, d Document) (*Document, error)
	SetAutoSync(ctx context.Context, userID, docID uuid.UUID, on bool) (*Document, error)
	ReplaceLinkContent(ctx context.Context, userID, docID uuid.UUID, c LinkContent) (*Document, error)
	SetVideoMedia(ctx context.Context, userID, docID uuid.UUID, m VideoMedia) error
	RecordSync(ctx context.Context, userID, docID uuid.UUID, r SyncResult) error
	BeginTranscription(ctx context.Context, userID, docID uuid.UUID) error
	MarkNeedsTranscript(ctx context.Context, userID, docID uuid.UUID, reason string) error
	DueWebSyncs(ctx context.Context, daily, weekly time.Time, limit int) ([]Document, error)
}

// VideoTranscribers is the learner's Gemini transcription through their own
// parse route. Wired to byok in internal/app; this package never sees a key.
type VideoTranscribers interface {
	// TranscriberAvailable reports whether the parse route holds a Gemini
	// API-key connection.
	TranscriberAvailable(ctx context.Context, userID uuid.UUID) (bool, error)
	// TranscribeWindow runs one window. billed counts the provider calls
	// made, even when it fails: a call that errored may still have cost.
	TranscribeWindow(ctx context.Context, userID uuid.UUID, videoID string, w youtube.Window) (part *youtube.Part, billed int, err error)
}

// LinkConfig turns links on. Nil in a Config leaves them off.
type LinkConfig struct {
	Store LinkStore
	// Fetch is security.FetchClient in production; tests aim it at a fixture.
	Fetch        *http.Client
	YouTube      *youtube.Client
	Transcribers VideoTranscribers
	// Audio, AudioTranscribers and Builtin are the engines that hear audio
	// (up-methods phase 21, transcribe_engines.go). Each may be nil: without
	// them a video is transcribed by Gemini reading its URL, as before.
	Audio             *AudioTools
	AudioTranscribers AudioTranscribers
	Builtin           *BuiltinSTT
	// FileTranscribers is the learner's Gemini key hearing an uploaded
	// recording through Gemini's Files API (up-methods phase 15). Nil leaves
	// Gemini off for recordings; the other engines still hear them.
	FileTranscribers FileTranscribers
	// Jobs finds and cancels a document's running transcription.
	Jobs    TranscriptionJobs
	Objects blob.ObjectStore
	Now     func() time.Time
}

// ErrLinksUnavailable is returned when links are not wired.
var ErrLinksUnavailable = errors.New("knowledge: links are not configured")

func (s *Service) linkDeps() (*LinkConfig, error) {
	if s.links == nil || s.links.Store == nil {
		return nil, ErrLinksUnavailable
	}
	return s.links, nil
}

func (s *Service) now() time.Time {
	if s.links != nil && s.links.Now != nil {
		return s.links.Now()
	}
	return time.Now()
}

// ───────────────────────────────────────────────────────── add a link

// AddLink turns a URL into a document: a YouTube link into a video, any
// other https URL into a web page.
func (s *Service) AddLink(ctx context.Context, userID, kbID uuid.UUID, raw string, autoSync bool) (*UploadResult, error) {
	if _, err := s.linkDeps(); err != nil {
		return nil, err
	}
	raw = strings.TrimSpace(raw)
	if len(raw) > 2048 {
		return nil, linkErr(LinkBadURL, "that link is too long", nil)
	}
	if youtube.IsYouTubeHost(raw) {
		id, ok := youtube.ParseURL(raw)
		if !ok {
			// A playlist, a channel or a handle is a feed to pick videos
			// from (up-methods phase 17). A watch link naming a video stays
			// that video, even inside a playlist.
			if target, isFeed := feedconn.RecognizeYouTube(raw); isFeed {
				if autoSync {
					return nil, linkErr(LinkBadURL, "only web pages can auto-sync", nil)
				}
				return s.addYouTubeFeed(ctx, userID, kbID, target)
			}
			return nil, linkErr(LinkBadURL, "that YouTube link does not name a video", nil)
		}
		if autoSync {
			return nil, linkErr(LinkBadURL, "only web pages can auto-sync", nil)
		}
		return s.addVideo(ctx, userID, kbID, id)
	}
	return s.addWeb(ctx, userID, kbID, raw, autoSync)
}

// canonicalWebURL is how a page is identified: https only, host lowercased,
// fragment dropped, an empty path made "/".
func canonicalWebURL(raw string) (*url.URL, error) {
	u, err := security.CheckFetchURL(raw)
	if err != nil {
		return nil, linkErr(LinkBadURL, "that address cannot be fetched", err)
	}
	if u.Scheme != "https" {
		return nil, linkErr(LinkBadURL, "only https links can be added", nil)
	}
	u.Host = strings.ToLower(u.Host)
	u.Host = strings.TrimSuffix(u.Host, ":443")
	u.Fragment, u.RawFragment = "", ""
	if u.Path == "" {
		u.Path = "/"
	}
	return u, nil
}

// webPage is a fetched and validated page.
type webPage struct {
	data      []byte
	mime      string
	pageCount int
	title     string
}

var webTypes = []string{"text/html", "application/xhtml+xml", "application/pdf"}

// fetchWeb reads a page with robots.txt, the fetch limits and the upload
// checks. userInitiated decides what an unreachable robots.txt means.
func (s *Service) fetchWeb(ctx context.Context, u *url.URL, userInitiated bool) (*webPage, error) {
	got, err := s.fetchLink(ctx, u, userInitiated, webTypes, "text/html,application/xhtml+xml,application/pdf;q=0.9")
	if err != nil {
		return nil, err
	}
	return s.webPageFrom(u, got)
}

// fetchLink is the fetch under fetchWeb: robots.txt, then FetchPage with
// the given types.
func (s *Service) fetchLink(ctx context.Context, u *url.URL, userInitiated bool, types []string, accept string) (*security.Page, error) {
	client := s.links.Fetch
	ok, err := robotsAllows(ctx, client, u)
	if err != nil && !userInitiated {
		return nil, linkErr(LinkRobots, "the site's robots.txt could not be read, so this sync was skipped", err)
	}
	if err == nil && !ok {
		return nil, linkErr(LinkRobots, "the site's robots.txt asks tools like AnyTools not to read this page", nil)
	}

	got, err := security.FetchPage(ctx, client, security.PageRequest{
		URL:       u.String(),
		Accept:    accept,
		UserAgent: linkUserAgent,
		Types:     types,
	})
	if err != nil {
		return nil, fetchLinkError(err)
	}
	return got, nil
}

// webPageFrom checks a fetched page as an upload would be.
func (s *Service) webPageFrom(u *url.URL, got *security.Page) (*webPage, error) {
	filename := "page.html"
	if got.MediaType == "application/pdf" {
		filename = "page.pdf"
	}
	_, mime, pages, err := s.checkFile(filename, got.Body)
	if err != nil {
		if errors.Is(err, parse.ErrPageCapExceeded) {
			return nil, linkErr(LinkTooLarge, err.Error(), err)
		}
		return nil, linkErr(LinkUnsupported, "that page could not be read as HTML or PDF", err)
	}

	title := ""
	if got.MediaType != "application/pdf" {
		title = htmlTitle(got.Body)
	}
	if title == "" {
		title = u.Host + strings.TrimSuffix(u.Path, "/")
		if base := path.Base(u.Path); got.MediaType == "application/pdf" && base != "/" && base != "." {
			title = base
		}
	}
	return &webPage{data: got.Body, mime: mime, pageCount: pages, title: documentTitle(title)}, nil
}

func fetchLinkError(err error) error {
	var status *security.HTTPStatusError
	switch {
	case errors.Is(err, security.ErrPageTooLarge):
		return linkErr(LinkTooLarge, "that page is larger than 5 MB", err)
	case errors.Is(err, security.ErrPageType):
		return linkErr(LinkUnsupported, "only HTML pages and PDFs can be added", err)
	case errors.Is(err, security.ErrFetchURL), security.IsInternalAddress(err):
		return linkErr(LinkBadURL, "that address is not on the public internet", err)
	case errors.As(err, &status):
		return linkErr(LinkFetchFailed, fmt.Sprintf("the site answered HTTP %d", status.Status), err)
	case strings.Contains(err.Error(), "stopped after"):
		return linkErr(LinkFetchFailed, "the page redirected too many times", err)
	}
	return linkErr(LinkFetchFailed, "the site could not be reached", err)
}

var titlePattern = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

func htmlTitle(data []byte) string {
	head := data
	if len(head) > 256<<10 {
		head = head[:256<<10]
	}
	m := titlePattern.FindSubmatch(head)
	if m == nil {
		return ""
	}
	return strings.Join(strings.Fields(html.UnescapeString(string(m[1]))), " ")
}

func (s *Service) addWeb(ctx context.Context, userID, kbID uuid.UUID, raw string, autoSync bool) (*UploadResult, error) {
	u, err := canonicalWebURL(raw)
	if err != nil {
		return nil, err
	}
	// A podcast feed is recognised by what the address serves (up-methods
	// phase 17); only with feeds wired is a feed's type accepted at all.
	types, accept := webTypes, "text/html,application/xhtml+xml,application/pdf;q=0.9"
	if s.feeds != nil {
		types = append(append([]string{}, webTypes...), feedconn.FeedTypes...)
		accept += ",application/rss+xml,application/atom+xml,application/xml;q=0.8"
	}
	got, err := s.fetchLink(ctx, u, true, types, accept)
	if err != nil {
		return nil, err
	}
	if feedconn.IsFeedType(got.MediaType) {
		if autoSync {
			return nil, linkErr(LinkBadURL, "only web pages can auto-sync", nil)
		}
		return s.addPodcastFeed(ctx, userID, kbID, u, got.Body)
	}
	page, err := s.webPageFrom(u, got)
	if err != nil {
		return nil, err
	}
	digest, err := s.blobs.PutOriginal(ctx, userID, page.data)
	if err != nil {
		return nil, err
	}
	now := s.now()
	doc, err := s.links.Store.CreateLinkDocument(ctx, Document{
		UserID: userID, KBID: kbID, SourceKind: SourceWeb, SourceURL: u.String(),
		Title: page.title, MIME: page.mime, Bytes: int64(len(page.data)), SHA256: digest,
		PageCount: page.pageCount, AutoSync: autoSync, LastSyncedAt: &now,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, userID, digest)
		return nil, err
	}
	return s.queueParse(ctx, doc)
}

// queueParse enqueues parse_document for a link, with Upload's handling of a
// failed enqueue.
func (s *Service) queueParse(ctx context.Context, doc *Document) (*UploadResult, error) {
	jobID, err := s.jobs.Enqueue(ctx, doc.UserID, "parse_document",
		ParseJobPayload{DocumentID: doc.ID, KBID: doc.KBID}, 3)
	if err != nil {
		slog.Error("knowledge: could not queue a link for processing", "error", err, "document", doc.ID)
		_ = s.store.SetDocumentStatus(ctx, doc.UserID, doc.ID, StatusFailed,
			"this link could not be queued for processing. Try again.")
		return nil, err
	}
	s.events.PublishStatus(doc.UserID, doc.KBID, doc.ID, StatusQueued, "", nil)
	return &UploadResult{Document: doc, JobID: jobID}, nil
}

// captionFetchBudget bounds the synchronous caption attempt in "Add a link".
const captionFetchBudget = 45 * time.Second

func (s *Service) addVideo(ctx context.Context, userID, kbID uuid.UUID, id string) (*UploadResult, error) {
	watch := youtube.WatchURL(id)
	title := "YouTube video " + id
	media := &VideoMedia{}

	yt := s.links.YouTube
	var transcript *youtube.Transcript
	if yt != nil {
		fetchCtx, cancel := context.WithTimeout(ctx, captionFetchBudget)
		defer cancel()
		if meta, err := yt.OEmbed(fetchCtx, id); err == nil && meta.Title != "" {
			title, media.Channel = meta.Title, meta.Channel
		}
		got, err := yt.FetchTranscript(fetchCtx, id, "")
		applyVideo(media, got)
		if got != nil && got.Video != nil && got.Video.Title != "" && strings.HasPrefix(title, "YouTube video ") {
			title = got.Video.Title
		}
		if err == nil && got != nil && got.Transcript != nil {
			transcript = got.Transcript
		} else {
			media.CaptionError = captionReason(err)
		}
	} else {
		media.CaptionError = youtube.ReasonNetwork
	}

	if transcript == nil {
		// No content yet. The digest is the URL's, so two blocked videos in
		// one knowledge base are two rows (red team SF-12), and the row says
		// why the learner is being asked for a transcript.
		doc, err := s.links.Store.CreateLinkDocument(ctx, Document{
			UserID: userID, KBID: kbID, SourceKind: SourceYouTube, SourceURL: watch, MediaID: id,
			Title: documentTitle(title), MIME: pendingMIME, Bytes: 0, SHA256: blob.Digest([]byte(watch)),
			Status: StatusNeedsTranscript, Error: captionSentence(media.CaptionError), Media: media,
		})
		if err != nil {
			return nil, err
		}
		s.events.PublishStatus(userID, kbID, doc.ID, StatusNeedsTranscript, doc.Error, nil)
		return &UploadResult{Document: doc}, nil
	}

	media.Language, media.AutoCaptions = transcript.Language, transcript.Auto
	stored, err := s.prepareTranscript(ctx, userID, transcript)
	if err != nil {
		return nil, err
	}
	pb, _ := json.Marshal(ProcessedBy{Parser: "youtube:captions", Note: "the video's own captions"})
	doc, err := s.links.Store.CreateLinkDocument(ctx, Document{
		UserID: userID, KBID: kbID, SourceKind: SourceYouTube, SourceURL: watch, MediaID: id,
		Title: documentTitle(title), MIME: TranscriptMIME, Bytes: stored.bytes, SHA256: stored.digest,
		PageCount: stored.index.Pages, Timeline: stored.index.Timeline,
		TranscriptSource: TranscriptCaptions, Media: media, ProcessedBy: pb,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, userID, stored.digest)
		return nil, err
	}
	return s.queueParse(ctx, doc)
}

// applyVideo copies what the player said into the stored media facts.
func applyVideo(m *VideoMedia, got *youtube.Fetched) {
	if got == nil || got.Video == nil {
		return
	}
	m.DurationSeconds = got.Video.DurationSeconds
	m.Description, m.Chapters = got.Video.Description, got.Video.Chapters
	m.Tracks = m.Tracks[:0]
	for _, t := range got.Video.Tracks {
		m.Tracks = append(m.Tracks, CaptionTrack{Lang: t.Lang, Name: t.Name, Auto: t.Auto})
	}
	if m.Channel == "" {
		m.Channel = got.Video.Channel
	}
}

func captionReason(err error) string {
	var fe *youtube.FetchError
	if errors.As(err, &fe) {
		return fe.Reason
	}
	if err != nil {
		return youtube.ReasonNetwork
	}
	return youtube.ReasonNoCaptions
}

// captionSentence is the needs_transcript row's error, per reason.
func captionSentence(reason string) string {
	switch reason {
	case youtube.ReasonBlocked:
		return "YouTube did not let this server read the captions."
	case youtube.ReasonGated:
		return "YouTube now protects this video's captions, so the server could not read them."
	case youtube.ReasonNoCaptions:
		return "This video has no captions."
	case youtube.ReasonUnplayable:
		return "YouTube says this video is not publicly playable."
	}
	return "YouTube could not be reached to read the captions."
}

// ─────────────────────────────────────────────────────────── transcripts

// storedTranscript is a transcript written as a document's original.
type storedTranscript struct {
	digest string
	bytes  int64
	index  *youtube.Indexed
}

func (s *Service) prepareTranscript(ctx context.Context, userID uuid.UUID, t *youtube.Transcript) (*storedTranscript, error) {
	ix, err := youtube.Index(t)
	if err != nil {
		return nil, linkErr(LinkBadTranscript, err.Error(), err)
	}
	data, err := json.Marshal(t)
	if err != nil {
		return nil, err
	}
	digest, err := s.blobs.PutOriginal(ctx, userID, data)
	if err != nil {
		return nil, err
	}
	return &storedTranscript{digest: digest, bytes: int64(len(data)), index: ix}, nil
}

// TranscriptInput is a transcript the learner supplies, or a caption track
// they picked. Exactly one of the three is set.
type TranscriptInput struct {
	Filename string
	Data     []byte
	Text     string
	Track    string
}

// resting are the statuses a transcript may replace.
var resting = []string{StatusReady, StatusFailed, StatusNeedsTranscript}

// SetTranscript replaces a video's transcript with an uploaded subtitle file,
// a paste, or another caption track, and re-indexes it.
func (s *Service) SetTranscript(ctx context.Context, userID, docID uuid.UUID, in TranscriptInput) (*UploadResult, error) {
	if _, err := s.linkDeps(); err != nil {
		return nil, err
	}
	doc, err := s.videoAtRest(ctx, userID, docID)
	if err != nil {
		return nil, err
	}

	var t *youtube.Transcript
	source, pb := TranscriptLearner, ProcessedBy{Parser: "learner", Note: "a transcript you supplied"}
	media := doc.Media
	if media == nil {
		media = &VideoMedia{}
	}
	switch {
	case in.Track != "" && doc.SourceKind == SourceMedia:
		return nil, linkErr(LinkBadTranscript, "an uploaded recording has no caption tracks; send a subtitle file or paste the transcript", nil)
	case in.Track != "":
		if s.links.YouTube == nil {
			return nil, linkErr(LinkCaptionsFailed, captionSentence(youtube.ReasonNetwork), nil)
		}
		fetchCtx, cancel := context.WithTimeout(ctx, captionFetchBudget)
		defer cancel()
		got, err := s.links.YouTube.FetchTranscript(fetchCtx, doc.MediaID, in.Track)
		applyVideo(media, got)
		if err != nil || got.Transcript == nil {
			return nil, linkErr(LinkCaptionsFailed, captionSentence(captionReason(err)), err)
		}
		t = got.Transcript
		source, pb = TranscriptCaptions, ProcessedBy{Parser: "youtube:captions", Note: "the video's own captions"}
	case len(in.Data) > 0:
		cues, err := youtube.ParseSubtitles(in.Filename, in.Data)
		if err != nil {
			return nil, linkErr(LinkBadTranscript, err.Error(), err)
		}
		t = &youtube.Transcript{Timed: true, Cues: cues}
	case strings.TrimSpace(in.Text) != "":
		t, err = youtube.ParsePasted(in.Text)
		if err != nil {
			return nil, linkErr(LinkBadTranscript, err.Error(), err)
		}
	default:
		return nil, linkErr(LinkBadTranscript, "send a .vtt or .srt file, a pasted transcript, or a track", nil)
	}
	media.CaptionError = ""
	media.Language, media.AutoCaptions = t.Language, t.Auto
	return s.storeTranscript(ctx, doc, t, source, pb, media, resting)
}

// storeTranscript writes a transcript as the video's new content and queues
// the parse that indexes it.
func (s *Service) storeTranscript(ctx context.Context, doc *Document, t *youtube.Transcript,
	source string, pb ProcessedBy, media *VideoMedia, from []string) (*UploadResult, error) {
	stored, err := s.prepareTranscript(ctx, doc.UserID, t)
	if err != nil {
		return nil, err
	}
	updated, err := s.links.Store.ReplaceLinkContent(ctx, doc.UserID, doc.ID, LinkContent{
		MIME: TranscriptMIME, Bytes: stored.bytes, SHA256: stored.digest,
		PageCount: stored.index.Pages, Timeline: stored.index.Timeline,
		TranscriptSource: source, Media: media, ProcessedBy: pb, From: from,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, doc.UserID, stored.digest)
		if errors.Is(err, ErrDocumentFinal) {
			return nil, linkErr(LinkBusy, "this video is still being processed; try again when it finishes", err)
		}
		return nil, err
	}
	if doc.SHA256 != stored.digest {
		s.dropOriginalIfUnused(ctx, doc.UserID, doc.SHA256)
	}
	return s.queueParse(ctx, updated)
}

// videoAtRest reads a video that nothing is working on.
func (s *Service) videoAtRest(ctx context.Context, userID, docID uuid.UUID) (*Document, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if !doc.Timed() {
		return nil, linkErr(LinkNotVideo, "that document is not a video or a recording", nil)
	}
	for _, st := range resting {
		if doc.Status == st {
			return doc, nil
		}
	}
	return nil, linkErr(LinkBusy, "this video is still being processed; try again when it finishes", nil)
}

// TranscriptCues reads a video's stored transcript, for the reading tutor's
// window around the playhead.
func (s *Service) TranscriptCues(ctx context.Context, userID, docID uuid.UUID) (*youtube.Transcript, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if !doc.Timed() || doc.MIME != TranscriptMIME {
		return nil, ErrNoParsedContent
	}
	data, err := s.blobs.GetOriginal(ctx, userID, doc.SHA256)
	if err != nil {
		return nil, err
	}
	var t youtube.Transcript
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, fmt.Errorf("knowledge: stored transcript: %w", err)
	}
	return &t, nil
}

// ─────────────────────────────────────────────── transcription (a job)

// TranscribeEstimate is what the page shows before the learner transcribes.
type TranscribeEstimate struct {
	// Available: at least one engine can start now.
	Available       bool `json:"available"`
	DurationSeconds int  `json:"duration_seconds"`
	EstimatedTokens int  `json:"estimated_tokens"`
	Windows         int  `json:"windows"`
	// Engines are every engine the learner can use, each with its cost
	// (up-methods phase 21).
	Engines []EngineOption `json:"engines"`
	// AudioBlocked: the last attempt to fetch this video's audio was refused
	// by YouTube, so an engine that downloads may be refused again.
	AudioBlocked bool `json:"audio_blocked,omitempty"`
	// QueueAhead is how many built-in jobs run before this video's, while it
	// waits for the built-in engine.
	QueueAhead *int `json:"queue_ahead,omitempty"`
}

// EstimateTranscription lists the engines that could transcribe the video and
// what each would cost (Gemini: duration × 100 tokens a second, the
// documented low-resolution rate; OpenAI and Groq: minutes of audio; the
// built-in engine: its time on this server). An unknown duration estimates
// nothing rather than guessing.
func (s *Service) EstimateTranscription(ctx context.Context, userID uuid.UUID, doc *Document) (*TranscribeEstimate, error) {
	est := &TranscribeEstimate{Engines: []EngineOption{}}
	if doc.Media != nil {
		est.DurationSeconds = doc.Media.DurationSeconds
	}
	est.EstimatedTokens = est.DurationSeconds * tokensPerSecond(doc)
	if w, err := youtube.Windows(est.DurationSeconds); err == nil {
		est.Windows = len(w)
	}
	opts, err := s.engineOptions(ctx, userID, doc)
	if err != nil {
		return nil, err
	}
	est.Engines = append(est.Engines, opts...)
	for _, o := range opts {
		est.Available = est.Available || o.Usable
	}
	est.AudioBlocked = doc.SourceKind == SourceYouTube && doc.Status == StatusNeedsTranscript &&
		strings.HasPrefix(doc.Error, ErrAudioBlockedSentence)
	if b := s.links.builtin(); b != nil && b.Ahead != nil && doc.Status == StatusParsing {
		if n, ok, err := b.Ahead(ctx, userID, doc.ID); err == nil && ok {
			est.QueueAhead = &n
		}
	}
	return est, nil
}

func (c *LinkConfig) builtin() *BuiltinSTT {
	if c == nil {
		return nil
	}
	return c.Builtin
}

// StartTranscription queues an AI transcript by the learner's Gemini key, the
// one engine there was before up-methods phase 21.
func (s *Service) StartTranscription(ctx context.Context, userID, docID uuid.UUID) (uuid.UUID, error) {
	start, err := s.StartTranscriptionBy(ctx, userID, docID, EngineChoice{Engine: EngineGemini})
	if err != nil {
		return uuid.Nil, err
	}
	return start.JobID, nil
}

// StartTranscriptionBy queues a transcript of a video that has none, by the
// engine the learner chose.
func (s *Service) StartTranscriptionBy(ctx context.Context, userID, docID uuid.UUID, choice EngineChoice) (*TranscriptionStart, error) {
	deps, err := s.linkDeps()
	if err != nil {
		return nil, err
	}
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	// The engine before the document's state: an id in the body that is not
	// the caller's answers 404 whatever the video is doing.
	engine, err := s.resolveEngine(ctx, userID, doc, choice)
	if err != nil {
		return nil, err
	}
	if !doc.Timed() {
		return nil, linkErr(LinkNotVideo, "that document is not a video or a recording", nil)
	}
	if doc.Status != StatusNeedsTranscript && doc.Status != StatusFailed {
		return nil, linkErr(LinkBusy, "this video already has a transcript or is being processed", nil)
	}
	duration := 0
	if doc.Media != nil {
		duration = doc.Media.DurationSeconds
	}
	if _, err := youtube.Windows(duration); err != nil {
		return nil, linkErr(LinkTooLarge, err.Error(), err)
	}
	if !engine.Usable {
		code := LinkSTTQuota
		if duration <= 0 {
			code = LinkDurationUnknown
		}
		return nil, linkErr(code, engine.Reason, nil)
	}
	// A recording whose header did not say how long it is: the cost is not
	// known in advance, so the learner confirms first (up-methods phase 15).
	file := doc.SourceKind == SourceMedia
	if file && duration <= 0 && !choice.LengthConfirmed {
		return nil, linkErr(LinkDurationUnknown, unknownLengthSentence, nil)
	}

	p := TranscribeJobPayload{DocumentID: docID, DurationSeconds: duration, Engine: engine.Engine, File: file}
	kind := jobKindTranscribeVideo
	switch engine.Engine {
	case EngineBYOK:
		p.ConnectionID, p.Provider = *engine.ConnectionID, engine.Provider
	case EngineBuiltin:
		kind = jobKindTranscribeBuiltin
		// Booked by length, in one statement: two jobs at once cannot both
		// take the day's last minutes.
		day, err := s.bookBuiltin(ctx, userID, duration)
		if err != nil {
			return nil, err
		}
		p.ChargedDay, p.ChargedSeconds = day, duration
	case EngineGemini:
		if !file {
			p.Engine = "" // the payload a pre-phase-21 job carried
		}
	}
	refund := func() { s.refundBuiltin(ctx, userID, p.ChargedDay, p.ChargedSeconds) }

	if err := deps.Store.BeginTranscription(ctx, userID, docID); err != nil {
		refund()
		if errors.Is(err, ErrDocumentFinal) {
			return nil, linkErr(LinkBusy, "this video is already being transcribed", err)
		}
		return nil, err
	}
	// Two attempts, resumable per window (jobs.RunUnits): a retry never pays
	// for a window twice.
	jobID, err := s.jobs.Enqueue(ctx, userID, kind, p, 2)
	if err != nil {
		refund()
		_ = deps.Store.MarkNeedsTranscript(ctx, userID, docID, "the transcription could not be queued. Try again.")
		return nil, err
	}
	s.events.PublishStatus(userID, doc.KBID, docID, StatusParsing, "", nil)
	start := &TranscriptionStart{JobID: jobID, Engine: engine.Engine}
	if b := deps.Builtin; kind == jobKindTranscribeBuiltin && b != nil && b.Ahead != nil {
		if n, ok, err := b.Ahead(ctx, userID, docID); err == nil && ok {
			start.QueueAhead = n
		}
	}
	return start, nil
}

// The job kinds, as internal/jobs names them (this package does not import
// the queue).
const (
	jobKindTranscribeVideo   = "transcribe_video"
	jobKindTranscribeBuiltin = "transcribe_builtin"
)

// TranscriptionWindows plans a transcribe_video job, or says it has nothing
// left to do: a document deleted or settled meanwhile is terminal.
func (s *Service) TranscriptionWindows(ctx context.Context, userID uuid.UUID, p TranscribeJobPayload) ([]youtube.Window, error) {
	doc, err := s.store.GetDocument(ctx, userID, p.DocumentID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			return nil, errTerminal{err}
		}
		return nil, err
	}
	if doc.SourceKind != SourceYouTube || p.File || doc.Status != StatusParsing {
		return nil, errTerminal{errors.New("knowledge: the video is no longer waiting for a transcript")}
	}
	w, err := youtube.Windows(p.DurationSeconds)
	if err != nil {
		return nil, errTerminal{err}
	}
	return w, nil
}

func windowObject(docID uuid.UUID, i int) uuid.UUID {
	return uuid.NewSHA1(docID, []byte(fmt.Sprintf("window-%d", i)))
}

// TranscribeWindow is one unit of the job: one billed call, whose result is
// stored before it returns so a retry resumes after it.
func (s *Service) TranscribeWindow(ctx context.Context, userID uuid.UUID, p TranscribeJobPayload, i int, w youtube.Window) (int, error) {
	deps, err := s.linkDeps()
	if err != nil || deps.Transcribers == nil || deps.Objects == nil {
		return 0, errTerminal{ErrLinksUnavailable}
	}
	doc, err := s.store.GetDocument(ctx, userID, p.DocumentID)
	if err != nil {
		return 0, err
	}
	part, billed, err := deps.Transcribers.TranscribeWindow(ctx, userID, doc.MediaID, w)
	if err != nil {
		return billed, err
	}
	raw, err := json.Marshal(part)
	if err != nil {
		return billed, err
	}
	return billed, deps.Objects.PutObject(ctx, userID, transcriptObjects, windowObject(p.DocumentID, i), raw)
}

// FinishTranscription assembles the windows into the video's transcript.
func (s *Service) FinishTranscription(ctx context.Context, userID uuid.UUID, p TranscribeJobPayload, windows int) error {
	deps, err := s.linkDeps()
	if err != nil || deps.Objects == nil {
		return errTerminal{ErrLinksUnavailable}
	}
	doc, err := s.store.GetDocument(ctx, userID, p.DocumentID)
	if err != nil {
		return err
	}
	parts := make([]*youtube.Part, 0, windows)
	model, engine := "", ""
	for i := 0; i < windows; i++ {
		raw, err := deps.Objects.GetObject(ctx, userID, transcriptObjects, windowObject(p.DocumentID, i))
		if err != nil {
			return err
		}
		var part youtube.Part
		if err := json.Unmarshal(raw, &part); err != nil {
			return err
		}
		model, engine = part.Model, part.Engine
		parts = append(parts, &part)
	}
	t, err := youtube.Merge(parts)
	if err != nil {
		return errTerminal{err}
	}
	media := doc.Media
	if media == nil {
		media = &VideoMedia{}
	}
	media.CaptionError, media.Language, media.AutoCaptions = "", t.Language, false
	_, err = s.storeTranscript(ctx, doc, t, TranscriptAI, engineProcessedBy(engine, model), media, []string{StatusParsing})
	if err != nil {
		return err
	}
	s.dropWindows(ctx, userID, p.DocumentID, windows)
	return nil
}

// FailTranscription settles a transcription that will not be retried, with a
// sentence the learner can act on, and returns the error the job reports.
func (s *Service) FailTranscription(ctx context.Context, userID uuid.UUID, p TranscribeJobPayload, cause error, terminal bool, attempt Attempt) error {
	if deps, err := s.linkDeps(); err == nil && (terminal || attempt.IsLast()) {
		sentence := transcriptionSentence(cause)
		switch {
		case p.File:
			sentence = recordingSentence(p.Engine, cause)
		case p.Engine == EngineBuiltin || p.Engine == EngineBYOK:
			sentence = audioSentence(p.Engine, cause)
		}
		if err := deps.Store.MarkNeedsTranscript(ctx, userID, p.DocumentID, sentence); err != nil {
			slog.Warn("knowledge: could not settle a failed transcription", "document", p.DocumentID, "error", err)
		}
		s.dropWindows(ctx, userID, p.DocumentID, maxWindows)
	}
	if terminal {
		return errTerminal{cause}
	}
	return cause
}

// TranscriptionRefused reports a failure retrying cannot fix: the provider
// refused the request (a private video, a bad key), not a rate limit or a blip.
func TranscriptionRefused(err error) bool {
	var he *providers.HTTPError
	return errors.As(err, &he) && he.Status >= 400 && he.Status < 500 && he.Status != 429
}

func transcriptionSentence(err error) string {
	var he *providers.HTTPError
	switch {
	case errors.As(err, &he) && he.Status == 429:
		return "Gemini's limit was reached (the free tier transcribes up to 8 hours of video a day). Try again later, or upload subtitles."
	case errors.As(err, &he) && (he.Status == 401 || he.Status == 403):
		return "Gemini refused the request. Check the key on your Parse route, or upload subtitles."
	case errors.As(err, &he) && he.Status >= 400 && he.Status < 500:
		return "Gemini could not read this video. Only public videos can be transcribed; upload subtitles or paste the transcript instead."
	case errors.Is(err, youtube.ErrTranscriptTooLarge):
		return youtube.ErrTranscriptTooLarge.Error() + "."
	case errors.Is(err, youtube.ErrNoTranscript), errors.Is(err, youtube.ErrEmptyTranscript):
		return "Gemini returned no usable transcript. Try again, or upload subtitles."
	case err != nil && err.Error() == "cancelled":
		return "The transcription was cancelled."
	}
	return "The AI transcript could not be made. Try again, or upload subtitles or paste the transcript."
}

func (s *Service) dropWindows(ctx context.Context, userID, docID uuid.UUID, n int) {
	if s.links == nil || s.links.Objects == nil {
		return
	}
	for i := 0; i < n; i++ {
		_ = s.links.Objects.DeleteObject(ctx, userID, transcriptObjects, windowObject(docID, i))
	}
}

// ───────────────────────────────────────────────────────── web re-sync

// SetAutoSync turns a page's daily re-sync on or off.
func (s *Service) SetAutoSync(ctx context.Context, userID, docID uuid.UUID, on bool) (*Document, error) {
	deps, err := s.linkDeps()
	if err != nil {
		return nil, err
	}
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.SourceKind != SourceWeb {
		return nil, linkErr(LinkBadURL, "only web pages can auto-sync", nil)
	}
	return deps.Store.SetAutoSync(ctx, userID, docID, on)
}

// ResyncWeb re-fetches one page now, because the learner asked.
func (s *Service) ResyncWeb(ctx context.Context, userID, docID uuid.UUID) (*UploadResult, bool, error) {
	if _, err := s.linkDeps(); err != nil {
		return nil, false, err
	}
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, false, err
	}
	if doc.SourceKind != SourceWeb {
		return nil, false, linkErr(LinkBadURL, "only web pages can be re-synced", nil)
	}
	if doc.Status != StatusReady && doc.Status != StatusFailed {
		return nil, false, linkErr(LinkBusy, "this page is still being processed; try again when it finishes", nil)
	}
	return s.resyncWeb(ctx, doc, true)
}

// resyncWeb fetches a page and re-indexes it only when its bytes changed.
// The outcome, success or failure, is recorded on the page's own row.
func (s *Service) resyncWeb(ctx context.Context, doc *Document, userInitiated bool) (*UploadResult, bool, error) {
	record := func(changed bool, err error) {
		r := SyncResult{At: s.now(), Changed: changed}
		if err != nil {
			r.Err = syncSentence(err)
		}
		if werr := s.links.Store.RecordSync(ctx, doc.UserID, doc.ID, r); werr != nil {
			slog.Warn("knowledge: could not record a sync", "document", doc.ID, "error", werr)
		}
	}

	u, err := canonicalWebURL(doc.SourceURL)
	if err != nil {
		record(false, err)
		return nil, false, err
	}
	page, err := s.fetchWeb(ctx, u, userInitiated)
	if err != nil {
		record(false, err)
		return nil, false, err
	}
	if blob.Digest(page.data) == doc.SHA256 {
		record(false, nil)
		return &UploadResult{Document: doc}, false, nil
	}

	digest, err := s.blobs.PutOriginal(ctx, doc.UserID, page.data)
	if err != nil {
		record(false, err)
		return nil, false, err
	}
	updated, err := s.links.Store.ReplaceLinkContent(ctx, doc.UserID, doc.ID, LinkContent{
		Title: page.title, MIME: page.mime, Bytes: int64(len(page.data)), SHA256: digest,
		PageCount: page.pageCount, From: []string{StatusReady, StatusFailed},
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, doc.UserID, digest)
		if errors.Is(err, ErrDocumentFinal) {
			err = linkErr(LinkBusy, "this page is being processed", err)
		}
		record(false, err)
		return nil, false, err
	}
	record(true, nil)
	s.dropOriginalIfUnused(ctx, doc.UserID, doc.SHA256)
	res, err := s.queueParse(ctx, updated)
	return res, true, err
}

func syncSentence(err error) string {
	var le *LinkError
	if errors.As(err, &le) {
		return le.Msg
	}
	return "the page could not be re-synced"
}

// SyncReport is one pass of the daily re-sync.
type SyncReport struct {
	Checked, Changed, Failed int
}

// SyncDueWebSources re-syncs every auto-syncing page that is due, across
// users. Each page is handled on its own: a fetch, parse or constraint error
// is recorded on that page's row and the pass continues with the next one
// (red team SF-12; unlike the digest job it is modelled on, whose loop ends
// on a source error). Only a failure to LIST the due pages ends the pass.
func (s *Service) SyncDueWebSources(ctx context.Context) (SyncReport, error) {
	var rep SyncReport
	deps, err := s.linkDeps()
	if err != nil {
		return rep, err
	}
	now := s.now()
	// An hour's slack on each cutoff, so an hourly ticker does not drift the
	// sync one hour later every day.
	docs, err := deps.Store.DueWebSyncs(ctx, now.Add(-23*time.Hour), now.Add(-7*24*time.Hour+time.Hour), 200)
	if err != nil {
		return rep, err
	}
	for i := range docs {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		rep.Checked++
		_, changed, err := s.resyncWeb(ctx, &docs[i], false)
		switch {
		case err != nil:
			rep.Failed++
			slog.Info("knowledge: web sync failed for one page", "document", docs[i].ID, "error", err)
		case changed:
			rep.Changed++
		}
	}
	return rep, nil
}

// dropOriginalIfUnused deletes an original no document of the user names.
func (s *Service) dropOriginalIfUnused(ctx context.Context, userID uuid.UUID, digest string) {
	if digest == "" {
		return
	}
	if inUse, err := s.store.OriginalReferenced(ctx, userID, digest); err != nil || inUse {
		return
	}
	if err := s.blobs.DeleteOriginal(ctx, userID, digest); err != nil {
		slog.Warn("knowledge: original left behind", "error", err)
	}
}

// ErrNotFailed is Retry on a document that has not failed: one still being
// processed, or one that is ready.
var ErrNotFailed = errors.New("only a document that failed can be retried")

// Retry queues a failed document for processing again, from the original it
// already stored. A parse that failed for a reason the learner has since fixed
// (no embedding model routed, a provider that was down) otherwise left only
// "Remove" and a second upload, while its message said "then retry".
func (s *Service) Retry(ctx context.Context, userID, docID uuid.UUID) (*UploadResult, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.Status != StatusFailed || doc.SHA256 == "" {
		return nil, ErrNotFailed
	}
	if err := s.store.ResetDocumentForReprocessing(ctx, userID, doc.ID); err != nil {
		return nil, err
	}
	if doc, err = s.store.GetDocument(ctx, userID, docID); err != nil {
		return nil, err
	}
	return s.queueParse(ctx, doc)
}
