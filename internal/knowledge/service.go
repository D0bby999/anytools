package knowledge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	mediafile "github.com/D0bby999/anytools/internal/connectors/media"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/rag/chunk"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// MaxUploadBytes is the per-file upload cap.
const MaxUploadBytes = 50 << 20 // 50 MB

// MaxMediaBytes is the cap for an audio or video file (up-methods phase 15):
// an hour of podcast is about 60 MB, a recorded class on a phone several
// times that. Pinned by the documents_media_bytes_bounded CHECK.
const MaxMediaBytes = 500 << 20 // 500 MB

// UploadLimit is the cap for a file of this name: a media extension gets
// MaxMediaBytes, everything else MaxUploadBytes. The bytes still decide what
// the file is (Upload sniffs them); the name only chooses the cap the
// handler reads with.
func UploadLimit(filename string) int64 {
	if mediafile.IsMediaName(filename) {
		return MaxMediaBytes
	}
	return MaxUploadBytes
}

// EmbedBatchSize is how many chunks go to the embed route per call.
const EmbedBatchSize = 64

// Store is the persistence surface the service consumes.
type Store interface {
	CreateKB(ctx context.Context, userID uuid.UUID, name string) (*KB, error)
	ListKBs(ctx context.Context, userID uuid.UUID) ([]KBSummary, error)
	GetKB(ctx context.Context, userID, kbID uuid.UUID) (*KB, error)
	DeleteKB(ctx context.Context, userID, kbID uuid.UUID) error
	PinEmbeddingRoute(ctx context.Context, userID, kbID uuid.UUID, model string, dims int) error
	ClearNeedsReembed(ctx context.Context, userID, kbID uuid.UUID) error

	CreateDocument(ctx context.Context, d Document) (*Document, error)
	ListDocuments(ctx context.Context, userID, kbID uuid.UUID) ([]Document, error)
	GetDocument(ctx context.Context, userID, docID uuid.UUID) (*Document, error)
	SetDocumentStatus(ctx context.Context, userID, docID uuid.UUID, status, errMsg string) error
	RequeueDocument(ctx context.Context, userID, docID uuid.UUID, reason string) error
	// ResetDocumentForReprocessing is the one way out of a terminal state:
	// queued again, version + 1. Retry is its only caller here.
	ResetDocumentForReprocessing(ctx context.Context, userID, docID uuid.UUID) error
	FinishDocument(ctx context.Context, userID, docID uuid.UUID, pageCount int, pb ProcessedBy, parsedPath string) error
	RecordProcessedBy(ctx context.Context, userID, docID uuid.UUID, pb ProcessedBy) error
	DeleteDocument(ctx context.Context, userID, kbID, docID uuid.UUID) error
	ListDocumentIDs(ctx context.Context, userID, kbID uuid.UUID) ([]uuid.UUID, error)
	// OriginalReferenced reports whether any of the user's documents still
	// names this content digest.
	OriginalReferenced(ctx context.Context, userID uuid.UUID, sha256 string) (bool, error)
}

// Chunks is the chunk persistence surface.
type Chunks interface {
	ReplaceDocumentChunks(ctx context.Context, userID, kbID, docID uuid.UUID, chunks []StoredChunk) error
	DeleteDocumentChunks(ctx context.Context, userID, docID uuid.UUID) error
	ChunkTexts(ctx context.Context, userID, docID uuid.UUID) ([]StoredChunk, error)
}

// Enqueuer schedules background work.
type Enqueuer interface {
	Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error)
}

// Service is the Knowledge Center's application logic.
type Service struct {
	store     Store
	chunks    Chunks
	blobs     blob.Store
	jobs      Enqueuer
	providers Providers
	events    *Events
	batcher   *parse.Batcher
	chunkOpts chunk.Options
	// links is phase 4's web and YouTube support; nil leaves it off.
	links *LinkConfig
	// recordings deletes the recording files of worksheets attached to a
	// document before its rows go (up-methods phase 7); nil when none.
	recordings RecordingCleaner
	// sources are sites and repositories (up-methods phase 18); nil leaves
	// them off.
	sources *SourceConfig
	// feeds are podcast feeds and YouTube playlists and channels (up-methods
	// phase 17); nil leaves them off.
	feeds *FeedConfig
}

// RecordingCleaner deletes the files of the learner's recordings on
// worksheets attached to a document, or to any document of a knowledge base
// (up-methods phase 7). Deleting a document cascades to its worksheets and
// their recording rows, and nothing else would delete the files, so they go
// first. An error fails the delete with every row kept, so it can be
// retried. pg.WorksheetStore implements it.
type RecordingCleaner interface {
	DeleteDocumentRecordings(ctx context.Context, userID, documentID uuid.UUID) error
	DeleteKBRecordings(ctx context.Context, userID, kbID uuid.UUID) error
}

