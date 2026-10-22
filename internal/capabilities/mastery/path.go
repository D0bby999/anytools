package mastery

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/modeljson"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/locale"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/tools"
)

// path.go creates a path and proposes its shape; approval is a separate call.

// CreateRequest is `POST /v1/mastery/paths`.
type CreateRequest struct {
	KBID uuid.UUID `json:"kb_id"`
	Goal string    `json:"goal"`
	// ExplainLang: "" the learner's language, "source", or a code.
	ExplainLang string `json:"explain_lang,omitempty"`
}

// CreateResult is the new path plus the plan the model suggests for it.
type CreateResult struct {
	Path     Path     `json:"path"`
	Proposal Proposal `json:"proposal"`
}

// Create makes the path row and asks the model for a plan.
//
// The row is created BEFORE the model call, and survives a model call that
// fails. A path with a goal and no modules is a legible state — "we have not
// planned this yet, try proposing again" — whereas losing the goal because a
// provider timed out makes the learner retype it.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, req CreateRequest) (*CreateResult, error) {
	goal := strings.TrimSpace(req.Goal)
	if goal == "" {
		return nil, fmt.Errorf("%w: a path needs a goal", ErrBadRequest)
	}
	if len(goal) > 500 {
		return nil, fmt.Errorf("%w: that goal is too long", ErrBadRequest)
	}
	if req.KBID == uuid.Nil {
		return nil, ErrNoAccess
	}
	if !ValidExplainLang(req.ExplainLang) {
		return nil, fmt.Errorf("%w: that is not a language code", ErrBadRequest)
	}
	if err := s.authz.OwnsKB(ctx, userID, req.KBID); err != nil {
		return nil, ErrNoAccess
	}

	path, err := s.store.CreatePath(ctx, Path{UserID: userID, KBID: req.KBID, Goal: goal, Status: StatusActive, ExplainLang: req.ExplainLang})
	if err != nil {
		return nil, err
	}
	if _, err := s.store.AppendEvent(ctx, userID, path.ID, "path_created",
		map[string]any{"goal": goal, "kb_id": req.KBID}); err != nil {
		return nil, err
	}

	proposal, err := s.Propose(ctx, userID, path.ID)
	if err != nil {
		// The path exists; only the plan is missing. Returning it with an empty
		// proposal lets the UI say "we could not reach your model — propose
		// again" against a path that is already there.
		return &CreateResult{Path: *path, Proposal: Proposal{Note: proposalFailureNote(err)}}, nil
	}
	return &CreateResult{Path: *path, Proposal: *proposal}, nil
}

