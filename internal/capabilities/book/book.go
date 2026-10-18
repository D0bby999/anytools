// Package book is the living book (learning-depth phase 11): a knowledge base
// turned into a book of chapters made of typed blocks, each written from the
// learner's own material and citing it.
//
// It follows DeepTutor's Book (findings §8) with its two gates kept and its
// block set cut down:
//
//  1. Propose. One call reads a sample of the knowledge base (the "outline")
//     and proposes a title, an audience and 4–12 chapters, each with
//     objectives, earlier-only prerequisites and anchors — chunk ids from the
//     outline. Go decides whether the proposal is acceptable (propose.go).
//  2. The learner edits the outline and CONFIRMS it. Nothing else is generated
//     before that: confirming creates the chapters and compiles none.
//  3. Compile, one chapter at a time on request or all of them as a job: one
//     planning call chooses 5–10 blocks (plan.go), then one call per block
//     (blocks.go), each block validated by the rules of its type. The job is
//     resumable per call and pauses the book after two provider failures in a
//     row (compile.go).
//
// The model proposes; this package decides. A block that breaks its rules is
// an `error` block the learner can retry, never an empty success, and a
// citation to a passage the call was not given is dropped.
package book

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/vocab"
)

// JobKind is the queue kind of a chapter's (or a whole book's) compilation.
const JobKind = jobs.KindCompileBook

// Book statuses, as books.status CHECKs them.
const (
	StatusProposed  = "proposed"
	StatusConfirmed = "confirmed"
	StatusArchived  = "archived"
)

// Chapter statuses, as book_chapters.status CHECKs them.
const (
	ChapterPending   = "pending"
	ChapterCompiling = "compiling"
	ChapterReady     = "ready"
	ChapterError     = "error"
	ChapterPaused    = "paused"
)

// Block statuses, as book_blocks.status CHECKs them.
const (
	BlockPending = "pending"
	BlockReady   = "ready"
	BlockError   = "error"
)

// Limits.
const (
	MinChapters = 4
	MaxChapters = 12
	// DefaultChapters is the length a request that names none gets.
	DefaultChapters = 6
	maxTitle        = 200
	maxGoal         = 500
	maxAudience     = 300
	maxNote         = 5000
	// MaxConsecutiveFailures pauses a book: DeepTutor's
	// CONSECUTIVE_PAGE_FAILURE_LIMIT.
	MaxConsecutiveFailures = 2
	// MinMaterial is the fewest passages a chapter may be written from.
	MinMaterial = 3
)

var (
	// ErrNotFound covers "not yours" and "does not exist" alike.
	ErrNotFound = errors.New("book: not found")
	// ErrBadRequest is a request the learner can fix; its text says how.
	ErrBadRequest = errors.New("book: bad request")
	// ErrNotConfirmed refuses a compile before the outline is confirmed.
	ErrNotConfirmed = errors.New("book: confirm the outline first")
	// ErrNotEditable refuses an outline edit after confirmation.
	ErrNotEditable = errors.New("book: the outline is confirmed and can no longer be edited")
	// ErrBusy refuses work on a chapter that is compiling.
	ErrBusy = errors.New("book: this chapter is being written")
	// ErrNothingToCompile answers "compile all" on a finished book.
	ErrNothingToCompile = errors.New("book: every chapter is already written")
	// ErrThinMaterial refuses a chapter with too little to write from.
	ErrThinMaterial = errors.New("book: not enough material for this chapter")
	// ErrThinKB refuses a proposal for a knowledge base with too little in it.
	ErrThinKB = errors.New("book: this knowledge base has too little text for a book yet")
	// ErrInvalidOutput wraps a model answer that broke a rule.
	ErrInvalidOutput = errors.New("book: the model's answer broke a rule")
	// ErrPaused ends a compile job after two provider failures in a row.
	ErrPaused = errors.New("book: paused after two provider failures in a row")
)

// Passage is one chunk of the knowledge base, as a prompt reads it.
type Passage struct {
	ChunkID    uuid.UUID
	DocumentID uuid.UUID
	Title      string
	Page       int
	Heading    string
	Text       string
}