// SetRecordingCleaner wires the worksheet recordings' cleaner, which is built
// after the knowledge service.
func (s *Service) SetRecordingCleaner(c RecordingCleaner) { s.recordings = c }

// Config assembles a Service.
type Config struct {
	Store     Store
	Chunks    Chunks
	Blobs     blob.Store
	Jobs      Enqueuer
	Providers Providers
	Events    *Events
	Parse     parse.Options
	Chunk     chunk.Options
	// Links turns on web and YouTube links (links.go). Optional.
	Links *LinkConfig
	// Sources turns on documentation sites and GitHub repositories
	// (sources.go). Optional; needs Links.
	Sources *SourceConfig
	// Feeds turns on podcast feeds and YouTube playlists and channels
	// (feeds.go). Optional; needs Links.
	Feeds *FeedConfig
}

// NewService returns a Service.
func NewService(cfg Config) *Service {
	events := cfg.Events
	if events == nil {
		events = NewEvents()
	}
	return &Service{
		store:     cfg.Store,
		chunks:    cfg.Chunks,
		blobs:     cfg.Blobs,
		jobs:      cfg.Jobs,
		providers: cfg.Providers,
		events:    events,
		batcher:   parse.NewBatcher(cfg.Parse),
		chunkOpts: cfg.Chunk,
		links:     cfg.Links,
		sources:   cfg.Sources,
		feeds:     cfg.Feeds,
	}
}

// Events exposes the publisher so the API layer can subscribe. Phase 6's SSE
// endpoint is built on exactly this.
func (s *Service) Events() *Events { return s.events }

// ───────────────────────────────────────────────────── knowledge bases

// CreateKB makes a knowledge base.
func (s *Service) CreateKB(ctx context.Context, userID uuid.UUID, name string) (*KB, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("knowledge: name is required")
	}
	if len(name) > 200 {
		return nil, errors.New("knowledge: name is too long")
	}
	return s.store.CreateKB(ctx, userID, name)
}

// ListKBs returns the user's knowledge bases.
func (s *Service) ListKBs(ctx context.Context, userID uuid.UUID) ([]KBSummary, error) {
	return s.store.ListKBs(ctx, userID)
}

// GetKB reads one.
func (s *Service) GetKB(ctx context.Context, userID, kbID uuid.UUID) (*KB, error) {
	return s.store.GetKB(ctx, userID, kbID)
}

// DeleteKB removes one and everything under it.
func (s *Service) DeleteKB(ctx context.Context, userID, kbID uuid.UUID) error {
	docs, err := s.store.ListDocuments(ctx, userID, kbID)
	if err != nil {
		return err
	}
	if s.recordings != nil {
		if err := s.recordings.DeleteKBRecordings(ctx, userID, kbID); err != nil {
			return err
		}
	}
	if err := s.store.DeleteKB(ctx, userID, kbID); err != nil {
		return err
	}
	for _, d := range docs {
		s.deleteFiles(ctx, userID, d.ID, d.SHA256, d.MediaSHA256)
		if parse.IsPhotoMIME(d.MIME) {
			s.dropPhotoPages(ctx, userID, d.ID)
		}
	}
	return nil
}

// ListDocuments is the document status surface.
//
// This is phase 5's answer to "live status" and phase 6's SSE stream will sit
// next to it, not replace it: a stream can be missed, and this reads the same
// truth straight out of the database.
func (s *Service) ListDocuments(ctx context.Context, userID, kbID uuid.UUID) ([]Document, error) {
	return s.store.ListDocuments(ctx, userID, kbID)
}

// GetDocument reads one document.
func (s *Service) GetDocument(ctx context.Context, userID, docID uuid.UUID) (*Document, error) {
	return s.store.GetDocument(ctx, userID, docID)
}

// ───────────────────────────────────────────────────────────── upload

// IsDuplicateDocument reports whether an Upload failed because the knowledge
// base already holds a document with the same bytes, or an AddLink because it
// already holds the same link. Content-hash uniqueness applies to files only
// (migration 1789810000): two links may return identical bytes.
func IsDuplicateDocument(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "documents_kb_sha_unique") ||
		strings.Contains(err.Error(), "documents_kb_link_unique") ||
		strings.Contains(err.Error(), "documents_kb_media_unique") ||
		strings.Contains(err.Error(), "documents_kb_zotero_unique"))
}

// UploadResult is what Upload produced.
type UploadResult struct {
	Document *Document
	JobID    uuid.UUID
	// Feed is set instead of Document when "Add a link" was given a podcast
	// feed or a YouTube playlist or channel (up-methods phase 17).
	Feed *Feed
}

// Upload validates, stores and queues a file.
//
// Order matters and is deliberate: validate the TYPE before writing anything,
// count pages before queueing, and only then create the row. A document that
// exists in the database but whose bytes were rejected is a row the worker will
// pick up and fail on three times.
func (s *Service) Upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (*UploadResult, error) {
	if mediafile.IsMediaName(filename) {
		return s.uploadMedia(ctx, userID, kbID, filename, data)
	}
	return s.upload(ctx, userID, kbID, filename, data, "")
}

