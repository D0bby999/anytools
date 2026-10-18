// Package exam is the exam mimic (learning depth, phase 3): a past paper
// becomes a template the learner reviews, and a mock exam generated from one
// of their knowledge bases copies its structure — each item's type,
// difficulty and points.
//
// DeepTutor's design (findings §2), with its two weaknesses removed: the paper
// is extracted in batches of at most 8 pages, so nothing past a character
// limit is silently dropped, and no template is used until the learner has
// reviewed it and marked it ready.
//
// The engine decides; the model proposes. Extraction and generation are
// model calls whose JSON Go validates: a question of the wrong type, an mcq
// whose answer is not one of its options, a rubric whose points do not add
// up, an uncited question — each gets one repair and is then dropped with its
// reason. Marking runs every item through the question bank's own attempt
// path (quiz.Service.Attempt), so an exam mistake is a bank mistake: it opens
// an error record, appears in Practice, and counts as Loop evidence.
//
// Both jobs bill the learner many times and are resumable units
// (jobs.RunUnits): each extracted batch and each generated item is stored as
// it finishes, a retry resumes at the first unit not done, and Cancel stops
// after the unit in flight.
package exam

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Blob namespaces: the uploaded paper (a PDF for a PDF or an image), and the
// page-marked Markdown read from it, both keyed by the template id.
const (
	nsPaper  = "exam_papers"
	nsParsed = "exam_parsed"
)

// Limits.
const (
	// MaxUploadBytes and MaxPages bound one paper.
	MaxUploadBytes = 20 << 20
	MaxPages       = 40
	// BatchPages is the extraction window: one model call per 8 pages.
	BatchPages = 8
	// MaxItems is the most questions a template may hold.
	MaxItems = 100
	// MaxGenerate caps one mock exam: 60 items is up to 120 calls on the
	// learner's key, shown to them before they press Generate.
	MaxGenerate = 60
	// RetrievalLimit is how many passages each generated item sees.
	RetrievalLimit = 8
	// MarkWorkers is how many answers are marked at once on submit.
	MarkWorkers = 4
)

// Template statuses, as exam_templates' CHECK names them.
const (
	TemplateQueued     = "queued"
	TemplateParsing    = "parsing"
	TemplateExtracting = "extracting"
	TemplateReview     = "review"
	TemplateReady      = "ready"
	TemplateFailed     = "failed"
)

// Exam statuses, as exams' CHECK names them.
const (
	ExamGenerating = "generating"
	ExamReady      = "ready"
	ExamInProgress = "in_progress"
	ExamSubmitted  = "submitted"
	ExamFailed     = "failed"
)

// Paper kinds. A pdf or image paper is stored as PDF and rendered page by
// page in the browser; a docx or text paper has no pages to show.
const (
	KindPDF   = "pdf"
	KindImage = "image"
	KindDOCX  = "docx"
	KindText  = "text"
)

var (
	// ErrNotFound covers "not yours" and "does not exist" alike.
	ErrNotFound = errors.New("exam: not found")
	// ErrBadRequest is a request the learner can fix.
	ErrBadRequest = errors.New("exam: bad request")
	// ErrUnsupported is a file that is not a paper AnyTools can read.
	ErrUnsupported = errors.New("exam: unsupported file")
	// ErrNeedsParseModel is a scanned paper (or a photo) with no parse model
	// routed: nothing local can read it.
	ErrNeedsParseModel = errors.New("exam: this paper has no text layer, so reading it needs a parse model")
	// ErrNotReady is generating from a template not yet marked ready.
	ErrNotReady = errors.New("exam: the template has not been reviewed and marked ready")
	// ErrConflict is an action the exam's state does not allow now.
	ErrConflict = errors.New("exam: not allowed in this state")
	// ErrMarkingIncomplete is a submit whose marking stopped part-way. The
	// marked items are kept; submitting again marks the rest.
	ErrMarkingIncomplete = errors.New("exam: marking stopped before every answer was marked")
)

