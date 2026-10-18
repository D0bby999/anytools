// Package writingdiag diagnoses one revision pass of a writing evidence card
// (plans/260930-0915-up-methods, phase 4): at most three issues in the
// learner's unaided draft, each quoting it, with a basis, a confidence and how
// the diagnosis might be wrong.
//
// It follows up's auditable process for AI in writing
// (docs/en/threads/part-1/6-writing.md §8): the learner's own draft exists
// first, the model diagnoses before anything is rewritten, and the learner
// rewrites. So the model proposes and the engine decides (Validate): an issue
// whose quote is not literally in the draft is dropped, an issue that quotes
// more than 40% of it is dropped as a rewrite in disguise, there are never
// more than three, and there is no field a rewritten draft could arrive in.
//
// One call on the learner's chat route. Diagnoses are stored in their own
// table, never in the worksheet's answers, so the server never writes into a
// field the learner owns. A private worksheet is never read.
package writingdiag

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	writingprompts "github.com/D0bby999/anytools/internal/prompts/writing"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// Function is the BYOK route a diagnosis runs on: the learner's chat model.
const Function = "chat"

// Bounds on what is kept.
const (
	MaxIssues = 3
	// MaxQuote is the longest quote kept, in characters.
	MaxQuote = 300
	// MaxText bounds problem, basis and might_be_wrong; longer text is cut.
	MaxText = 600
	// MaxShare is the largest part of the draft one quote may be: more is a
	// rewrite of the draft in disguise.
	MaxShare = 0.4
)

var (
	// ErrNotFound covers "not yours" and "does not exist".
	ErrNotFound = errors.New("writingdiag: not found")
	// ErrNotDiagnosable is a worksheet that is not a writing evidence card,
	// or a private one.
	ErrNotDiagnosable = errors.New("writingdiag: only a writing evidence card is diagnosed")
	// ErrNoDraft is a card whose §2 has no draft yet: up's step one is the
	// learner's own draft.
	ErrNoDraft = errors.New("writingdiag: save your own draft first")
	// ErrBadPass is a pass outside 1–5.
	ErrBadPass = errors.New("writingdiag: a pass is 1 to 5")
	// ErrInvalid is model output with nothing usable in it.
	ErrInvalid = errors.New("writingdiag: your model's diagnosis could not be read")
)

// Confidence levels a diagnosis states.
var confidences = []string{"low", "medium", "high"}

// Issue is one diagnosed problem.
type Issue struct {
	// Quote is an exact span of the draft.
	Quote        string `json:"quote"`
	Problem      string `json:"problem"`
	Basis        string `json:"basis"`
	Confidence   string `json:"confidence"`
	MightBeWrong string `json:"might_be_wrong"`
}

// Diagnosis is one pass's diagnosis of one draft.
type Diagnosis struct {
	ID          uuid.UUID `json:"id"`
	WorksheetID uuid.UUID `json:"worksheet_id"`
	Pass        int       `json:"pass"`
	Issues      []Issue   `json:"issues"`
	Model       string    `json:"model"`
	CreatedAt   time.Time `json:"created_at"`
	// DraftSHA256 is the draft it diagnosed.
	DraftSHA256 string `json:"-"`
}

// Store keeps diagnoses (pg.WorksheetDiagnosisStore).
type Store interface {
	// Find is the diagnosis of one pass of one draft, or nil.
	Find(ctx context.Context, userID, worksheetID uuid.UUID, pass int, draftSHA256 string) (*Diagnosis, error)
	// Save stores a diagnosis. When one for the same pass and draft is
	// already there, it returns that one instead.
	Save(ctx context.Context, userID uuid.UUID, d Diagnosis) (*Diagnosis, error)
	// List is a draft's diagnoses, by pass.
	List(ctx context.Context, userID, worksheetID uuid.UUID, draftSHA256 string) ([]Diagnosis, error)
}

// Worksheets reads the learner's worksheets (worksheet.Service).
type Worksheets interface {
	Get(ctx context.Context, userID, id uuid.UUID) (*worksheet.Worksheet, error)
}

// Service diagnoses passes and reads diagnoses.
type Service struct {
	store     Store
	sheets    Worksheets
	providers runtime.ChatProviderResolver
	now       func() time.Time
}

// NewService builds the service.
func NewService(store Store, sheets Worksheets, providers runtime.ChatProviderResolver) *Service {
	return &Service{store: store, sheets: sheets, providers: providers, now: time.Now}
}

// card reads a writing evidence card of the caller's, and its draft. Nothing
// is read from a private worksheet, whatever its kind claims.
func (s *Service) card(ctx context.Context, userID, id uuid.UUID) (*worksheet.Worksheet, string, error) {
	ws, err := s.sheets.Get(ctx, userID, id)
	if errors.Is(err, worksheet.ErrNotFound) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if ws.Private || worksheet.IsPrivate(ws.Kind) || ws.Kind != worksheet.WritingEvidenceKind {
		return nil, "", ErrNotDiagnosable
	}
	draft, _ := ws.Answers[worksheet.WritingDraftSection][worksheet.WritingDraftField].(string)
	return ws, draft, nil
}

