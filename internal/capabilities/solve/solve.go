// Package solve is the worked-solution capability: plan → reason → write, for
// a problem the learner typed, photographed, or both.
//
// It is a runtime.Capability — a streaming TURN — unlike quiz, which is a
// synchronous service. The difference is the reader: a person is watching this
// one, a solution takes three model calls, and a photographed problem is the
// case where "the model is reading your photo" is worth showing rather than a
// spinner. It also inherits the turn's lease, cancel and recovery for free.
//
// Grounding is optional. When the session has knowledge bases and the plan
// names something worth looking up, the plan stage runs rag_search through
// runtime.TurnContext.CallTool — the same tool, authz gate and envelope chat
// uses — and the write-up may cite what it found. A problem with no material
// behind it is still solved; it simply cites nothing.
package solve

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/D0bby999/anytools/internal/capabilities/staged"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning/ownversion"
	solveprompts "github.com/D0bby999/anytools/internal/prompts/solve"
	"github.com/D0bby999/anytools/internal/runtime"
)

// Stages, in order. The UI renders exactly these three.
const (
	StagePlan   = "plan"
	StageReason = "reason"
	StageWrite  = "write"
)

// Variants a turn may ask for, through StartTurn.Params["variant"].
const (
	VariantSolve = "solve"
	// VariantCheck is "check my answer": the learner supplies their own answer
	// (Params["user_answer"]) and gets a verdict plus the correct working.
	VariantCheck = "check"
)

// ParamOwnVersion carries the learner's three lines, as JSON, when they wrote
// them before asking (internal/learning/ownversion).
const ParamOwnVersion = "own_version"

// Function is the byok route function solve resolves its model through. Same
// string as byok.FunctionSolve; a local constant so this package does not
// import the BYOK subsystem (see internal/capabilities/quiz).
const Function = "solve"

// kbPassages is how many passages the plan stage may pull in. A worked
// solution leans on a definition or a method, not a chapter.
const kbPassages = 6

// MessageStore is the transcript write this capability needs.
type MessageStore interface {
	AppendMessage(ctx context.Context, m runtime.ChatMessage) (*runtime.ChatMessage, error)
}

// Capability is the solve turn.
type Capability struct {
	messages MessageStore
}

// New builds the capability.
func New(messages MessageStore) *Capability { return &Capability{messages: messages} }

// Name implements runtime.Capability.
func (c *Capability) Name() string { return "solve" }

// Plan is the plan stage's reply.
type Plan struct {
	Problem    string   `json:"problem"`
	Topic      string   `json:"topic"`
	Approach   []string `json:"approach"`
	Search     string   `json:"search"`
	Unreadable string   `json:"unreadable"`
}

// Step is one step of the worked reasoning.
type Step struct {
	Title string   `json:"title"`
	Work  string   `json:"work"`
	Cites []string `json:"cites"`
}

// Reasoning is the reason stage's reply.
type Reasoning struct {
	Steps       []Step `json:"steps"`
	FinalAnswer string `json:"final_answer"`
	Check       struct {
		Verdict     string `json:"verdict"`
		Explanation string `json:"explanation"`
	} `json:"check"`
}

// Result is what the stored assistant message carries beside its sources, so
// "turn this into a question" and "save to notebook" work from the transcript
// row rather than from anything the browser sends back.
type Result struct {
	Problem     string `json:"problem"`
	Topic       string `json:"topic,omitempty"`
	FinalAnswer string `json:"final_answer"`
	Variant     string `json:"variant"`
	UserAnswer  string `json:"user_answer,omitempty"`
	Verdict     string `json:"verdict,omitempty"`
}