// UploadZotero is Upload for an item of the learner's Zotero library (its
// stored PDF, or a note of its metadata), remembering the item's key so a
// second copy of the same item is refused as a duplicate.
func (s *Service) UploadZotero(ctx context.Context, userID, kbID uuid.UUID, itemKey, filename string, data []byte) (*UploadResult, error) {
	if itemKey == "" {
		return nil, fmt.Errorf("knowledge: a Zotero upload needs its item key")
	}
	return s.upload(ctx, userID, kbID, filename, data, itemKey)
}

func (s *Service) upload(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte, zoteroKey string) (*UploadResult, error) {
	_, mime, pageCount, err := s.checkFile(filename, data)
	if err != nil {
		return nil, err
	}
	return s.storeAndQueue(ctx, userID, kbID, filename, mime, data, pageCount, zoteroKey)
}

// storeAndQueue stores a checked upload's bytes, creates its row and queues
// its parse: the tail of Upload, UploadZotero and UploadPhotos. zoteroKey is
// the Zotero item an upload came from, or empty.
func (s *Service) storeAndQueue(ctx context.Context, userID, kbID uuid.UUID, filename, mime string, data []byte, pageCount int, zoteroKey string) (*UploadResult, error) {
	digest, err := s.blobs.PutOriginal(ctx, userID, data)
	if err != nil {
		return nil, err
	}

	doc, err := s.store.CreateDocument(ctx, Document{
		UserID:     userID,
		KBID:       kbID,
		SourceKind: SourceUpload,
		Title:      documentTitle(filename),
		MIME:       mime,
		Bytes:      int64(len(data)),
		SHA256:     digest,
		PageCount:  pageCount,
		ZoteroKey:  zoteroKey,
	})
	if err != nil {
		return nil, err
	}

	jobID, err := s.jobs.Enqueue(ctx, userID, "parse_document",
		ParseJobPayload{DocumentID: doc.ID, KBID: kbID}, 3)
	if err != nil {
		// The document exists but nothing will ever work on it. Say so on the
		// row rather than leaving it `queued` forever.
		// A fixed sentence, not err.Error(). documents.error is serialized
		// straight to the browser, and an Enqueue failure is a wrapped pgx
		// error carrying the failing statement. This was the one place in the
		// pipeline that bypassed the fixed-sentence discipline
		// userFacingParseError maintains everywhere else.
		slog.Error("knowledge: could not queue a document for processing",
			"error", err, "document", doc.ID, "kb", kbID)
		_ = s.store.SetDocumentStatus(ctx, userID, doc.ID, StatusFailed,
			"this document could not be queued for processing. Try uploading it again.")
		return nil, err
	}

	s.events.PublishStatus(userID, kbID, doc.ID, StatusQueued, "", nil)
	return &UploadResult{Document: doc, JobID: jobID}, nil
}

// checkFile is the upload checks every way into the pipeline shares (upload,
// connector import, web link): the size cap, the type sniff, and the page cap.
// Pages are counted here, not in the worker, so the cap is enforced before
// the user is told the document was accepted.
func (s *Service) checkFile(filename string, data []byte) (parse.Kind, string, int, error) {
	if int64(len(data)) > MaxUploadBytes {
		return parse.KindOther, "", 0, fmt.Errorf("knowledge: file is larger than the %d MB limit", MaxUploadBytes>>20)
	}
	kind, mime, err := parse.Detect(filename, data)
	if err != nil {
		return parse.KindOther, "", 0, err
	}
	if kind == parse.KindImage && len(data) > parse.MaxPhotoBytes {
		return parse.KindOther, "", 0, fmt.Errorf("%w: a photo may be %d MB at most", parse.ErrPhotoTooLarge, parse.MaxPhotoBytes>>20)
	}
	pageCount := 1
	if kind == parse.KindPDF {
		n, err := parse.PDFPageCount(data)
		if err != nil {
			return parse.KindOther, "", 0, fmt.Errorf("knowledge: this PDF could not be read: %w", err)
		}
		if n > s.batcher.Options().MaxPages {
			// Wrapped, so the handler matches the sentinel rather than a
			// substring of this sentence. Rewording it must not turn a 413
			// into a 500.
			return parse.KindOther, "", 0, fmt.Errorf("%w: this document has %d pages; the limit is %d",
				parse.ErrPageCapExceeded, n, s.batcher.Options().MaxPages)
		}
		pageCount = n
	}
	return kind, mime, pageCount, nil
}

