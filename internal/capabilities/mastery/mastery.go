// Package mastery is the mastery path: a goal, modules of knowledge points,
// a diagnostic, a session that serves what is most at risk, and graduation.
//
// Like internal/capabilities/quiz it is a service rather than a
// runtime.Capability — see that package's ports.go for why — and it resolves
// its model through the byok route function `mastery`
// (internal/byok.FunctionMastery), which red-team RT-13 added to the enum
// precisely so this surface could be routed separately from chat.
//
// The one-way dependency mastery → quiz is deliberate. A mastery session's
// questions ARE bank questions with a knowledge point attached; generating and
// judging them through a second code path would give the product two ways to
// mark an answer and two places for the FSRS write to be forgotten.
package mastery

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Path statuses, exactly as `mastery_paths.status` CHECKs them.
const (
	StatusActive   = "active"
	StatusArchived = "archived"
)

// Knowledge-point state, exactly as `kp_state.status` CHECKs them.
const (
	KPActive    = "active"
	KPGraduated = "graduated"
)

// DefaultPassThreshold is `mastery_modules.pass_threshold`'s default, repeated
// here because the proposal builder needs a value before a row exists.
const DefaultPassThreshold = 0.7

// MaxModules and MaxKnowledgePoints bound what a model may propose.
//
// A path is a study plan a person has to actually work through. Forty modules
// is not a plan, it is a table of contents with a progress bar, and approving
// one creates hundreds of cards that will never come due in a useful order.
const (
	MaxModules            = 12
	MaxKnowledgePoints    = 10
	MaxKnowledgePointsAll = 60
)

// DiagnosticQuestions is how many questions the opening diagnostic asks.
const DiagnosticQuestions = 8

// Errors. ErrNoAccess and ErrNotFound are the same answer to the caller for the
// same reason as everywhere else in this codebase: distinguishing them turns an
// endpoint taking an id into an existence oracle.
var (
	ErrNoAccess   = errors.New("mastery: no access")
	ErrNotFound   = errors.New("mastery: not found")
	ErrBadRequest = errors.New("mastery: bad request")
	// ErrNotApproved is returned when a session or diagnostic is asked for on a
	// path whose proposed modules nobody has accepted yet.
	ErrNotApproved = errors.New("mastery: this path has no approved modules yet")
	// ErrNothingDue is returned when the session has nothing left to serve.
	ErrNothingDue = errors.New("mastery: nothing to study right now")
)

// Path is one goal inside one knowledge base.
type Path struct {
	ID        uuid.UUID `json:"id"`
	UserID    uuid.UUID `json:"-"`
	KBID      uuid.UUID `json:"kb_id"`
	Goal      string    `json:"goal"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PathSummary is a path with the numbers the list screen shows.
type PathSummary struct {
	Path      Path    `json:"path"`
	KBName    string  `json:"kb_name"`
	Modules   int     `json:"modules"`
	Points    int     `json:"knowledge_points"`
	DueCount  int     `json:"due_count"`
	Mastery   float64 `json:"mastery"`
	Graduated int     `json:"graduated_modules"`
}

// Module is one stage of a path.
type Module struct {
	ID            uuid.UUID `json:"id"`
	UserID        uuid.UUID `json:"-"`
	PathID        uuid.UUID `json:"path_id"`
	Ord           int       `json:"ord"`
	Name          string    `json:"name"`
	Objective     string    `json:"objective"`
	PassThreshold float64   `json:"pass_threshold"`
}

// KnowledgePoint is one atom a card is scheduled against.
type KnowledgePoint struct {
	ID       uuid.UUID `json:"id"`
	UserID   uuid.UUID `json:"-"`
	ModuleID uuid.UUID `json:"module_id"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
}

// KPState is one knowledge point's schedule and estimate.
type KPState struct {
	DueAt           time.Time `json:"due_at"`
	MasteryEstimate float64   `json:"mastery_estimate"`
	Status          string    `json:"status"`
	Reviews         int       `json:"reviews"`
	Lapses          int       `json:"lapses"`
	// ExplainPassedAt is when the point's explain-back was passed (phase 2's
	// gate for concept and design points); nil until then.
	ExplainPassedAt *time.Time `json:"explain_passed_at,omitempty"`
}

// KPView pairs a knowledge point with its state, for the module map.
type KPView struct {
	KnowledgePoint KnowledgePoint `json:"knowledge_point"`
	State          KPState        `json:"state"`
	Due            bool           `json:"due"`
}

// ModuleView is a module with everything the map screen renders.
type ModuleView struct {
	Module          Module   `json:"module"`
	KnowledgePoints []KPView `json:"knowledge_points"`
	Mastery         float64  `json:"mastery"`
	DueCount        int      `json:"due_count"`
	Graduated       bool     `json:"graduated"`
}

