package quiz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz/mathcheck"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Question types, exactly as `questions.type` CHECKs them.
const (
	TypeMCQ   = "mcq"
	TypeShort = "short"
	TypeTF    = "tf"
	TypeCloze = "cloze"
	// TypeWritten is an essay or calculation question, marked by its rubric
	// with partial credit (mark.go). Only mock exams write one, because only
	// they generate and validate a rubric (learning depth, phase 3).
	TypeWritten = "written"
)

// AllTypes is every question type, in the order the CHECK lists them. A test
// holds it equal to the migration and to ui/web/app/lib/study-types.ts.
func AllTypes() []string {
	return []string{TypeMCQ, TypeShort, TypeTF, TypeCloze, TypeWritten}
}

// Difficulties, exactly as `questions.difficulty` CHECKs them.
const (
	DifficultyEasy   = "easy"
	DifficultyMedium = "medium"
	DifficultyHard   = "hard"
)

// MaxPerRequest caps one generate call.
//
// Twenty, because generation is one model call on the USER'S OWN key and a
// request for two hundred questions is a bill they did not agree to. It is also
// roughly the point past which a generated set stops being about distinct ideas
// and starts rephrasing the same three.
const MaxPerRequest = 20

// DefaultPerRequest is what a request that names no count gets.
const DefaultPerRequest = 5

// RetrievalLimit is how many passages the ideation and generation calls see.
const RetrievalLimit = 12

// ErrNoAccess mirrors authz.ErrNoAccess so handlers have one thing to check.
var ErrNoAccess = errors.New("quiz: no access")

// ErrNotFound is returned for a question or attempt that is not this user's.
// It is deliberately the same answer as "does not exist".
var ErrNotFound = errors.New("quiz: not found")

// ErrNoQuestions is returned when the model could not write a single usable
// question from the passages. It is a real outcome, not a failure: a knowledge
// base of holiday photos has nothing to be asked about.
var ErrNoQuestions = errors.New("quiz: the material did not support any questions")

// ErrBadModelOutput is returned when the model's JSON could not be used.
var ErrBadModelOutput = errors.New("quiz: the model did not return usable questions")

// Option is one choice of a multiple-choice question.
type Option struct {
	Label string `json:"label"`
	Body  string `json:"body"`
}

// Question is one row of the bank.
//
// Answer is present on this struct and ABSENT from what the API returns before
// an attempt — see View. Keeping one struct with a redacted view, rather than
// two structs, means the redaction is a decision made in one place instead of a
// field somebody forgets to leave out of a second type.
type Question struct {
	ID        uuid.UUID  `json:"id"`
	UserID    uuid.UUID  `json:"-"`
	KBID      uuid.UUID  `json:"kb_id"`
	SessionID *uuid.UUID `json:"session_id,omitempty"`

	KnowledgePointID *uuid.UUID `json:"knowledge_point_id,omitempty"`
	ModuleID         *uuid.UUID `json:"module_id,omitempty"`

	Prompt         string      `json:"prompt"`
	Type           string      `json:"type"`
	Options        []Option    `json:"options"`
	Answer         string      `json:"answer"`
	Explanation    string      `json:"explanation"`
	Difficulty     string      `json:"difficulty"`
	SourceChunkIDs []uuid.UUID `json:"source_chunk_ids"`
	// Rubric marks a written question; nil for every other type.
	Rubric    []Criterion `json:"rubric,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
}

// View is the question as the API returns it.
//
// `revealed` is false until the learner has answered. A quiz that ships the
// answer key to the browser alongside the question is not a quiz, and "the UI
// does not render it" is not a control — the JSON is one devtools tab away.
func (q Question) View(revealed bool) map[string]any {
	out := map[string]any{
		"id":               q.ID,
		"kb_id":            q.KBID,
		"prompt":           q.Prompt,
		"type":             q.Type,
		"options":          q.Options,
		"difficulty":       q.Difficulty,
		"source_chunk_ids": q.SourceChunkIDs,
		"created_at":       q.CreatedAt,
		"revealed":         revealed,
	}
	if q.Options == nil {
		out["options"] = []Option{}
	}
	if q.KnowledgePointID != nil {
		out["knowledge_point_id"] = *q.KnowledgePointID
	}
	if q.ModuleID != nil {
		out["module_id"] = *q.ModuleID
	}
	// The card offers a math field when the answer is an expression. It says
	// what kind of answer is expected, as a numeric box would, not the answer.
	if q.IsMath() {
		out["math"] = true
	}
	if revealed {
		out["answer"] = q.Answer
		out["explanation"] = q.Explanation
		// The rubric is part of the answer key: its criteria say what a
		// full answer contains.
		if q.Rubric != nil {
			out["rubric"] = q.Rubric
		}
	}
	return out
}

// Attempt is one answer and its verdict.
type Attempt struct {
	ID         uuid.UUID `json:"id"`
	UserID     uuid.UUID `json:"-"`
	QuestionID uuid.UUID `json:"question_id"`

	KnowledgePointID *uuid.UUID `json:"knowledge_point_id,omitempty"`
	ModuleID         *uuid.UUID `json:"module_id,omitempty"`

	UserAnswer string `json:"user_answer"`
	IsCorrect  bool   `json:"is_correct"`
	// Score is the rubric's partial credit, 0..1, for a written answer; nil
	// for one marked right or wrong. IsCorrect is Score >= PassBar.
	Score           *float64        `json:"score,omitempty"`
	Judge           json.RawMessage `json:"judge"`
	ErrorType       string          `json:"error_type"`
	SelfAttribution string          `json:"self_attribution"`
	Rating          string          `json:"rating"`
	OverriddenAt    *time.Time      `json:"overridden_at,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
}