// DeleteDocument removes a document, its chunks and its parsed Markdown.
func (s *Service) DeleteDocument(ctx context.Context, userID, kbID, docID uuid.UUID) error {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return err
	}
	if s.recordings != nil && doc.KBID == kbID {
		if err := s.recordings.DeleteDocumentRecordings(ctx, userID, docID); err != nil {
			return err
		}
	}
	if err := s.store.DeleteDocument(ctx, userID, kbID, docID); err != nil {
		return err
	}
	s.deleteFiles(ctx, userID, docID, doc.SHA256, doc.MediaSHA256)
	if parse.IsPhotoMIME(doc.MIME) {
		s.dropPhotoPages(ctx, userID, docID)
	}
	return nil
}

// deleteFiles removes a deleted document's files: its parsed versions, and
// its originals once no other document of the same user names that content
// (originals are shared by digest): what it parsed and, for an uploaded
// recording, the recording (up-methods phase 15). Before this, "delete" left
// the uploaded bytes on disk and in every backup until the account went
// (security audit F-5). Chunks go with the row through ON DELETE CASCADE.
// File errors are logged, not returned: the document is already gone for the
// user.
func (s *Service) deleteFiles(ctx context.Context, userID, docID uuid.UUID, digests ...string) {
	if err := s.blobs.DeleteDocument(ctx, userID, docID); err != nil {
		slog.Warn("knowledge: parsed files left behind", "document", docID, "error", err)
	}
	// A video deleted mid-transcription leaves its finished windows behind.
	s.dropWindows(ctx, userID, docID, maxWindows)
	for _, digest := range digests {
		s.dropOriginalIfUnused(ctx, userID, digest)
	}
}

// ───────────────────────────────────────────────────── the parse pipeline

// ProcessDocument is the parse_document job handler.
//
// Every exit leaves the document either TERMINAL (`ready`/`failed`) or back on
// the queue with attempts remaining. No exit leaves it `parsing` or `indexing`
// with nothing running — that is the stuck state red-team RT-8 named, and the
// reaper is only the second line of defence against it.
//
// `attempt` decides which of those two a retryable failure gets. Writing
// `failed` while retries remain is not merely premature: combined with the
// terminal-state guard in the store it makes the remaining attempts no-ops,
// because nothing may move a terminal row back. A transient 503 would kill the
// document permanently.
func (s *Service) ProcessDocument(ctx context.Context, userID uuid.UUID, payload ParseJobPayload, attempt Attempt) error {
	doc, err := s.store.GetDocument(ctx, userID, payload.DocumentID)
	if err != nil {
		if errors.Is(err, authz.ErrNoAccess) {
			// Deleted while the job waited. Retrying will not bring it back.
			return errTerminal{err}
		}
		// A database blip is NOT "the document is gone". Treating it as
		// terminal would fail the job on attempt 1 and strand a `queued`
		// document that the reaper never sweeps, because the reaper only looks
		// at running leases.
		return err
	}
	if doc.Status == StatusReady {
		return nil
	}

	data, err := s.blobs.GetOriginal(ctx, userID, doc.SHA256)
	if reason, ok := blob.Unavailable(err); ok {
		// Kept in the learner's Drive, and out of reach until they
		// reconnect, upload it again or free space: the reason is what the
		// document shows (drive-user-storage phase 3). Search keeps the
		// text it already has.
		return s.failDocument(ctx, doc, reason.Message, err, true, attempt)
	}
	if err != nil {
		// Only a genuinely absent file is terminal. GetOriginal also returns
		// raw os errors for EIO and EACCES, and a disk that is briefly
		// unreadable is worth another attempt.
		return s.failDocument(ctx, doc, "the uploaded file is no longer available",
			err, errors.Is(err, blob.ErrNotFound), attempt)
	}

	if err := s.setStatus(ctx, doc, StatusParsing, ""); err != nil {
		if stop, result := stopIfSettled(err); stop {
			return result
		}
		return err
	}

	var (
		markdown  string
		pageCount int
		pb        ProcessedBy
	)
	switch {
	case doc.SourceKind == SourceYouTube || doc.SourceKind == SourceMedia:
		// A video's original is its transcript, already cut into timed
		// segments by the same code every time; there is nothing to detect.
		// An uploaded recording is parsed only once it has one.
		markdown, pageCount, pb, err = transcriptMarkdown(doc, data)
	case doc.SourceKind == SourceRepoFile:
		// A repository file's type is its extension, chosen by the learner.
		markdown, pageCount, pb, err = repoMarkdown(doc, data)
	case parse.IsPhotoMIME(doc.MIME):
		// A photo, or several kept as one document (photos.go). The type was
		// sniffed at upload; a set has no extension to detect.
		markdown, pageCount, pb, err = s.readPhotos(ctx, userID, doc, data)
	default:
		kind, _, derr := parse.Detect(detectName(doc), data)
		if derr != nil {
			return s.failDocument(ctx, doc, "unsupported file type", derr, true, attempt)
		}
		markdown, pageCount, pb, err = s.produceMarkdown(ctx, userID, doc, kind, data)
	}
	if err != nil {
		terminal := errors.Is(err, parse.ErrUnsupportedType) ||
			errors.Is(err, parse.ErrScannedNoModel) ||
			errors.Is(err, parse.ErrPageCapExceeded) ||
			errors.Is(err, parse.ErrTooLarge) ||
			errors.Is(err, parse.ErrSheetEmpty) ||
			errors.Is(err, parse.ErrPhotoNoModel) ||
			errors.Is(err, parse.ErrImageNotAccepted)
		return s.failDocument(ctx, doc, userFacingParseError(err), err, terminal, attempt)
	}

	parsedPath, err := s.blobs.PutParsed(ctx, userID, doc.ID, doc.Version, markdown)
	if err != nil {
		return s.failDocument(ctx, doc, "the parsed document could not be stored", err, false, attempt)
	}

	if err := s.setStatus(ctx, doc, StatusIndexing, ""); err != nil {
		if stop, result := stopIfSettled(err); stop {
			return result
		}
		return err
	}

	var pieces []chunk.Chunk
	if doc.PageUnit == PageUnitLine {
		// A code file: blank-line blocks, cited by line range.
		pieces = chunk.SplitCode(doc.SourcePath, string(data), s.chunkOpts)
	} else if parse.IsPhotoMIME(doc.MIME) {
		// Photos: no passage spans two photos (photos.go).
		pieces, err = s.photoChunks(markdown, pageCount)
	} else {
		pieces, err = chunk.Split(markdown, pageCount, s.chunkOpts)
	}
	if err != nil {
		return s.failDocument(ctx, doc, "the parsed document could not be split into passages", err, false, attempt)
	}
	if len(pieces) == 0 {
		return s.failDocument(ctx, doc, "no readable text was found in this document",
			errors.New("chunker produced nothing"), true, attempt)
	}

	embedder, err := s.providers.EmbedderFor(ctx, userID)
	if err != nil {
		return s.failDocument(ctx, doc, NoEmbedRouteReason, err, true, attempt)
	}

	stored, dims, err := s.embedChunks(ctx, embedder, pieces)
	if err != nil {
		// An embed failure is usually a rate limit or a blip, so this one is
		// worth another attempt.
		return s.failDocument(ctx, doc, "the embedding model could not be reached", err, false, attempt)
	}

	if err := s.store.PinEmbeddingRoute(ctx, userID, doc.KBID, embedder.Model(), dims); err != nil {
		return s.failDocument(ctx, doc, "the knowledge base's embedding route could not be recorded", err, false, attempt)
	}
	if err := s.chunks.ReplaceDocumentChunks(ctx, userID, doc.KBID, doc.ID, stored); err != nil {
		return s.failDocument(ctx, doc, "the passages could not be stored", err, false, attempt)
	}

	pb.Embedder = embedder.ProviderName()
	pb.EmbedModel = embedder.Model()
	if err := s.store.FinishDocument(ctx, userID, doc.ID, pageCount, pb, parsedPath); err != nil {
		return err
	}
	if parse.IsPhotoMIME(doc.MIME) {
		s.dropPhotoPages(ctx, userID, doc.ID)
	}
	s.events.PublishStatus(userID, doc.KBID, doc.ID, StatusReady, "", &pb)
	return nil
}