// PathDetail is the whole path as the module map shows it.
type PathDetail struct {
	Path     Path         `json:"path"`
	KBName   string       `json:"kb_name"`
	Modules  []ModuleView `json:"modules"`
	DueCount int          `json:"due_count"`
	Mastery  float64      `json:"mastery"`
	// ExplainGate is true when concept and design points must be explained
	// back before their module graduates: paths created after the
	// learning-depth migration (mastery_paths.explain_gate).
	ExplainGate bool `json:"explain_gate"`
}

// ProposedKP is one knowledge point in a proposal — not yet a row.
type ProposedKP struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// ProposedModule is one module in a proposal.
type ProposedModule struct {
	Name            string       `json:"name"`
	Objective       string       `json:"objective"`
	PassThreshold   float64      `json:"pass_threshold"`
	KnowledgePoints []ProposedKP `json:"knowledge_points"`
}

// Proposal is what the model suggests and the learner approves or edits.
//
// It is returned, NOT stored. Phase-07 says the modules come "from the KB
// outline (user approves/edits)", and a proposal written straight into
// `mastery_modules` would make approval a formality performed after the fact —
// the rows would already exist, the cards would already be scheduled, and
// "edit" would mean deleting someone else's plan rather than accepting a
// suggestion.
type Proposal struct {
	Modules []ProposedModule `json:"modules"`
	Note    string           `json:"note,omitempty"`
	Model   string           `json:"model,omitempty"`
}

// DueItem is one knowledge point waiting, across all of a user's paths.
type DueItem struct {
	KPID       uuid.UUID `json:"knowledge_point_id"`
	KPName     string    `json:"knowledge_point_name"`
	Type       string    `json:"type"`
	ModuleID   uuid.UUID `json:"module_id"`
	ModuleName string    `json:"module_name"`
	PathID     uuid.UUID `json:"path_id"`
	PathGoal   string    `json:"path_goal"`
	DueAt      time.Time `json:"due_at"`
}

// GraduatedModule records a module crossing its bar.
type GraduatedModule struct {
	ModuleID uuid.UUID `json:"module_id"`
	Name     string    `json:"name"`
	Mastery  float64   `json:"mastery"`
}