// OutlineItem is one passage the proposal was written from, as the editor
// shows it: anchors are chosen from these.
type OutlineItem struct {
	ChunkID    uuid.UUID `json:"chunk_id"`
	DocumentID uuid.UUID `json:"document_id"`
	Title      string    `json:"title"`
	Page       int       `json:"page,omitempty"`
	Heading    string    `json:"heading,omitempty"`
	Snippet    string    `json:"snippet"`
}

// ProposedChapter is one chapter of an outline.
type ProposedChapter struct {
	Title      string   `json:"title"`
	Objectives []string `json:"objectives"`
	// Prereqs are the 1-based numbers of EARLIER chapters.
	Prereqs []int `json:"prereqs"`
	// Anchors are chunk ids from the outline.
	Anchors []uuid.UUID `json:"anchors"`
}

// Proposal is the outline the learner edits and confirms.
type Proposal struct {
	Title    string            `json:"title"`
	Audience string            `json:"audience"`
	Chapters []ProposedChapter `json:"chapters"`
	Outline  []OutlineItem     `json:"outline"`
}

// Book is one row of books, with its chapters once confirmed.
type Book struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"-"`
	KBID         uuid.UUID  `json:"kb_id"`
	Title        string     `json:"title"`
	Goal         string     `json:"goal"`
	Length       int        `json:"length"`
	Status       string     `json:"status"`
	Proposal     Proposal   `json:"proposal"`
	Failures     int        `json:"-"`
	PausedReason string     `json:"paused_reason,omitempty"`
	JobID        *uuid.UUID `json:"-"`
	Chapters     []Chapter  `json:"chapters"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`

	// Set by the service for the reader.
	Compiling      bool           `json:"compiling"`
	Progress       *jobs.Progress `json:"progress,omitempty"`
	EstimatedCalls int            `json:"estimated_calls"`
}

// Chapter is one row of book_chapters, with its block counts.
type Chapter struct {
	ID             uuid.UUID      `json:"id"`
	BookID         uuid.UUID      `json:"book_id"`
	Ord            int            `json:"ord"`
	Title          string         `json:"title"`
	Objectives     []string       `json:"objectives"`
	Prereqs        []int          `json:"prereqs"`
	Anchors        []uuid.UUID    `json:"anchors"`
	Status         string         `json:"status"`
	Error          string         `json:"error,omitempty"`
	SourceVersions map[string]int `json:"-"`
	CompiledAt     *time.Time     `json:"compiled_at,omitempty"`
	// Blocks counts the model's blocks (the learner's notes aside); Ready
	// those written. Unready is what a compile would still pay for.
	Blocks int `json:"blocks"`
	Ready  int `json:"ready"`

	// Set by the service.
	Stale          bool `json:"stale"`
	EstimatedCalls int  `json:"estimated_calls"`
}

// Block is one row of book_blocks.
type Block struct {
	ID        uuid.UUID          `json:"id"`
	ChapterID uuid.UUID          `json:"chapter_id"`
	Ord       int                `json:"ord"`
	Type      string             `json:"type"`
	Status    string             `json:"status"`
	Title     string             `json:"title"`
	Brief     string             `json:"brief,omitempty"`
	Payload   json.RawMessage    `json:"payload"`
	Sources   []citations.Source `json:"sources"`
	Error     string             `json:"error,omitempty"`
	Version   int                `json:"version"`
	CreatedAt time.Time          `json:"created_at"`

	// Set for the reader: a quiz block's questions, a flash-card block's
	// cards and whether they are in the Book cards queue.
	Questions []map[string]any  `json:"questions,omitempty"`
	Cards     []vocab.FlashCard `json:"cards,omitempty"`
	InReview  *bool             `json:"in_review,omitempty"`
}

// PlannedBlock is one block a chapter plan asks for.
type PlannedBlock struct {
	Type  string `json:"type"`
	Title string `json:"title"`
	Brief string `json:"brief"`
}

// BlockWrite is a block that passed its rules.
type BlockWrite struct {
	Payload json.RawMessage
	Sources []citations.Source
	// Flash is set on a flash-card block: its cards replace the block's old
	// ones in the same transaction, starting at NewCard.
	Flash   []vocab.FlashCard
	NewCard learning.Card
	Now     time.Time
}

// Store is the persistence the service needs; pg.BookStore implements it.
// Every method names the owner, and every id is resolved with it.
type Store interface {
	KBName(ctx context.Context, userID, kbID uuid.UUID) (string, error)
	// Outline samples up to limit passages spread across the knowledge
	// base's ready documents.
	Outline(ctx context.Context, userID, kbID uuid.UUID, limit int) ([]Passage, error)
	// ResolveAnchors returns those ids that are the user's chunks in kbID.
	ResolveAnchors(ctx context.Context, userID, kbID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]bool, error)
	// Material reads a chapter's passages: its anchors that still resolve to
	// the user's chunks in kbID, then their neighbours, at most limit.
	Material(ctx context.Context, userID, kbID uuid.UUID, anchors []uuid.UUID, limit int) ([]Passage, error)
	DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) (map[string]int, error)

	CreateBook(ctx context.Context, b Book) (*Book, error)
	GetBook(ctx context.Context, userID, id uuid.UUID) (*Book, error)
	ListBooks(ctx context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]Book, error)
	// SaveProposal stores an edited outline while the book is proposed.
	SaveProposal(ctx context.Context, userID, id uuid.UUID, p Proposal) error
	// Confirm moves a proposed book to confirmed and creates its chapters,
	// atomically; false when it was not proposed.
	Confirm(ctx context.Context, userID, id uuid.UUID, chapters []ProposedChapter) (bool, error)
	DeleteBook(ctx context.Context, userID, id uuid.UUID) (*Book, error)
	SetJob(ctx context.Context, userID, id, jobID uuid.UUID) error

	GetChapter(ctx context.Context, userID, bookID, chapterID uuid.UUID) (*Chapter, error)
	Blocks(ctx context.Context, userID, chapterID uuid.UUID) ([]Block, error)
	GetBlock(ctx context.Context, userID, bookID, blockID uuid.UUID) (*Block, *Chapter, error)
	// StartCompiling marks chapters compiling and clears the book's pause.
	// ids nil means every chapter with something left to write. refresh
	// sends every written block of the named chapters back to pending, each
	// keeping its payload until its new version is ready. It returns the
	// chapters it marked; a chapter already compiling is not among them.
	StartCompiling(ctx context.Context, userID, bookID uuid.UUID, ids []uuid.UUID, refresh bool) ([]uuid.UUID, error)
	// SetAnchors records a chapter's anchors after they were resolved on use.
	SetAnchors(ctx context.Context, userID, chapterID uuid.UUID, anchors []uuid.UUID) error
	SavePlan(ctx context.Context, userID, chapterID uuid.UUID, blocks []PlannedBlock) error
	SaveBlock(ctx context.Context, userID, blockID uuid.UUID, w BlockWrite) error
	FailBlock(ctx context.Context, userID, blockID uuid.UUID, reason string) error
	FinishChapter(ctx context.Context, userID, chapterID uuid.UUID, status, reason string, versions map[string]int, now time.Time) error
	// RecordFailure counts a provider failure and returns the run length.
	RecordFailure(ctx context.Context, userID, bookID uuid.UUID) (int, error)
	ResetFailures(ctx context.Context, userID, bookID uuid.UUID) error
	Pause(ctx context.Context, userID, bookID uuid.UUID, reason string) error
	AddNote(ctx context.Context, userID, bookID, chapterID uuid.UUID, markdown string) (*Block, error)
	FlashCards(ctx context.Context, userID, blockID uuid.UUID) ([]vocab.FlashCard, bool, error)
	SetInReview(ctx context.Context, userID, bookID, blockID uuid.UUID, on bool) error
}

// Quizzer writes a quiz block's questions into the bank and reads them back;
// *quiz.Service implements it.
type Quizzer interface {
	GenerateFromPassages(ctx context.Context, userID, kbID uuid.UUID, chunks []quiz.Chunk, n int, focus string) (*quiz.GenerateResult, error)
	Get(ctx context.Context, userID, questionID uuid.UUID) (*quiz.Question, []quiz.Attempt, error)
}

// Cards starts flash cards on the vocabulary's schedule; *vocab.Service.
type Cards interface {
	NewCard() learning.Card
}

// Queue is the slice of jobs.Queue the service uses.
type Queue interface {
	Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error)
	RunUnits(ctx context.Context, job *jobs.Job, total int, unit jobs.UnitFunc) error
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
	Get(ctx context.Context, jobID uuid.UUID) (*jobs.Job, error)
}

// Service makes and serves living books.
type Service struct {
	store  Store
	models runtime.ChatProviderResolver
	quiz   Quizzer
	cards  Cards
	queue  Queue
	now    func() time.Time
}

// Deps are the service's collaborators.
type Deps struct {
	Store  Store
	Models runtime.ChatProviderResolver
	Quiz   Quizzer
	Cards  Cards
	Queue  Queue
	Now    func() time.Time
}

// NewService builds the service.
func NewService(d Deps) *Service {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Service{store: d.Store, models: d.Models, quiz: d.Quiz, cards: d.Cards, queue: d.Queue, now: d.Now}
}

// Get reads a book with its chapters, their freshness and what compiling
// the rest would cost.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Book, error) {
	b, err := s.store.GetBook(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.annotate(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

// List lists the learner's books, a knowledge base's when kbID is set.
func (s *Service) List(ctx context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]Book, error) {
	return s.store.ListBooks(ctx, userID, kbID)
}

// Delete removes a book; its chapters, blocks and flash cards go by cascade.
// The questions its quiz blocks wrote stay in the bank with their attempts.
func (s *Service) Delete(ctx context.Context, userID, id uuid.UUID) error {
	b, err := s.store.DeleteBook(ctx, userID, id)
	if err != nil {
		return ErrNotFound
	}
	if b.JobID != nil {
		_, _ = s.queue.RequestCancel(ctx, userID, *b.JobID)
	}
	return nil
}

// Cancel stops a compile after the call in flight.
func (s *Service) Cancel(ctx context.Context, userID, id uuid.UUID) error {
	b, err := s.store.GetBook(ctx, userID, id)
	if err != nil || b.JobID == nil {
		return ErrNotFound
	}
	if ok, err := s.queue.RequestCancel(ctx, userID, *b.JobID); err != nil {
		return err
	} else if !ok {
		return ErrNotFound
	}
	return nil
}

// ChapterView is a chapter with its blocks, for the reader.
type ChapterView struct {
	Chapter Chapter `json:"chapter"`
	Blocks  []Block `json:"blocks"`
}

// Chapter reads one chapter of a book with its blocks: quiz blocks with their
// questions (their answers only once attempted) and flash-card blocks with
// their cards. The ids in a block's payload are resolved with the caller's
// user_id; one that no longer resolves is simply absent.
func (s *Service) Chapter(ctx context.Context, userID, bookID, chapterID uuid.UUID) (*ChapterView, error) {
	ch, err := s.store.GetChapter(ctx, userID, bookID, chapterID)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.freshness(ctx, userID, ch); err != nil {
		return nil, err
	}
	blocks, err := s.store.Blocks(ctx, userID, chapterID)
	if err != nil {
		return nil, err
	}
	for i := range blocks {
		if err := s.fill(ctx, userID, &blocks[i]); err != nil {
			return nil, err
		}
	}
	return &ChapterView{Chapter: *ch, Blocks: blocks}, nil
}

func (s *Service) fill(ctx context.Context, userID uuid.UUID, b *Block) error {
	switch b.Type {
	case TypeQuiz:
		var p QuizPayload
		_ = json.Unmarshal(b.Payload, &p)
		b.Questions = []map[string]any{}
		for _, id := range p.QuestionIDs {
			q, attempts, err := s.quiz.Get(ctx, userID, id)
			if err != nil {
				continue
			}
			b.Questions = append(b.Questions, q.View(len(attempts) > 0))
		}
	case TypeFlashCards:
		cards, on, err := s.store.FlashCards(ctx, userID, b.ID)
		if err != nil {
			return err
		}
		b.Cards, b.InReview = cards, &on
	}
	return nil
}

// AddNote appends the learner's own note block to a chapter. Citation
// markers are removed: a note's sources are the learner's to write in words.
func (s *Service) AddNote(ctx context.Context, userID, bookID, chapterID uuid.UUID, markdown string) (*Block, error) {
	text := strings.TrimSpace(citations.Strip(markdown))
	if text == "" || utf8.RuneCountInString(text) > maxNote {
		return nil, fmt.Errorf("%w: a note is 1 to %d characters", ErrBadRequest, maxNote)
	}
	if _, err := s.store.GetChapter(ctx, userID, bookID, chapterID); err != nil {
		return nil, ErrNotFound
	}
	return s.store.AddNote(ctx, userID, bookID, chapterID, text)
}

// SetInReview puts a flash-card block's cards in or out of the Book cards
// queue ("Add to review", on by default).
func (s *Service) SetInReview(ctx context.Context, userID, bookID, blockID uuid.UUID, on bool) error {
	blk, _, err := s.store.GetBlock(ctx, userID, bookID, blockID)
	if err != nil {
		return ErrNotFound
	}
	if blk.Type != TypeFlashCards {
		return fmt.Errorf("%w: only a flash-card block has cards to review", ErrBadRequest)
	}
	return s.store.SetInReview(ctx, userID, bookID, blockID, on)
}

// annotate sets what the reader shows beside the rows: each chapter's
// freshness and cost, the book's total cost, and the running job's progress.
func (s *Service) annotate(ctx context.Context, b *Book) error {
	b.EstimatedCalls = 0
	for i := range b.Chapters {
		ch := &b.Chapters[i]
		if err := s.freshness(ctx, b.UserID, ch); err != nil {
			return err
		}
		if ch.Status == ChapterCompiling {
			b.Compiling = true
		}
		// "Write every chapter" writes what is unfinished; it refreshes nothing.
		if ch.Status != ChapterCompiling && (ch.Status != ChapterReady || ch.Ready < ch.Blocks) {
			if ch.Blocks == 0 {
				b.EstimatedCalls += 1 + MaxBlocks
			} else {
				b.EstimatedCalls += ch.Blocks - ch.Ready
			}
		}
	}
	if b.JobID != nil {
		if job, err := s.queue.Get(ctx, *b.JobID); err == nil && job.UserID == b.UserID {
			p := jobs.ProgressOf(job)
			b.Progress = &p
		}
	}
	return nil
}

// freshness marks a chapter stale when a document it was written from has a
// new version, or is gone, and sets what compiling it would cost.
func (s *Service) freshness(ctx context.Context, userID uuid.UUID, ch *Chapter) error {
	defer func() { ch.EstimatedCalls = EstimateCalls(*ch) }()
	if len(ch.SourceVersions) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(ch.SourceVersions))
	for raw := range ch.SourceVersions {
		if id, err := uuid.Parse(raw); err == nil {
			ids = append(ids, id)
		}
	}
	now, err := s.store.DocumentVersions(ctx, userID, ids)
	if err != nil {
		return err
	}
	for doc, v := range ch.SourceVersions {
		if cur, ok := now[doc]; !ok || cur != v {
			ch.Stale = true
		}
	}
	return nil
}

// EstimateCalls is what compiling a chapter would bill: the plan and every
// block when it has no plan yet (at most MaxBlocks), otherwise the blocks not
// yet written — every block, for a chapter being refreshed.
func EstimateCalls(ch Chapter) int {
	switch {
	case ch.Blocks == 0:
		return 1 + MaxBlocks
	case Refreshes(ch):
		return ch.Blocks
	default:
		return ch.Blocks - ch.Ready
	}
}

// Refreshes reports whether compiling a chapter rewrites all of it: when its
// sources changed since it was written, or when every block is written and
// the learner asks again.
func Refreshes(ch Chapter) bool {
	return ch.Blocks > 0 && (ch.Stale || ch.Ready == ch.Blocks)
}