// detectName is the filename parse.Detect reads. A web page's title is a
// page title, not a filename, so its stored type supplies the extension.
func detectName(doc *Document) string {
	if doc.SourceKind == SourceWeb || doc.SourceKind == SourceSitePage {
		if doc.MIME == "application/pdf" {
			return "page.pdf"
		}
		return "page.html"
	}
	return doc.Title
}

// repoMarkdown renders a repository file. Documentation (.md, .mdx, .rst,
// .txt, .adoc) is read as Markdown text; a code file is fenced whole as ONE
// viewer page. Its chunks cite line ranges (chunk.SplitCode), not pages.
func repoMarkdown(doc *Document, data []byte) (string, int, ProcessedBy, error) {
	if !utf8.Valid(data) || strings.ContainsRune(string(data), 0) {
		return "", 0, ProcessedBy{}, fmt.Errorf("%w: %s is not text", parse.ErrUnsupportedType, doc.SourcePath)
	}
	if doc.PageUnit != PageUnitLine {
		res, err := parse.ParseLocal(parse.KindMD, data)
		if err != nil {
			return "", 0, ProcessedBy{}, err
		}
		return res.Markdown, res.Pages, ProcessedBy{Parser: res.Parser}, nil
	}
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	fence := "```"
	for strings.Contains(text, fence) {
		fence += "`"
	}
	lang := strings.TrimPrefix(strings.ToLower(path.Ext(doc.SourcePath)), ".")
	md := "# " + doc.SourcePath + "\n\n" + fence + lang + "\n" + strings.TrimRight(text, "\n") + "\n" + fence + "\n"
	return md, 1, ProcessedBy{Parser: "local:code", Note: "a code file, cited by line"}, nil
}