// List is the diagnoses of the card's current draft: none once the draft
// has changed since.
func (s *Service) List(ctx context.Context, userID, id uuid.UUID) ([]Diagnosis, error) {
	_, draft, err := s.card(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(draft) == "" {
		return []Diagnosis{}, nil
	}
	return s.store.List(ctx, userID, id, hash(draft))
}

// Diagnose diagnoses one pass (1–5) of the card's current draft. A pass
// already diagnosed for this draft is returned as stored, with no model
// call.
func (s *Service) Diagnose(ctx context.Context, userID, id uuid.UUID, pass int) (*Diagnosis, error) {
	if pass < 1 || pass > len(writingprompts.Passes) {
		return nil, ErrBadPass
	}
	ws, draft, err := s.card(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(draft) == "" {
		return nil, ErrNoDraft
	}
	sum := hash(draft)
	if d, err := s.store.Find(ctx, userID, id, pass, sum); err != nil || d != nil {
		return d, err
	}

	provider, err := s.providers.ChatFor(ctx, userID, Function)
	if err != nil {
		return nil, err
	}
	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: provider.DefaultModel(),
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: writingprompts.Diagnose(pass)},
			{Role: runtime.RoleUser, Content: userPrompt(ws, draft, pass)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil {
		return nil, fmt.Errorf("%w: the model returned nothing", runtime.ErrProvider)
	}
	issues, err := Parse(resp.Content, draft)
	if err != nil {
		return nil, err
	}
	// The draft may have been edited while the model was thinking: this
	// diagnosis is of the draft it read, and is stored under that draft's
	// hash. Nothing here writes to the worksheet.
	return s.store.Save(ctx, userID, Diagnosis{
		WorksheetID: id, Pass: pass, Issues: issues, Model: provider.DefaultModel(),
		CreatedAt: s.now().UTC(), DraftSHA256: sum,
	})
}

// userPrompt envelopes everything the learner wrote — §1's task lines and
// the draft. Only the pass number is AnyTools' own.
func userPrompt(ws *worksheet.Worksheet, draft string, pass int) string {
	var task strings.Builder
	if k, ok := worksheet.Lookup(ws.Kind); ok {
		for _, sec := range k.Sections {
			if sec.Key != worksheet.WritingTaskSection {
				continue
			}
			for _, f := range sec.Fields {
				if v, ok := ws.Answers[sec.Key][f.Key].(string); ok && strings.TrimSpace(v) != "" {
					fmt.Fprintf(&task, "%s: %s\n", f.Label, v)
				}
			}
		}
	}
	parts := []string{}
	if task.Len() > 0 {
		parts = append(parts, tools.Wrap("The learner's writing task", "task", task.String()))
	}
	parts = append(parts, tools.Wrap("The learner's unaided draft", "draft", draft))
	return tools.WrapAll(parts) + fmt.Sprintf("\n\nDiagnose pass %d only. Quote the draft exactly; do not rewrite it.", pass)
}

func hash(draft string) string {
	sum := sha256.Sum256([]byte(draft))
	return hex.EncodeToString(sum[:])
}

// rawDiagnosis is the model's answer as written. It has no field for a
// rewritten draft: whatever else the model sends is never read.
type rawDiagnosis struct {
	Issues *[]rawIssue `json:"issues"`
}

type rawIssue struct {
	Quote        string `json:"quote"`
	Problem      string `json:"problem"`
	Basis        string `json:"basis"`
	Confidence   string `json:"confidence"`
	MightBeWrong string `json:"might_be_wrong"`
}

// Parse reads a model's reply and keeps what may be shown (Validate).
func Parse(content, draft string) ([]Issue, error) {
	payload, ok := modeljson.Extract(content)
	if !ok {
		return nil, ErrInvalid
	}
	var raw rawDiagnosis
	if err := json.Unmarshal([]byte(payload), &raw); err != nil || raw.Issues == nil {
		return nil, ErrInvalid
	}
	return Validate(*raw.Issues, draft)
}

// Validate keeps the issues that may be shown, in the model's order, at most
// MaxIssues of them. An issue is dropped when its quote is empty, longer than
// MaxQuote, not literally in the draft, or more than MaxShare of it; or when
// it lacks a problem, a basis, one of the three confidences, or how it might
// be wrong. Text fields over MaxText are cut. A reply whose every issue was
// dropped is ErrInvalid; an empty list is a diagnosis that found nothing.
func Validate(raw []rawIssue, draft string) ([]Issue, error) {
	out := []Issue{}
	draftLen := utf8.RuneCountInString(draft)
	for _, r := range raw {
		if len(out) == MaxIssues {
			break
		}
		quote := strings.TrimSpace(r.Quote)
		n := utf8.RuneCountInString(quote)
		if n == 0 || n > MaxQuote || !strings.Contains(draft, quote) || float64(n) > MaxShare*float64(draftLen) {
			continue
		}
		issue := Issue{
			Quote:        quote,
			Problem:      clean(r.Problem),
			Basis:        clean(r.Basis),
			Confidence:   strings.ToLower(strings.TrimSpace(r.Confidence)),
			MightBeWrong: clean(r.MightBeWrong),
		}
		if issue.Problem == "" || issue.Basis == "" || issue.MightBeWrong == "" || !isConfidence(issue.Confidence) {
			continue
		}
		out = append(out, issue)
	}
	if len(raw) > 0 && len(out) == 0 {
		return nil, ErrInvalid
	}
	return out, nil
}

func isConfidence(s string) bool {
	for _, c := range confidences {
		if s == c {
			return true
		}
	}
	return false
}

// clean strips control characters, trims, and cuts at MaxText characters.
func clean(s string) string {
	s = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			return -1
		}
		return r
	}, strings.ToValidUTF8(s, "")))
	if r := []rune(s); len(r) > MaxText {
		s = strings.TrimSpace(string(r[:MaxText-1])) + "…"
	}
	return s
}