// Propose asks the model for modules and knowledge points from the KB outline.
func (s *Service) Propose(ctx context.Context, userID, pathID uuid.UUID) (*Proposal, error) {
	path, err := s.store.GetPath(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}
	ctx = inLanguage(ctx, path.ExplainLang)

	outline, err := s.outline.Outline(ctx, userID, path.KBID, 60)
	if err != nil {
		return nil, fmt.Errorf("mastery: knowledge base outline: %w", err)
	}
	if strings.TrimSpace(outline) == "" {
		return nil, fmt.Errorf("%w: this knowledge base has no indexed documents to plan from", ErrBadRequest)
	}

	provider, err := s.providers.ChatFor(ctx, userID, functionMastery)
	if err != nil {
		return nil, err
	}
	model := provider.DefaultModel()

	var b strings.Builder
	fmt.Fprintf(&b, "Goal: %s\n\n", path.Goal)
	fmt.Fprintf(&b, "Plan at most %d modules, each with at most %d knowledge points.\n\n",
		MaxModules, MaxKnowledgePoints)
	b.WriteString("Outline of the knowledge base:\n\n")
	// The outline is document text and goes through the same provenance
	// envelope every other retrieved passage does. A file named "ignore your
	// instructions.pdf" is an injection with no body at all, which is exactly
	// why internal/tools.ToolResult.Retrieved is not keyed on citations.
	b.WriteString(tools.Wrap("knowledge base outline", "kb:"+path.KBID.String(), outline))

	resp, err := provider.Chat(ctx, runtime.ChatRequest{
		Model: model,
		Messages: []runtime.Message{
			{Role: runtime.RoleSystem, Content: PathPrompt + locale.ExplainIn(ctx)},
			{Role: runtime.RoleUser, Content: b.String()},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: %s", runtime.ErrProvider, err)
	}
	if resp == nil || strings.TrimSpace(resp.Content) == "" {
		return nil, fmt.Errorf("%w: the model returned nothing", ErrBadRequest)
	}

	var reply struct {
		Modules []ProposedModule `json:"modules"`
		Note    string           `json:"note"`
	}
	payload, ok := extractJSON(resp.Content)
	if !ok {
		return nil, fmt.Errorf("%w: the model did not return a plan", ErrBadRequest)
	}
	if err := json.Unmarshal([]byte(payload), &reply); err != nil {
		return nil, fmt.Errorf("%w: the model's plan could not be read: %s", ErrBadRequest, err)
	}

	modules := NormalizeModules(reply.Modules)
	return &Proposal{
		Modules:  modules,
		Note:     strings.TrimSpace(reply.Note),
		Model:    model,
		Coverage: s.markCoverage(ctx, userID, path.KBID, modules),
	}, nil
}

// ApproveRequest is `POST /v1/mastery/paths/{id}/approve`.
type ApproveRequest struct {
	Modules []ProposedModule `json:"modules"`
}

// Approve persists the learner's edited plan and seeds one card per knowledge
// point, then records the approval as an event.
//
// The modules come from the REQUEST, not from a stored proposal. That is the
// whole point of approval: what gets built is what the person accepted, which
// may be the model's plan with two modules deleted and one renamed. A server
// that re-read its own suggestion here would silently discard their edits.
func (s *Service) Approve(ctx context.Context, userID, pathID uuid.UUID, req ApproveRequest) (*PathDetail, error) {
	modules := NormalizeModules(req.Modules)
	if len(modules) == 0 {
		return nil, fmt.Errorf("%w: a path needs at least one module with one knowledge point", ErrBadRequest)
	}

	detail, err := s.store.ApproveModules(ctx, userID, pathID, modules, s.now().UTC())
	if err != nil {
		return nil, err
	}

	points := 0
	for _, m := range detail.Modules {
		points += len(m.KnowledgePoints)
	}
	if _, err := s.store.AppendEvent(ctx, userID, pathID, "modules_approved", map[string]any{
		"modules":          len(detail.Modules),
		"knowledge_points": points,
	}); err != nil {
		return nil, err
	}
	return detail, nil
}

// NormalizeModules validates and trims a proposed plan, whether it came from a
// model or from a learner's edits.
//
// Both go through the SAME function, which is the reason it is exported. The
// caps, the type vocabulary and the threshold range are product rules, not
// model-output hygiene; enforcing them only on the model's side would let a
// hand-edited request create a path the rest of the system cannot schedule.
func NormalizeModules(in []ProposedModule) []ProposedModule {
	out := make([]ProposedModule, 0, len(in))
	totalPoints := 0

	for _, m := range in {
		if len(out) >= MaxModules || totalPoints >= MaxKnowledgePointsAll {
			break
		}
		name := trimTo(m.Name, 200)
		if name == "" {
			continue
		}

		points := make([]ProposedKP, 0, len(m.KnowledgePoints))
		seen := map[string]bool{}
		for _, kp := range m.KnowledgePoints {
			if len(points) >= MaxKnowledgePoints || totalPoints+len(points) >= MaxKnowledgePointsAll {
				break
			}
			kpName := trimTo(kp.Name, 300)
			if kpName == "" {
				continue
			}
			key := strings.ToLower(kpName)
			if seen[key] {
				// Two cards for the same thing are two schedules for one
				// memory; the learner would be asked the same question twice
				// on different days and see two different mastery numbers.
				continue
			}
			seen[key] = true

			kpType := strings.ToLower(strings.TrimSpace(kp.Type))
			if !learning.ValidKnowledgeType(kpType) {
				kpType = learning.TypeConcept
			}
			points = append(points, ProposedKP{Name: kpName, Type: kpType, OutsideSource: kp.OutsideSource})
		}
		if len(points) == 0 {
			// A module with nothing testable in it cannot be studied or
			// graduated; it would sit at mastery 0 forever, blocking the path.
			continue
		}
		totalPoints += len(points)

		threshold := m.PassThreshold
		if threshold < 0.5 || threshold > 0.95 {
			threshold = DefaultPassThreshold
		}

		out = append(out, ProposedModule{
			Name:            name,
			Objective:       trimTo(m.Objective, 1000),
			PassThreshold:   threshold,
			KnowledgePoints: points,
		})
	}
	return out
}

func trimTo(s string, max int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > max {
		return strings.TrimSpace(string(r[:max]))
	}
	return s
}

func proposalFailureNote(err error) string {
	return "The plan could not be generated: " + err.Error()
}

// extractJSON pulls a JSON object out of a model reply. It was a copy of the
// quiz package's scanner, kept until a third caller appeared; solve and
// research did, so it is now internal/capabilities/modeljson.
func extractJSON(s string) (string, bool) { return modeljson.Extract(s) }