// transcriptMarkdown renders a video's stored transcript as page-marked
// Markdown, keeping the provenance its transcript was stored with (which
// captions, which model) rather than replacing it with "local".
func transcriptMarkdown(doc *Document, data []byte) (string, int, ProcessedBy, error) {
	var t youtube.Transcript
	if err := json.Unmarshal(data, &t); err != nil {
		return "", 0, ProcessedBy{}, fmt.Errorf("%w: stored transcript: %v", parse.ErrUnsupportedType, err)
	}
	ix, err := youtube.Index(&t)
	if err != nil {
		return "", 0, ProcessedBy{}, fmt.Errorf("%w: %v", parse.ErrUnsupportedType, err)
	}
	var pb ProcessedBy
	_ = json.Unmarshal(doc.ProcessedBy, &pb)
	return ix.Markdown, ix.Pages, pb, nil
}

// produceMarkdown runs the right lane for a document kind.
func (s *Service) produceMarkdown(ctx context.Context, userID uuid.UUID, doc *Document, kind parse.Kind, data []byte) (string, int, ProcessedBy, error) {
	if !parse.NeedsModel(kind) {
		res, err := parse.ParseLocal(kind, data)
		if err != nil {
			return "", 0, ProcessedBy{}, err
		}
		return res.Markdown, res.Pages, ProcessedBy{Parser: res.Parser}, nil
	}

	// PDF. The local text layer is read first for two independent reasons: it
	// decides whether the file is scanned, and it is the denominator of the
	// short-parse guard.
	textLayer, pages, localErr := parse.LocalPDFText(data)
	if localErr != nil {
		pages = doc.PageCount
	}

	chain, err := s.providers.ParserChain(ctx, userID)
	if err != nil {
		return "", 0, ProcessedBy{}, err
	}

	if len(chain) == 0 {
		// No model configured. A PDF with a text layer still works; a scanned
		// one fails with the one message the user can act on.
		if localErr != nil {
			return "", 0, ProcessedBy{}, localErr
		}
		if parse.LooksScanned(textLayer, pages) {
			return "", 0, ProcessedBy{}, parse.ErrScannedNoModel
		}
		return textLayer, pages, ProcessedBy{
			Parser: "local:ledongthuc/pdf",
			Note:   "no model is configured, so this document was read with the local text extractor; tables and formulas may be flattened",
		}, nil
	}

	first := chain[0].ProviderName()
	rep, err := s.batcher.ParsePDF(ctx, chain, data, s.recordFallback(ctx, userID, doc))
	if err != nil {
		// Every model failed. A readable text layer is a better answer than
		// nothing, and the note says exactly what the user is looking at.
		if localErr == nil && !parse.LooksScanned(textLayer, pages) {
			s.events.PublishFallback(userID, doc.KBID, doc.ID, first, "local text extraction", shortCause(err))
			return textLayer, pages, ProcessedBy{
				Parser: "local:ledongthuc/pdf", Downgraded: true,
				Note: "every configured model failed, so this document was read with the local text extractor; tables and formulas may be flattened",
			}, nil
		}
		return "", 0, ProcessedBy{}, err
	}

	// The short-parse guard against the document's own text layer. A model that
	// reports a clean stop and returns a third of the text skipped material,
	// and a document indexed from it answers questions with silence.
	if localErr == nil && parse.ShortParseAgainstTextLayer(rep.Markdown, textLayer) {
		return "", 0, ProcessedBy{}, fmt.Errorf(
			"short parse: %s returned %d characters against %d in the document's own text layer",
			rep.Provider, len(rep.Markdown), len(textLayer))
	}

	pb := ProcessedBy{Parser: rep.Provider, Model: rep.Model, Downgraded: rep.Downgraded}
	if rep.Downgraded {
		pb.Note = first + " could not read this document, so " + rep.Provider + " did"
	}
	return rep.Markdown, rep.PageCount, pb, nil
}

// recordFallback makes a downgrade visible (RT-14): an event, and the lane
// now trying, on the row.
func (s *Service) recordFallback(ctx context.Context, userID uuid.UUID, doc *Document) parse.FallbackFunc {
	return func(from, to string, cause error) {
		s.events.PublishFallback(userID, doc.KBID, doc.ID, from, to, shortCause(cause))
		_ = s.store.RecordProcessedBy(ctx, userID, doc.ID, ProcessedBy{
			Parser: to, Downgraded: true,
			Note: from + " could not read this document; trying " + to,
		})
	}
}