// AttemptWrite is what the store persists, judgement included.
type AttemptWrite struct {
	UserID     uuid.UUID
	QuestionID uuid.UUID

	KnowledgePointID *uuid.UUID
	ModuleID         *uuid.UUID

	UserAnswer      string
	IsCorrect       bool
	Score           *float64
	Judge           json.RawMessage
	ErrorType       string
	SelfAttribution string
	Rating          string

	// AIConfirmation is what the judge said about the learner's own account of
	// the attempt. It lands on the error record, not the attempt.
	AIConfirmation string

	// Now is the clock the FSRS write uses. It is an explicit field rather than
	// time.Now() inside the store so a test can put a card ten minutes into the
	// future and assert that it comes back.
	Now time.Time
}

// Scheduled is what the FSRS half of an attempt produced. It is nil for a
// question with no knowledge point — a bank question a learner answered for
// practice schedules nothing.
type Scheduled struct {
	KnowledgePointID uuid.UUID `json:"knowledge_point_id"`
	DueAt            time.Time `json:"due_at"`
	MasteryEstimate  float64   `json:"mastery_estimate"`
	Rating           string    `json:"rating"`
	Lapses           int       `json:"lapses"`
}

// BankEntry is a question plus the shape of its history, for the bank screen.
type BankEntry struct {
	Question     Question   `json:"question"`
	Attempts     int        `json:"attempts"`
	LastCorrect  *bool      `json:"last_correct,omitempty"`
	LastAttempt  *time.Time `json:"last_attempt,omitempty"`
	ModuleName   string     `json:"module_name,omitempty"`
	KPName       string     `json:"knowledge_point_name,omitempty"`
	KBName       string     `json:"kb_name,omitempty"`
	LastAnswerID *uuid.UUID `json:"last_attempt_id,omitempty"`
}

// Filter narrows the bank.
type Filter struct {
	KBID             *uuid.UUID
	Type             string
	KnowledgePointID *uuid.UUID
	ModuleID         *uuid.UUID
	// Answered: nil = everything, true = attempted at least once, false = never.
	Answered *bool
	Limit    int
}

// GenerateRequest is `POST /v1/quiz/generate`.
type GenerateRequest struct {
	KBID  uuid.UUID `json:"kb_id"`
	Topic string    `json:"topic,omitempty"`
	N     int       `json:"n,omitempty"`
	Types []string  `json:"types,omitempty"`

	KnowledgePointID *uuid.UUID `json:"knowledge_point_id,omitempty"`
	// ModuleID is set by the mastery session when it generates for a knowledge
	// point; it is denormalized onto the question so the bank can group by
	// module without walking the path.
	ModuleID  *uuid.UUID `json:"-"`
	SessionID *uuid.UUID `json:"session_id,omitempty"`
	// KPName replaces Topic when generating for a named knowledge point: the
	// retrieval query and the model's brief should say "capital adequacy
	// ratio", not the uuid of the row that names it.
	KPName string `json:"-"`
}

// GenerateResult is what a generate call produced, including what it dropped.
type GenerateResult struct {
	Questions []Question `json:"questions"`
	// Requested is what the caller asked for; len(Questions) may be smaller,
	// because a model that cannot support a question from the passages is
	// supposed to return fewer rather than invent one.
	Requested int `json:"requested"`
	// DroppedCitations counts markers the model wrote that no retrieved passage
	// backed. A rising number here is the signal that a prompt or a model has
	// started citing things it was not given.
	DroppedCitations int    `json:"dropped_citations"`
	Model            string `json:"model"`
	Provider         string `json:"provider"`
	// Note is anything the model reported about the material, including a
	// document that tried to address it.
	Note string `json:"note,omitempty"`
}

// Service is the quiz application logic.
type Service struct {
	store     Store
	retriever Retriever
	providers runtime.ChatProviderResolver
	authz     Authorizer
	now       func() time.Time
}

// Config assembles a Service.
type Config struct {
	Store     Store
	Retriever Retriever
	Providers runtime.ChatProviderResolver
	Authz     Authorizer
	// Now defaults to time.Now. Tests set it; the mastery session passes its
	// own so that one session's attempt and its reschedule share an instant.
	Now func() time.Time
}

// NewService returns a Service.
func NewService(cfg Config) *Service {
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		store:     cfg.Store,
		retriever: cfg.Retriever,
		providers: cfg.Providers,
		authz:     cfg.Authz,
		now:       now,
	}
}