// Template is one row of exam_templates.
type Template struct {
	ID               uuid.UUID  `json:"id"`
	UserID           uuid.UUID  `json:"-"`
	Title            string     `json:"title"`
	Filename         string     `json:"filename"`
	Kind             string     `json:"kind"`
	SHA256           string     `json:"-"`
	Bytes            int64      `json:"bytes"`
	PageCount        int        `json:"page_count"`
	Status           string     `json:"status"`
	Error            string     `json:"error,omitempty"`
	ParsedBy         string     `json:"parsed_by,omitempty"`
	Items            []Item     `json:"items"`
	Warnings         []string   `json:"warnings"`
	TotalPoints      float64    `json:"total_points"`
	TimeLimitMinutes *int       `json:"time_limit_minutes,omitempty"`
	JobID            *uuid.UUID `json:"job_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

// Exam is one row of exams.
type Exam struct {
	ID               uuid.UUID  `json:"id"`
	UserID           uuid.UUID  `json:"-"`
	TemplateID       *uuid.UUID `json:"template_id,omitempty"`
	KBID             uuid.UUID  `json:"kb_id"`
	Title            string     `json:"title"`
	Status           string     `json:"status"`
	Error            string     `json:"error,omitempty"`
	Blueprint        []Item     `json:"-"`
	Requested        int        `json:"requested"`
	Generated        int        `json:"generated"`
	Dropped          []Dropped  `json:"dropped"`
	TimeLimitMinutes *int       `json:"time_limit_minutes,omitempty"`
	StartedAt        *time.Time `json:"started_at,omitempty"`
	SubmittedAt      *time.Time `json:"submitted_at,omitempty"`
	Score            *float64   `json:"score,omitempty"`
	MaxScore         *float64   `json:"max_score,omitempty"`
	JobID            *uuid.UUID `json:"job_id,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// Dropped is a template item the generator gave up on, and why.
type Dropped struct {
	Ord    int    `json:"ord"`
	Number string `json:"number"`
	Reason string `json:"reason"`
}

// ExamItem is one generated item: a bank question, its points, the learner's
// answer and, once marked, its attempt and score.
type ExamItem struct {
	ID             uuid.UUID     `json:"id"`
	Ord            int           `json:"ord"`
	Number         string        `json:"number"`
	Points         float64       `json:"points"`
	Question       quiz.Question `json:"-"`
	Answer         string        `json:"answer"`
	AttemptID      *uuid.UUID    `json:"-"`
	Score          *float64      `json:"score,omitempty"`
	AttemptCorrect *bool         `json:"-"`
	Judge          []byte        `json:"-"`
}

// Answer is one autosaved answer.
type Answer struct {
	ItemID uuid.UUID
	Text   string
}

// Store is the persistence the service needs (pg.ExamStore).
type Store interface {
	CreateTemplate(ctx context.Context, t Template) (*Template, error)
	GetTemplate(ctx context.Context, userID, id uuid.UUID) (*Template, error)
	ListTemplates(ctx context.Context, userID uuid.UUID) ([]Template, error)
	SetTemplateJob(ctx context.Context, userID, id, jobID uuid.UUID) error
	SetTemplateStatus(ctx context.Context, userID, id uuid.UUID, status, parsedBy string) error
	// SaveBatch stores one extraction batch, replacing a previous attempt's.
	SaveBatch(ctx context.Context, userID, templateID uuid.UUID, batch int, items []Item) error
	Batches(ctx context.Context, userID, templateID uuid.UUID) (map[int][]Item, error)
	// FinishExtraction stores the merged items and moves the template to review.
	FinishExtraction(ctx context.Context, userID, id uuid.UUID, items []Item, warnings []string, total float64) error
	// SaveTemplate stores a reviewed template (items, title, limit, status).
	SaveTemplate(ctx context.Context, t Template) (*Template, error)
	FailTemplate(ctx context.Context, userID, id uuid.UUID, message string) error
	DeleteTemplate(ctx context.Context, userID, id uuid.UUID) (*Template, error)

	CreateExam(ctx context.Context, e Exam) (*Exam, error)
	GetExam(ctx context.Context, userID, id uuid.UUID) (*Exam, error)
	ListExams(ctx context.Context, userID uuid.UUID) ([]Exam, error)
	SetExamJob(ctx context.Context, userID, id, jobID uuid.UUID) error
	// HasUnit reports whether item ord was generated or dropped already.
	HasUnit(ctx context.Context, userID, examID uuid.UUID, ord int) (bool, error)
	// AddGeneratedItem stores the question and the exam item in one
	// transaction, and counts it.
	AddGeneratedItem(ctx context.Context, examID uuid.UUID, ord int, q quiz.Question, points float64, number string) error
	AddDropped(ctx context.Context, userID, examID uuid.UUID, d Dropped) error
	// FinishGeneration moves a generating exam to ready, or to failed when
	// nothing was generated.
	FinishGeneration(ctx context.Context, userID, examID uuid.UUID, failure string) error
	Items(ctx context.Context, userID, examID uuid.UUID) ([]ExamItem, error)
	// Start moves a ready exam to in_progress, and reports false otherwise.
	Start(ctx context.Context, userID, examID uuid.UUID, limit *int, now time.Time) (bool, error)
	// SaveAnswers stores answers to an exam in progress, all or none: an item
	// that is not this exam's is ErrNotFound.
	SaveAnswers(ctx context.Context, userID, examID uuid.UUID, answers []Answer, now time.Time) error
	// BeginSubmit sets submitted_at once, on an exam in progress, and returns
	// the exam; an exam already submitted is returned unchanged.
	BeginSubmit(ctx context.Context, userID, examID uuid.UUID, now time.Time) (*Exam, error)
	SaveMark(ctx context.Context, userID, itemID, attemptID uuid.UUID, score float64) error
	FinishMarking(ctx context.Context, userID, examID uuid.UUID, score, max float64) error
	DeleteExam(ctx context.Context, userID, id uuid.UUID) (*Exam, error)
	// JobProgress reads a job's checkpoint, scoped to its owner.
	JobProgress(ctx context.Context, userID, jobID uuid.UUID) (jobs.Progress, error)
}

// Authorizer answers "does this user own this knowledge base".
type Authorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
}

