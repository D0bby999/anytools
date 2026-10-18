// Package videonotes is a YouTube video's study notes: the video in sections,
// each with a summary and its key points, every one tied to a second of the
// video so the learner can watch the moment it came from.
//
// The learner asks; nothing is written unasked. One model call on the
// learner's reading route, then the engine decides what is kept (Validate):
// times that are not in the video are dropped, the creator's chapters (when
// the video has them) are the section boundaries, and lengths are bounded.
// The video itself is never downloaded; the notes are written from the
// transcript the knowledge base already holds.
package videonotes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
	videonotesprompts "github.com/D0bby999/anytools/internal/prompts/videonotes"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// Function is the BYOK route the notes are written on: the learner's
// reading model, the one that already reads their documents.
const Function = "reading"

// MaxTranscript bounds what one call reads: about three hours of speech.
// A longer video is refused rather than summarised from its first part.
const MaxTranscript = 150_000

var (
	// ErrNotFound covers "not yours", "does not exist" and "not a video".
	ErrNotFound = errors.New("videonotes: not found")
	// ErrNoTranscript is a video with no transcript yet, or one without times.
	ErrNoTranscript = errors.New("videonotes: this video has no timed transcript yet")
	// ErrTooLong is a transcript beyond MaxTranscript.
	ErrTooLong = errors.New("videonotes: this video is too long for study notes")
	// ErrBadLanguage is a language code that is not one.
	ErrBadLanguage = errors.New("videonotes: not a language code")
)

var languagePattern = regexp.MustCompile(`^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$`)

// Point is one key idea. At is nil when the model gave no time inside its
// section.
type Point struct {
	Text string   `json:"text"`
	At   *float64 `json:"at,omitempty"`
}

// Section is one part of the video.
type Section struct {
	Start   float64 `json:"start"`
	End     float64 `json:"end"`
	Title   string  `json:"title"`
	Summary string  `json:"summary"`
	Points  []Point `json:"points"`
}

// Notes is one set of study notes, in one language.
type Notes struct {
	ID           uuid.UUID `json:"id"`
	DocumentID   uuid.UUID `json:"document_id"`
	Language     string    `json:"language"`
	Sections     []Section `json:"sections"`
	FromChapters bool      `json:"from_chapters"`
	Model        string    `json:"model"`
	CreatedAt    time.Time `json:"created_at"`
	// Stale: the video's transcript was replaced after these were written,
	// so their times may no longer match. Computed on read.
	Stale bool `json:"stale"`
	// TranscriptSHA256 is the transcript the notes were written from.
	TranscriptSHA256 string `json:"-"`
}

// Store keeps notes (pg.VideoNotesStore).
type Store interface {
	// Save writes the notes, replacing any in the same language.
	Save(ctx context.Context, userID uuid.UUID, n Notes) (*Notes, error)
	List(ctx context.Context, userID, documentID uuid.UUID) ([]Notes, error)
}

// Videos reads the learner's video documents (knowledge.Service).
type Videos interface {
	GetDocument(ctx context.Context, userID, docID uuid.UUID) (*knowledge.Document, error)
	TranscriptCues(ctx context.Context, userID, docID uuid.UUID) (*youtube.Transcript, error)
}

// Service writes and reads study notes.
type Service struct {
	store     Store
	videos    Videos
	providers runtime.ChatProviderResolver
	now       func() time.Time
}

// NewService builds the service.
func NewService(store Store, videos Videos, providers runtime.ChatProviderResolver) *Service {
	return &Service{store: store, videos: videos, providers: providers, now: time.Now}
}

// video reads a video document of the caller's.
func (s *Service) video(ctx context.Context, userID, docID uuid.UUID) (*knowledge.Document, error) {
	doc, err := s.videos.GetDocument(ctx, userID, docID)
	if errors.Is(err, authz.ErrNoAccess) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	// A YouTube video or an uploaded recording (up-methods phase 15).
	if !doc.Timed() {
		return nil, ErrNotFound
	}
	return doc, nil
}