// Generate runs ideation → generation → store and returns the new questions.
func (s *Service) Generate(ctx context.Context, userID uuid.UUID, req GenerateRequest) (*GenerateResult, error) {
	if req.KBID == uuid.Nil {
		return nil, fmt.Errorf("%w: no knowledge base", ErrNoAccess)
	}
	if err := s.authz.OwnsKB(ctx, userID, req.KBID); err != nil {
		return nil, ErrNoAccess
	}

	n := req.N
	if n <= 0 {
		n = DefaultPerRequest
	}
	if n > MaxPerRequest {
		n = MaxPerRequest
	}
	types := normalizeTypes(req.Types)

	query := strings.TrimSpace(req.Topic)
	if query == "" {
		query = strings.TrimSpace(req.KPName)
	}
	if query == "" {
		// No topic and no knowledge point: ask about the knowledge base as a
		// whole. The retriever needs SOME text for its full-text arm, and the
		// honest version of "anything" is the vocabulary a study document uses
		// about its own structure.
		query = "key ideas, definitions and procedures"
	}

	chunks, err := s.retriever.Search(ctx, userID, []uuid.UUID{req.KBID}, query, RetrievalLimit)
	if err != nil {
		return nil, fmt.Errorf("quiz: retrieve: %w", err)
	}
	if len(chunks) == 0 {
		return nil, ErrNoQuestions
	}

	provider, err := s.providers.ChatFor(ctx, userID, string(functionQuiz))
	if err != nil {
		return nil, err
	}
	model := provider.DefaultModel()

	ideas, ideaNote, err := s.ideate(ctx, provider, model, chunks, n, types, query)
	if err != nil {
		return nil, err
	}
	if len(ideas) == 0 {
		return nil, ErrNoQuestions
	}

	drafted, genNote, dropped, err := s.generate(ctx, provider, model, chunks, ideas, types)
	if err != nil {
		return nil, err
	}
	if len(drafted) == 0 {
		return nil, ErrNoQuestions
	}

	rows := make([]Question, 0, len(drafted))
	for _, d := range drafted {
		d.UserID = userID
		d.KBID = req.KBID
		d.SessionID = req.SessionID
		d.KnowledgePointID = req.KnowledgePointID
		d.ModuleID = req.ModuleID
		rows = append(rows, d)
	}

	stored, err := s.store.InsertQuestions(ctx, rows)
	if err != nil {
		return nil, fmt.Errorf("quiz: store questions: %w", err)
	}

	return &GenerateResult{
		Questions:        stored,
		Requested:        n,
		DroppedCitations: dropped,
		Model:            model,
		Provider:         provider.Name(),
		Note:             joinNotes(ideaNote, genNote),
	}, nil
}

// Bank lists the user's questions.
func (s *Service) Bank(ctx context.Context, userID uuid.UUID, f Filter) ([]BankEntry, error) {
	if f.KBID != nil {
		if err := s.authz.OwnsKB(ctx, userID, *f.KBID); err != nil {
			return nil, ErrNoAccess
		}
	}
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 50
	}
	return s.store.ListQuestions(ctx, userID, f)
}

// Get returns one question and its attempts. The answer is revealed only once
// the learner has attempted it at least once.
func (s *Service) Get(ctx context.Context, userID, questionID uuid.UUID) (*Question, []Attempt, error) {
	q, err := s.store.GetQuestion(ctx, userID, questionID)
	if err != nil {
		return nil, nil, err
	}
	attempts, err := s.store.ListAttempts(ctx, userID, questionID, 20)
	if err != nil {
		return nil, nil, err
	}
	return q, attempts, nil
}

// functionQuiz is the byok route function this capability resolves through.
// Typed as a local constant rather than imported from internal/byok so that
// this package does not depend on the BYOK subsystem to be compiled or tested;
// byok.FunctionQuiz is the same string and the wiring passes the resolver.
const functionQuiz = "quiz"

// normalizeTypes keeps the types a plain quiz may ask for. `written` is not
// one of them: its rubric is generated and validated by the mock exam
// (internal/capabilities/exam), and a written question without one could
// not be marked.
func normalizeTypes(in []string) []string {
	allowed := map[string]bool{TypeMCQ: true, TypeShort: true, TypeTF: true, TypeCloze: true}
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if allowed[t] && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		return []string{TypeMCQ, TypeShort, TypeTF, TypeCloze}
	}
	return out
}

func joinNotes(parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, " ")
}

// validAttribution and validErrorType are re-exported from internal/learning so
// handlers in this package's API have one import for request validation.
func validAttribution(s string) bool { return learning.ValidAttribution(s) }
func validErrorType(s string) bool   { return learning.ValidErrorType(s) }

// IsMath reports a short or cloze question whose recorded answer is an
// expression or an equation, marked by value (mathcheck).
func (q Question) IsMath() bool {
	return (q.Type == TypeShort || q.Type == TypeCloze) && mathcheck.KindOf(q.Answer) == mathcheck.Expression
}