// Parsers is the learner's `parse` chain, best first; empty when none is
// routed.
type Parsers interface {
	ParserChain(ctx context.Context, userID uuid.UUID) ([]parse.PageParser, error)
}

// Marker is the question bank: every answer is marked and recorded through
// it (quiz.Service).
type Marker interface {
	Attempt(ctx context.Context, userID, questionID uuid.UUID, req quiz.AttemptRequest) (*quiz.AttemptResult, error)
	Sources(ctx context.Context, userID uuid.UUID, qs ...quiz.Question) []citations.Source
}

// Queue is the slice of jobs.Queue the service uses.
type Queue interface {
	Enqueue(ctx context.Context, userID uuid.UUID, kind string, payload any, maxAttempts int) (uuid.UUID, error)
	RunUnits(ctx context.Context, job *jobs.Job, total int, unit jobs.UnitFunc) error
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
}

// Files are the per-row objects: the paper and its parsed text.
type Files interface {
	PutObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID, data []byte) error
	GetObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) ([]byte, error)
	DeleteObject(ctx context.Context, userID uuid.UUID, namespace string, id uuid.UUID) error
}

// Service is the exam mimic.
type Service struct {
	store     Store
	authz     Authorizer
	parsers   Parsers
	models    runtime.ChatProviderResolver
	retriever quiz.Retriever
	marker    Marker
	queue     Queue
	files     Files
	batcher   *parse.Batcher
	now       func() time.Time
}

// Deps are the service's collaborators.
type Deps struct {
	Store     Store
	Authz     Authorizer
	Parsers   Parsers
	Models    runtime.ChatProviderResolver
	Retriever quiz.Retriever
	Marker    Marker
	Queue     Queue
	Files     Files
	// Now defaults to time.Now.
	Now func() time.Time
}

// NewService builds the service.
func NewService(d Deps) *Service {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		store: d.Store, authz: d.Authz, parsers: d.Parsers, models: d.Models,
		retriever: d.Retriever, marker: d.Marker, queue: d.Queue, files: d.Files,
		batcher: parse.NewBatcher(parse.Options{}), now: now,
	}
}

// functionQuiz is the route extraction, generation and marking use: they
// are question-writing calls. Reading the paper uses `parse`.
const functionQuiz = "quiz"

// ── templates ─────────────────────────────────────────────────────────────

// Templates lists the learner's templates, newest first.
func (s *Service) Templates(ctx context.Context, userID uuid.UUID) ([]Template, error) {
	return s.store.ListTemplates(ctx, userID)
}