// List reads a video's notes, each marked stale when the transcript changed.
func (s *Service) List(ctx context.Context, userID, docID uuid.UUID) ([]Notes, error) {
	doc, err := s.video(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	list, err := s.store.List(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Stale = list[i].TranscriptSHA256 != doc.SHA256
	}
	return list, nil
}

// Get reads one language's notes.
func (s *Service) Get(ctx context.Context, userID, docID uuid.UUID, language string) (*knowledge.Document, *Notes, error) {
	doc, err := s.video(ctx, userID, docID)
	if err != nil {
		return nil, nil, err
	}
	list, err := s.List(ctx, userID, docID)
	if err != nil {
		return nil, nil, err
	}
	for i := range list {
		if list[i].Language == language {
			return doc, &list[i], nil
		}
	}
	return nil, nil, ErrNotFound
}

// Generate writes the notes in language ("" means the transcript's own) and
// stores them, replacing earlier notes in that language.
func (s *Service) Generate(ctx context.Context, userID, docID uuid.UUID, language string) (*Notes, error) {
	doc, err := s.video(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.MIME != knowledge.TranscriptMIME {
		return nil, ErrNoTranscript
	}
	var chapters []youtube.Chapter
	if doc.Media != nil {
		chapters = doc.Media.Chapters
		if language == "" {
			language = baseLanguage(doc.Media.Language)
		}
	}
	if language == "" {
		language = "en"
	}
	if !languagePattern.MatchString(language) {
		return nil, ErrBadLanguage
	}

	t, err := s.videos.TranscriptCues(ctx, userID, docID)
	if errors.Is(err, knowledge.ErrNoParsedContent) {
		return nil, ErrNoTranscript
	}
	if err != nil {
		return nil, err
	}
	if !t.Timed || len(t.Cues) == 0 {
		return nil, ErrNoTranscript
	}
	lines := transcriptLines(t.Cues)
	if utf8.RuneCountInString(lines) > MaxTranscript {
		return nil, ErrTooLong
	}
	end := t.Cues[len(t.Cues)-1].End

	provider, err := s.providers.ChatFor(ctx, userID, Function)
	if err != nil {
		return nil, err
	}
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: videonotesprompts.Notes},
			{Role: runtime.RoleUser, Content: userPrompt(doc.Title, lines, chapters, language)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil {
		return nil, fmt.Errorf("%w: the model returned nothing", runtime.ErrProvider)
	}
	var raw rawNotes
	payload, ok := modeljson.Extract(resp.Content)
	if !ok || json.Unmarshal([]byte(payload), &raw) != nil {
		return nil, ErrInvalid
	}
	sections, fromChapters, err := Validate(raw, end, chapters)
	if err != nil {
		return nil, err
	}
	return s.store.Save(ctx, userID, Notes{
		DocumentID: docID, Language: language, Sections: sections, FromChapters: fromChapters,
		Model: provider.DefaultModel(), CreatedAt: s.now().UTC(), TranscriptSHA256: doc.SHA256,
	})
}

// transcriptLines renders the transcript as timed lines, merged into the
// 20–90 s segments the knowledge base indexes, so a long video stays short.
func transcriptLines(cues []youtube.Cue) string {
	var b strings.Builder
	for _, seg := range youtube.Segments(cues) {
		fmt.Fprintf(&b, "[%s] %s\n", youtube.FormatClock(seg.Start), seg.Text)
	}
	return b.String()
}

// userPrompt envelopes everything that came from the video (its title, its
// creator's chapter titles and its transcript); only the language and the
// instructions are AnyTools' own.
func userPrompt(title, lines string, chapters []youtube.Chapter, language string) string {
	parts := []string{tools.Wrap("Video transcript: "+title, "transcript", lines)}
	if len(chapters) > 0 {
		var c strings.Builder
		for i, ch := range chapters {
			fmt.Fprintf(&c, "%d. [%s] %s\n", i+1, youtube.FormatClock(ch.Start), ch.Title)
		}
		parts = append(parts, tools.Wrap("The creator's chapters", "chapters", c.String()))
	}
	var b strings.Builder
	b.WriteString(tools.WrapAll(parts))
	if len(chapters) > 0 {
		fmt.Fprintf(&b, "\n\nThe video has %d creator chapters: write exactly %d sections, one per chapter, in order.", len(chapters), len(chapters))
	}
	fmt.Fprintf(&b, "\n\nWrite the notes in %s.", languageName(language))
	return b.String()
}

// languageName is how the prompt names a language: a name the model reads
// unambiguously for the common ones, the code with its meaning otherwise.
func languageName(code string) string {
	names := map[string]string{
		"en": "English", "vi": "Vietnamese", "fr": "French", "de": "German", "es": "Spanish",
		"ja": "Japanese", "ko": "Korean", "zh": "Chinese", "pt": "Portuguese", "ru": "Russian",
	}
	if n, ok := names[baseLanguage(code)]; ok {
		return n
	}
	return fmt.Sprintf("the language with the BCP 47 code %q", code)
}

func baseLanguage(l string) string {
	l = strings.ToLower(strings.TrimSpace(l))
	if i := strings.IndexAny(l, "-_"); i > 0 {
		return l[:i]
	}
	return l
}