// Run implements runtime.Capability.
func (c *Capability) Run(ctx context.Context, tc *runtime.TurnContext) error {
	model, err := staged.Resolve(ctx, tc, Function)
	if err != nil {
		return err
	}

	variant := tc.Param("variant")
	if variant != VariantCheck {
		variant = VariantSolve
	}
	userAnswer := strings.TrimSpace(tc.Param("user_answer"))
	own := ownVersion(tc.Param(ParamOwnVersion))

	// ── plan ────────────────────────────────────────────────────────────
	end := staged.Stage(tc, StagePlan)
	var plan Plan
	if err := model.JSON(ctx, StagePlan, solveprompts.Plan,
		planInput(tc.Input, len(tc.Images), variant, userAnswer), tc.Images, &plan); err != nil {
		return err
	}
	plan.Problem = strings.TrimSpace(plan.Problem)
	if plan.Problem == "" {
		plan.Problem = tc.Input
	}
	tc.Emit(runtime.Event{
		Type: runtime.EvProgress, Stage: StagePlan, Source: c.Name(), Content: plan.Problem,
		Metadata: map[string]any{"topic": plan.Topic, "approach": plan.Approach, "unreadable": plan.Unreadable},
	})

	passages, err := c.ground(ctx, tc, plan)
	if err != nil {
		return err
	}
	end()

	// ── reason ──────────────────────────────────────────────────────────
	end = staged.Stage(tc, StageReason)
	var reasoning Reasoning
	if err := model.JSON(ctx, StageReason, solveprompts.Reason,
		ownversion.WithQuestion(reasonInput(plan, passages, variant, userAnswer), own), tc.Images, &reasoning); err != nil {
		return err
	}
	if len(reasoning.Steps) == 0 {
		return fmt.Errorf("%w: the reasoning had no steps", staged.ErrBadOutput)
	}
	for i, s := range reasoning.Steps {
		tc.Emit(runtime.Event{
			Type: runtime.EvProgress, Stage: StageReason, Source: c.Name(), Content: s.Title,
			Metadata: map[string]any{"step": i + 1, "of": len(reasoning.Steps)},
		})
	}
	end()

	// ── write ───────────────────────────────────────────────────────────
	end = staged.Stage(tc, StageWrite)
	text, err := model.Stream(ctx, StageWrite, solveprompts.Write,
		ownversion.WithQuestion(writeInput(plan, reasoning, passages, variant, userAnswer), own))
	if err != nil {
		return err
	}

	result := Result{
		Problem: plan.Problem, Topic: plan.Topic, FinalAnswer: strings.TrimSpace(reasoning.FinalAnswer),
		Variant: variant, UserAnswer: userAnswer,
	}
	if variant == VariantCheck {
		result.Verdict = normalizeVerdict(reasoning.Check.Verdict)
	}
	err = c.deliver(ctx, tc, text, result)
	end()
	return err
}

// ground runs rag_search when the plan asked for it and the session has
// somewhere to look. A tool ERROR is not a failure of the solve — the problem
// can still be worked — so it is reported on the stream and dropped.
func (c *Capability) ground(ctx context.Context, tc *runtime.TurnContext, plan Plan) (string, error) {
	query := strings.TrimSpace(plan.Search)
	if query == "" || len(tc.Session.KBIDs) == 0 || !tc.ToolAvailable("rag_search") {
		return "", nil
	}
	res, err := tc.CallTool(ctx, StagePlan, "rag_search",
		map[string]any{"query": query, "limit": kbPassages}, nil)
	if err != nil {
		return "", err
	}
	if res.IsError || len(res.Sources) == 0 {
		return "", nil
	}
	return res.Content, nil
}

// deliver validates citations, emits sources and result, and stores the
// assistant message — in that order, for chat's reason: a citation dropped
// here is gone from the transcript as well as the screen.
func (c *Capability) deliver(ctx context.Context, tc *runtime.TurnContext, text string, result Result) error {
	res := citations.Validate(text, citations.Index(tc.Sources()))

	if len(res.Sources) > 0 {
		tc.Emit(runtime.Event{
			Type: runtime.EvSources, Stage: StageWrite, Source: c.Name(),
			Metadata: map[string]any{"sources": res.Sources},
		})
	}

	attachments, _ := json.Marshal(map[string]any{"sources": res.Sources, "solve": result})
	stored, err := c.messages.AppendMessage(ctx, runtime.ChatMessage{
		UserID:      tc.Turn.UserID,
		SessionID:   tc.Session.ID,
		Role:        runtime.RoleAssistant,
		Content:     res.Text,
		Capability:  c.Name(),
		Attachments: attachments,
	})
	if err != nil {
		return fmt.Errorf("store solution: %w", err)
	}

	tc.Emit(runtime.Event{
		Type: runtime.EvResult, Stage: StageWrite, Source: c.Name(), Content: res.Text,
		Metadata: map[string]any{
			"message_id":        stored.ID.String(),
			"final_answer":      result.FinalAnswer,
			"variant":           result.Variant,
			"verdict":           result.Verdict,
			"problem":           result.Problem,
			"dropped_citations": len(res.Dropped),
		},
	})
	return nil
}