// Template reads one template.
func (s *Service) Template(ctx context.Context, userID, id uuid.UUID) (*Template, error) {
	t, err := s.store.GetTemplate(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return t, nil
}

// TemplateProgress is an extraction's checkpoint: batches done, of how many,
// and the calls billed so far.
func (s *Service) TemplateProgress(ctx context.Context, t *Template) *jobs.Progress {
	return s.progress(ctx, t.UserID, t.JobID)
}

// Paper returns the stored paper's bytes and kind, for the browser to render.
func (s *Service) Paper(ctx context.Context, userID, id uuid.UUID) ([]byte, *Template, error) {
	t, err := s.store.GetTemplate(ctx, userID, id)
	if err != nil {
		return nil, nil, ErrNotFound
	}
	data, err := s.files.GetObject(ctx, userID, nsPaper, id)
	if _, ok := blob.Unavailable(err); ok {
		return nil, nil, err
	}
	if err != nil {
		return nil, nil, ErrNotFound
	}
	return data, t, nil
}

// Review is `PUT /v1/exams/templates/{id}`: the learner's corrections.
type Review struct {
	Title            *string `json:"title,omitempty"`
	TimeLimitMinutes *int    `json:"time_limit_minutes,omitempty"`
	// ClearTimeLimit removes the limit (a null cannot say that in JSON).
	ClearTimeLimit bool `json:"clear_time_limit,omitempty"`
	// Items replaces the whole list when present. Issues are recomputed here,
	// never read from the request.
	Items []Item `json:"items,omitempty"`
	// Ready marks the template ready (true) or back in review (false).
	Ready *bool `json:"ready,omitempty"`
}

// SaveReview applies the learner's edits. A template is ready only when it
// has items and none of them has an issue.
func (s *Service) SaveReview(ctx context.Context, userID, id uuid.UUID, r Review) (*Template, error) {
	t, err := s.store.GetTemplate(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	if t.Status != TemplateReview && t.Status != TemplateReady {
		return nil, ErrConflict
	}
	if r.Title != nil {
		title := trimRunes(*r.Title, 200)
		if title == "" {
			return nil, errorf("a template needs a title")
		}
		t.Title = title
	}
	if r.ClearTimeLimit {
		t.TimeLimitMinutes = nil
	} else if r.TimeLimitMinutes != nil {
		if *r.TimeLimitMinutes < 1 || *r.TimeLimitMinutes > 600 {
			return nil, errorf("the time limit is 1 to 600 minutes")
		}
		t.TimeLimitMinutes = r.TimeLimitMinutes
	}
	if r.Items != nil {
		if len(r.Items) > MaxItems {
			return nil, errorf("a template holds at most %d questions", MaxItems)
		}
		t.Items, t.Warnings = ValidateItems(r.Items, t.PageCount)
		t.TotalPoints = TotalPoints(t.Items)
	}
	switch {
	case r.Ready != nil && *r.Ready:
		if len(t.Items) == 0 {
			return nil, errorf("a template needs at least one question")
		}
		if n := countIssues(t.Items); n > 0 {
			return nil, errorf("fix the %d question(s) marked with a problem first", n)
		}
		t.Status = TemplateReady
	case r.Ready != nil:
		t.Status = TemplateReview
	case countIssues(t.Items) > 0:
		t.Status = TemplateReview
	}
	return s.store.SaveTemplate(ctx, *t)
}

// DeleteTemplate removes a template and its files, and stops its extraction.
// Exams made from it keep their questions.
func (s *Service) DeleteTemplate(ctx context.Context, userID, id uuid.UUID) error {
	t, err := s.store.DeleteTemplate(ctx, userID, id)
	if err != nil {
		return ErrNotFound
	}
	if t.JobID != nil {
		_, _ = s.queue.RequestCancel(ctx, userID, *t.JobID)
	}
	_ = s.files.DeleteObject(ctx, userID, nsPaper, id)
	_ = s.files.DeleteObject(ctx, userID, nsParsed, id)
	return nil
}

// CancelTemplate stops an extraction after the batch in flight.
func (s *Service) CancelTemplate(ctx context.Context, userID, id uuid.UUID) error {
	t, err := s.store.GetTemplate(ctx, userID, id)
	if err != nil || t.JobID == nil {
		return ErrNotFound
	}
	ok, err := s.queue.RequestCancel(ctx, userID, *t.JobID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConflict
	}
	return nil
}

// ── exams ─────────────────────────────────────────────────────────────────

// Exams lists the learner's exams, newest first.
func (s *Service) Exams(ctx context.Context, userID uuid.UUID) ([]Exam, error) {
	return s.store.ListExams(ctx, userID)
}

// DeleteExam removes an exam and stops its generation. Its questions stay in
// the bank, with their attempts and mistakes.
func (s *Service) DeleteExam(ctx context.Context, userID, id uuid.UUID) error {
	e, err := s.store.DeleteExam(ctx, userID, id)
	if err != nil {
		return ErrNotFound
	}
	if e.JobID != nil {
		_, _ = s.queue.RequestCancel(ctx, userID, *e.JobID)
	}
	return nil
}

// CancelExam stops a generation after the item in flight; the items already
// generated make a shorter exam.
func (s *Service) CancelExam(ctx context.Context, userID, id uuid.UUID) error {
	e, err := s.store.GetExam(ctx, userID, id)
	if err != nil || e.JobID == nil {
		return ErrNotFound
	}
	ok, err := s.queue.RequestCancel(ctx, userID, *e.JobID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConflict
	}
	return nil
}

func (s *Service) progress(ctx context.Context, userID uuid.UUID, jobID *uuid.UUID) *jobs.Progress {
	if jobID == nil {
		return nil
	}
	p, err := s.store.JobProgress(ctx, userID, *jobID)
	if err != nil {
		return nil
	}
	return &p
}