// embedChunks embeds in batches and pads for storage.
func (s *Service) embedChunks(ctx context.Context, embedder Embedder, pieces []chunk.Chunk) ([]StoredChunk, int, error) {
	out := make([]StoredChunk, 0, len(pieces))
	dims := 0

	for start := 0; start < len(pieces); start += EmbedBatchSize {
		end := start + EmbedBatchSize
		if end > len(pieces) {
			end = len(pieces)
		}
		batch := pieces[start:end]

		texts := make([]string, len(batch))
		for i, p := range batch {
			texts[i] = p.Text
		}

		// EmbedDocument, always. The query side passes EmbedQuery; see
		// EmbedTask for why embedding both the same way quietly costs recall.
		vectors, batchDims, err := embedder.Embed(ctx, texts, EmbedDocument)
		if err != nil {
			return nil, 0, err
		}
		if len(vectors) != len(texts) {
			// One vector per input, in order, is the contract in ports.go.
			// Accepting a ragged batch would silently attach passage 7's
			// embedding to passage 6.
			return nil, 0, fmt.Errorf("knowledge: embed route returned %d vectors for %d passages",
				len(vectors), len(texts))
		}
		if dims == 0 {
			dims = batchDims
		} else if dims != batchDims {
			return nil, 0, fmt.Errorf("knowledge: embed route changed width mid-document (%d then %d)",
				dims, batchDims)
		}

		padded, err := embed.PadBatch(vectors, batchDims)
		if err != nil {
			return nil, 0, err
		}
		for i, p := range batch {
			out = append(out, StoredChunk{
				Ord: p.Ord, HeadingPath: p.HeadingPath,
				PageStart: p.PageStart, PageEnd: p.PageEnd, Text: p.Text,
				Embedding: padded[i], Dims: batchDims,
			})
		}
	}
	return out, dims, nil
}

// ───────────────────────────────────────────────────────────── reindex

// Reindex queues a full re-embed of a knowledge base.
func (s *Service) Reindex(ctx context.Context, userID, kbID uuid.UUID) (uuid.UUID, error) {
	return s.jobs.Enqueue(ctx, userID, "reindex_kb", ReindexJobPayload{KBID: kbID}, 2)
}

// ReindexKB is the reindex_kb job handler: re-embed every ready document's
// existing chunks without re-parsing them.
//
// Re-parsing would spend the user's parse quota again to produce the same
// Markdown. The chunks and their page ranges are already correct; only the
// vectors are stale.
func (s *Service) ReindexKB(ctx context.Context, userID uuid.UUID, payload ReindexJobPayload) error {
	embedder, err := s.providers.EmbedderFor(ctx, userID)
	if err != nil {
		return errTerminal{fmt.Errorf("no embedding model is configured: %w", err)}
	}
	docIDs, err := s.store.ListDocumentIDs(ctx, userID, payload.KBID)
	if err != nil {
		return err
	}

	dims := 0
	for _, docID := range docIDs {
		existing, err := s.chunks.ChunkTexts(ctx, userID, docID)
		if err != nil {
			return err
		}
		if len(existing) == 0 {
			continue
		}
		pieces := make([]chunk.Chunk, len(existing))
		for i, c := range existing {
			pieces[i] = chunk.Chunk{
				Ord: c.Ord, HeadingPath: c.HeadingPath,
				PageStart: c.PageStart, PageEnd: c.PageEnd, Text: c.Text,
			}
		}
		stored, d, err := s.embedChunks(ctx, embedder, pieces)
		if err != nil {
			return err
		}
		dims = d
		if err := s.chunks.ReplaceDocumentChunks(ctx, userID, payload.KBID, docID, stored); err != nil {
			return err
		}
		s.events.PublishStatus(userID, payload.KBID, docID, StatusReady, "reindexed", nil)
	}

	if dims > 0 {
		if err := s.store.PinEmbeddingRoute(ctx, userID, payload.KBID, embedder.Model(), dims); err != nil {
			return err
		}
	}
	// Cleared LAST. If anything above failed, the block stays on and the user
	// gets an explicit "reindex needed" rather than results ranked against a
	// half-migrated index.
	return s.store.ClearNeedsReembed(ctx, userID, payload.KBID)
}

// ─────────────────────────────────────────────────────────── internals

func (s *Service) setStatus(ctx context.Context, doc *Document, status, msg string) error {
	if err := s.store.SetDocumentStatus(ctx, doc.UserID, doc.ID, status, msg); err != nil {
		// ErrDocumentFinal means something else already settled this document:
		// the reaper failed it after taking our lease, or a concurrent worker
		// finished it. Either way this goroutine is a straggler and must stop
		// touching the row rather than fight over it.
		return err
	}
	s.events.PublishStatus(doc.UserID, doc.KBID, doc.ID, status, msg, nil)
	return nil
}

// stopIfSettled turns "the document is already terminal" into a clean stop.
//
// The job is finished as far as the system is concerned — the row says
// something terminal and a reaper or another worker put it there — so reporting
// a failure would add a second, contradictory account of the same document.
func stopIfSettled(err error) (stop bool, result error) {
	if errors.Is(err, ErrDocumentFinal) {
		return true, nil
	}
	return false, err
}