// ownVersion reads the lines the API put in the turn's params, or nil.
func ownVersion(param string) *ownversion.Lines {
	if param == "" {
		return nil
	}
	var l ownversion.Lines
	if json.Unmarshal([]byte(param), &l) != nil {
		return nil
	}
	if l, err := l.Normalize(); err == nil {
		return &l
	}
	return nil
}

func normalizeVerdict(v string) string {
	switch v = strings.ToLower(strings.TrimSpace(v)); v {
	case "correct", "incorrect", "partly":
		return v
	case "partially", "partially correct", "partly correct":
		return "partly"
	default:
		return "unclear"
	}
}

func planInput(problem string, images int, variant, userAnswer string) string {
	var b strings.Builder
	if images > 0 {
		b.WriteString(fmt.Sprintf("A photo of the problem is attached (%d image).\n\n", images))
	}
	if strings.TrimSpace(problem) != "" {
		b.WriteString("The learner wrote:\n")
		b.WriteString(problem)
		b.WriteString("\n\n")
	}
	if variant == VariantCheck {
		b.WriteString("The learner wants their answer checked. Their answer:\n")
		b.WriteString(userAnswer)
		b.WriteString("\n")
	}
	return b.String()
}

func reasonInput(plan Plan, passages, variant, userAnswer string) string {
	var b strings.Builder
	b.WriteString("Problem:\n" + plan.Problem + "\n\n")
	if plan.Topic != "" {
		b.WriteString("Topic: " + plan.Topic + "\n\n")
	}
	if len(plan.Approach) > 0 {
		b.WriteString("Planned approach:\n")
		for i, a := range plan.Approach {
			b.WriteString(fmt.Sprintf("%d. %s\n", i+1, a))
		}
		b.WriteString("\n")
	}
	if passages != "" {
		b.WriteString("Passages from the learner's own study material:\n\n" + passages + "\n\n")
	}
	if variant == VariantCheck {
		b.WriteString("CHECK the learner's answer. Their answer:\n" + userAnswer + "\n")
	}
	return b.String()
}

func writeInput(plan Plan, r Reasoning, passages, variant, userAnswer string) string {
	var b strings.Builder
	b.WriteString("Problem:\n" + plan.Problem + "\n\nWorked steps:\n")
	for i, s := range r.Steps {
		b.WriteString(fmt.Sprintf("%d. %s\n%s\n", i+1, s.Title, s.Work))
		if len(s.Cites) > 0 {
			b.WriteString("   relies on: " + strings.Join(s.Cites, " ") + "\n")
		}
	}
	b.WriteString("\nFinal answer: " + r.FinalAnswer + "\n")
	if variant == VariantCheck {
		b.WriteString(fmt.Sprintf("\nThis is a CHECK of the learner's answer (%q). Verdict: %s. %s\n",
			userAnswer, r.Check.Verdict, r.Check.Explanation))
	}
	if passages != "" {
		b.WriteString("\nPassages you may cite:\n\n" + passages + "\n")
	}
	return b.String()
}

// SessionTitle is what a new solve session is called: the first line of the
// problem, or a placeholder for a photo with no text.
func SessionTitle(problem string, hasImage bool) string {
	line, _, _ := strings.Cut(strings.TrimSpace(problem), "\n")
	if line = strings.TrimSpace(line); line != "" {
		return "Solve: " + line
	}
	if hasImage {
		return "Solve: photographed problem"
	}
	return "Solve"
}

var _ runtime.Capability = (*Capability)(nil)