// ErrorRecordView is one open mistake, for the error-attribution card.
type ErrorRecordView struct {
	ID              uuid.UUID `json:"id"`
	QuestionID      uuid.UUID `json:"question_id"`
	Prompt          string    `json:"prompt"`
	KPName          string    `json:"knowledge_point_name"`
	ErrorType       string    `json:"error_type"`
	SelfAttribution string    `json:"self_attribution"`
	AIConfirmation  string    `json:"ai_confirmation"`
	Retries         int       `json:"retries"`
	Status          string    `json:"status"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// DueDigest is one user's "due today" summary, produced by the nightly job.
//
// An ALIAS of learning.DueSummary, not a copy. The job lives in
// internal/learning and this package already imports it; a second struct with
// the same fields would need a converter in the store, and the converter is
// where a field added on one side goes missing on the other.
type DueDigest = learning.DueSummary

// Store is the persistence this service needs. pg.MasteryStore implements it.
type Store interface {
	CreatePath(ctx context.Context, p Path) (*Path, error)
	ListPaths(ctx context.Context, userID uuid.UUID, now time.Time) ([]PathSummary, error)
	GetPath(ctx context.Context, userID, pathID uuid.UUID) (*Path, error)
	ArchivePath(ctx context.Context, userID, pathID uuid.UUID) error

	// ApproveModules replaces a path's modules with the approved list and seeds
	// one FSRS card per knowledge point, all in one transaction.
	ApproveModules(ctx context.Context, userID, pathID uuid.UUID, modules []ProposedModule, now time.Time) (*PathDetail, error)
	Detail(ctx context.Context, userID, pathID uuid.UUID, now time.Time) (*PathDetail, error)

	// Candidates returns the path's active knowledge points with the numbers
	// learning.Rank orders by.
	Candidates(ctx context.Context, userID, pathID uuid.UUID) ([]learning.Candidate, error)
	// UnansweredQuestion returns a question for this knowledge point that the
	// learner has never attempted, if one is already banked.
	UnansweredQuestion(ctx context.Context, userID, kpID uuid.UUID) (*quiz.Question, error)
	// KnowledgePoint reads one point and the module it belongs to.
	KnowledgePoint(ctx context.Context, userID, kpID uuid.UUID) (*KnowledgePoint, *Module, error)

	// Due lists what is waiting across every active path.
	Due(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]DueItem, error)
	// DueDigests is the nightly job's query: one row per user with anything
	// active. It is NOT user-scoped, and it is the only method here that is not.
	DueDigests(ctx context.Context, now time.Time) ([]DueDigest, error)

	// Graduate marks every module that has crossed its bar, and retires the
	// cards underneath it. Idempotent: a module already graduated returns
	// nothing.
	Graduate(ctx context.Context, userID, pathID uuid.UUID, now time.Time) ([]GraduatedModule, error)
	// AppendEvent writes one append-only mastery event and returns its revision.
	AppendEvent(ctx context.Context, userID, pathID uuid.UUID, eventType string, payload any) (int64, error)
	// OpenErrors lists the path's unresolved mistakes.
	OpenErrors(ctx context.Context, userID, pathID uuid.UUID, limit int) ([]ErrorRecordView, error)

	// LearnStore is the learn and explain-back half (learn.go).
	LearnStore
	// ReviewStore is the cross-path review (review.go).
	ReviewStore
}

// Outline is the knowledge-base summary a proposal is built from.
type Outline interface {
	// Outline returns a short structural summary of the knowledge base: what
	// documents it holds and what headings they use.
	Outline(ctx context.Context, userID, kbID uuid.UUID, limit int) (string, error)
}

// Authorizer answers "does this user own this knowledge base".
type Authorizer interface {
	OwnsKB(ctx context.Context, userID, kbID uuid.UUID) error
}

// Quiz is the question half, satisfied by *quiz.Service.
type Quiz interface {
	Generate(ctx context.Context, userID uuid.UUID, req quiz.GenerateRequest) (*quiz.GenerateResult, error)
}

// Service is the mastery application logic.
type Service struct {
	store     Store
	quiz      Quiz
	outline   Outline
	providers runtime.ChatProviderResolver
	authz     Authorizer
	retriever quiz.Retriever
	profile   Profile
	now       func() time.Time
}

// Config assembles a Service.
type Config struct {
	Store     Store
	Quiz      Quiz
	Outline   Outline
	Providers runtime.ChatProviderResolver
	Authz     Authorizer
	// Retriever finds the passages a point is taught from and an
	// explain-back is judged against: quiz's retriever, one knowledge base.
	Retriever quiz.Retriever
	// Profile is the learner profile's note for learn and explain-back
	// (learning-depth phase 9); nil reads no profile.
	Profile Profile
	Now     func() time.Time
}

// NewService returns a Service.
func NewService(cfg Config) *Service {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		store:     cfg.Store,
		quiz:      cfg.Quiz,
		outline:   cfg.Outline,
		providers: cfg.Providers,
		authz:     cfg.Authz,
		retriever: cfg.Retriever,
		profile:   cfg.Profile,
		now:       now,
	}
}

// functionMastery is the byok route function this capability resolves through.
// A local constant for the same reason quiz has one: this package should not
// need the BYOK subsystem to compile.
const functionMastery = "mastery"

// Due lists what is waiting across all of a user's paths, computed on read.
//
// This is the query behind the Due widget and the session's queue, and it is
// the reason `kp_state.due_at` is a column rather than a jsonb extraction:
// `WHERE due_at <= now()` against a partial index is the whole mechanism by
// which a card that failed ten minutes ago is visible now (red-team RT-12).
func (s *Service) Due(ctx context.Context, userID uuid.UUID, limit int) ([]DueItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return s.store.Due(ctx, userID, s.now().UTC(), limit)
}

// Paths lists a user's paths.
func (s *Service) Paths(ctx context.Context, userID uuid.UUID) ([]PathSummary, error) {
	return s.store.ListPaths(ctx, userID, s.now().UTC())
}

// Detail returns one path's module map.
func (s *Service) Detail(ctx context.Context, userID, pathID uuid.UUID) (*PathDetail, error) {
	detail, err := s.store.Detail(ctx, userID, pathID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	gate, passed, err := s.store.ExplainStatus(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}
	detail.ExplainGate = gate
	for i := range detail.Modules {
		for j := range detail.Modules[i].KnowledgePoints {
			kp := &detail.Modules[i].KnowledgePoints[j]
			if at, ok := passed[kp.KnowledgePoint.ID]; ok {
				at := at
				kp.State.ExplainPassedAt = &at
			}
		}
	}
	return detail, nil
}

// OpenErrors lists a path's unresolved mistakes, for the attribution card.
func (s *Service) OpenErrors(ctx context.Context, userID, pathID uuid.UUID) ([]ErrorRecordView, error) {
	if _, err := s.store.GetPath(ctx, userID, pathID); err != nil {
		return nil, err
	}
	return s.store.OpenErrors(ctx, userID, pathID, 50)
}

// Archive retires a path.
func (s *Service) Archive(ctx context.Context, userID, pathID uuid.UUID) error {
	if err := s.store.ArchivePath(ctx, userID, pathID); err != nil {
		return err
	}
	_, err := s.store.AppendEvent(ctx, userID, pathID, "path_archived", map[string]any{})
	return err
}