// failDocument records a failure and returns an error, so the job row and the
// document row always agree about what happened.
//
// It writes `failed` only when nothing more will be tried — the cause is
// terminal, or this was the last attempt. While attempts remain the document
// goes back to `queued` carrying the reason, because a `failed` row cannot be
// moved again: the store's terminal guard would turn every remaining attempt
// into a silent no-op, and a transient upstream error into a permanent loss.
func (s *Service) failDocument(ctx context.Context, doc *Document, userMsg string, cause error, terminal bool, attempt Attempt) error {
	settle := terminal || attempt.IsLast()

	var writeErr error
	if settle {
		writeErr = s.store.SetDocumentStatus(ctx, doc.UserID, doc.ID, StatusFailed, userMsg)
	} else {
		writeErr = s.store.RequeueDocument(ctx, doc.UserID, doc.ID, userMsg)
	}

	if writeErr != nil {
		if errors.Is(writeErr, ErrDocumentFinal) {
			// Already settled by the reaper or another worker. Their account
			// stands; ours would overwrite a reason the user may have read.
			return errTerminal{fmt.Errorf("%s (document already settled): %w", userMsg, cause)}
		}
		// Keep BOTH. The status write failed, but the parse failure that
		// triggered it is the thing anyone reading jobs.last_error needs.
		return errors.Join(writeErr, cause)
	}

	status := StatusQueued
	if settle {
		status = StatusFailed
	}
	s.events.PublishStatus(doc.UserID, doc.KBID, doc.ID, status, userMsg, nil)

	wrapped := fmt.Errorf("%s: %w", userMsg, cause)
	if terminal {
		return errTerminal{wrapped}
	}
	return wrapped
}

// errTerminal marks an error the job queue should not retry. The jobs package
// detects it through its own TerminalError; this local type keeps this package
// from importing the queue just to construct one.
type errTerminal struct{ err error }

func (e errTerminal) Error() string { return e.err.Error() }
func (e errTerminal) Unwrap() error { return e.err }

// IsTerminal reports whether an error from a handler should stop retrying.
func IsTerminal(err error) bool {
	var t errTerminal
	return errors.As(err, &t)
}

func userFacingParseError(err error) string {
	switch {
	case errors.Is(err, parse.ErrScannedNoModel):
		return "this PDF has no text layer (it is a scan). Add an AI key in Settings so a model can read it."
	case errors.Is(err, parse.ErrPageCapExceeded):
		return err.Error()
	case errors.Is(err, parse.ErrUnsupportedType):
		return "this file type is not supported"
	case errors.Is(err, parse.ErrTooLarge):
		return "this file expands to more than AnyLearn reads from one document (for a spreadsheet: 200 MB unpacked or 2 million cells)"
	case errors.Is(err, parse.ErrSheetEmpty):
		return "this spreadsheet has no cells"
	case errors.Is(err, parse.ErrPhotoNoModel):
		return "a photo can only be read by a model. Route a model to Parse documents in Settings, then retry."
	case errors.Is(err, parse.ErrImageNotAccepted):
		return "no model routed to Parse documents can take this photo. Gemini reads HEIC; OpenAI and Claude read PNG, JPEG and WebP, and Claude up to 3.75 MB. Convert it to JPEG, or route another model."
	case errors.Is(err, parse.ErrNoParser):
		return "no model is configured that can read a PDF — add one in Settings"
	case strings.HasPrefix(err.Error(), "short parse"):
		return "the model returned far less text than this document contains, so it was not indexed. Try again, or use a different model."
	}
	return "this document could not be parsed"
}

// shortCause keeps a provider's error out of the UI at full length while
// keeping enough of it to be recognisable.
func shortCause(err error) string {
	if err == nil {
		return "unknown error"
	}
	msg := strings.Join(strings.Fields(err.Error()), " ")
	if len(msg) > 160 {
		return msg[:160] + "…"
	}
	return msg
}

// documentTitle turns an uploaded filename into a display title.
//
// The filename is the client's to choose, so: path components are dropped;
// line breaks and tabs become spaces; control and invisible formatting
// characters (NUL, zero-width, bidi overrides that make "fdp.exe" render as
// "exe.pdf") are removed; and the length is capped in CHARACTERS — a byte cap
// cuts a Vietnamese name mid-rune into invalid UTF-8, which Postgres refuses.
func documentTitle(filename string) string {
	name := filename
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		name = name[i+1:]
	}
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteRune(' ')
		case r == utf8.RuneError, unicode.Is(unicode.Cc, r), unicode.Is(unicode.Cf, r):
			// dropped
		default:
			b.WriteRune(r)
		}
	}
	name = strings.TrimSpace(b.String())
	if name == "" {
		return "Untitled"
	}
	if runes := []rune(name); len(runes) > 200 {
		name = string(runes[:200])
	}
	return name
}
