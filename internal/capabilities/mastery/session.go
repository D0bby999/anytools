package mastery

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
)

// session.go serves the next question, and is where "due reviews first, then
// weakest module" becomes a concrete row.
//
// The three-step shape — pick a knowledge point, reuse a banked question, only
// then generate — matters for cost. Generation is two model calls on the
// learner's own key. A session that generated on every question would charge
// someone twice for re-asking the thing they got wrong ten minutes ago, which
// is exactly what spaced repetition asks them to do.

// NextQuestion is what the session screen renders.
//
// Kind says which card: `question` (the shape this always had), `learn` (an
// explanation before any question, phase 2) or `explain_back` (write the idea
// in your own words). Only the matching field is set.
type NextQuestion struct {
	Kind     string         `json:"kind"`
	Question map[string]any `json:"question,omitempty"`
	// Explanation is set for `learn`.
	Explanation *Explanation `json:"explanation,omitempty"`
	// Prompt is set for `explain_back`, with the point's last judged attempt
	// when there is one, so its gaps are in front of the learner again.
	Prompt          string              `json:"prompt,omitempty"`
	LastExplainBack *ExplainBackAttempt `json:"last_explain_back,omitempty"`
	// Point and Module say WHY this question: a session that just shows
	// questions is a quiz, and the thing that makes it a path is the learner
	// being able to see what it is working on.
	Point      KnowledgePoint `json:"knowledge_point"`
	ModuleName string         `json:"module_name"`
	// PathID and PathGoal name the point's path: the cross-path review
	// shows them so the switch between subjects is visible.
	PathID   uuid.UUID `json:"path_id"`
	PathGoal string    `json:"path_goal"`
	// ExplainBackWaiting is set by the cross-path review when the point's
	// path has an explain-back waiting, which only that path's own session
	// asks for.
	ExplainBackWaiting bool `json:"explain_back_waiting,omitempty"`
	Due                bool `json:"due"`
	// Generated is true when this question was written just now rather than
	// taken from the bank.
	Generated bool `json:"generated"`
	// Remaining is how many knowledge points are due after this one.
	Remaining int `json:"remaining_due"`
}

// Next returns the question the session should ask.
func (s *Service) Next(ctx context.Context, userID, pathID uuid.UUID) (*NextQuestion, error) {
	path, err := s.store.GetPath(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}

	now := s.now().UTC()
	candidates, err := s.store.Candidates(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}
	if len(candidates) == 0 {
		// No ACTIVE knowledge points: either nothing was approved, or every
		// module graduated. Those are different sentences to a learner, so
		// they are different errors.
		detail, derr := s.store.Detail(ctx, userID, pathID, now)
		if derr == nil && len(detail.Modules) == 0 {
			return nil, ErrNotApproved
		}
		return nil, ErrNothingDue
	}

	ranked := learning.Rank(candidates, now)
	chosen := ranked[0]

	// Nothing due: a point waiting for its explain-back goes first. It costs
	// no model call to ask, and the Feynman check belongs right after the
	// correct answer that made it possible, not days later when the card
	// happens to come round.
	if !chosen.IsDue(now) {
		waiting, err := s.store.AwaitingExplainBack(ctx, userID, pathID)
		if err != nil {
			return nil, err
		}
		if len(waiting) > 0 {
			for _, c := range ranked {
				if c.KPID == waiting[0] {
					chosen = c
					break
				}
			}
		}
	}

	remaining := 0
	for _, c := range ranked[1:] {
		if c.IsDue(now) {
			remaining++
		}
	}

	return s.serve(ctx, userID, path, chosen, now, remaining, true)
}

// serve turns the chosen point into the card the session shows: an
// explain-back, a first explanation, a banked question, or a generated one.
// Both sessions call it — the per-path Next and the cross-path ReviewNext —
// so what a point is asked as never depends on which screen asked.
//
// explainBack says whether this session may ask for an explain-back. The
// cross-path review may not: explain-backs stay on their own path's session
// (up-methods phase 12), and a point waiting for one is asked as a question.
func (s *Service) serve(ctx context.Context, userID uuid.UUID, path *Path, chosen learning.Candidate,
	now time.Time, remaining int, explainBack bool,
) (*NextQuestion, error) {
	point, module, err := s.store.KnowledgePoint(ctx, userID, chosen.KPID)
	if err != nil {
		return nil, err
	}

	progress, err := s.store.PointProgress(ctx, userID, chosen.KPID)
	if err != nil {
		return nil, err
	}
	base := NextQuestion{Point: *point, ModuleName: module.Name, PathID: path.ID, PathGoal: path.Goal,
		Due: chosen.IsDue(now), Remaining: remaining}
	switch {
	case explainBack && progress.AwaitingExplain:
		base.Kind, base.Prompt = NextExplainKind, explainPrompt(point)
		if last, err := s.store.LatestExplainBack(ctx, userID, point.ID); err == nil {
			if base.LastExplainBack, err = s.shownAttempt(ctx, userID, last); err != nil {
				return nil, err
			}
		} else if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		return &base, nil
	case !progress.HasCorrect && !progress.Taught:
		// Teach before testing, once: a point never answered correctly and
		// never taught. A point already answered right is never taught
		// unasked, so paths from before this shipped do not each start with a
		// paid call (red team AS-10). When the material cannot support an
		// explanation, the session falls through to a question rather than
		// stopping.
		explanation, err := s.Learn(ctx, userID, point.ID, LearnRequest{})
		if err == nil {
			base.Kind, base.Explanation = NextLearnKind, explanation
			return &base, nil
		}
		if !errors.Is(err, ErrNoMaterial) && !errors.Is(err, ErrBadExplanation) {
			return nil, err
		}
		if _, err := s.store.AppendEvent(ctx, userID, path.ID, EventTeachFailed, map[string]any{
			"knowledge_point_id": point.ID, "reason": err.Error(),
		}); err != nil {
			return nil, err
		}
	}

	// A question the learner has never attempted is preferred over generating a
	// new one — but a question they HAVE attempted is not reused, because the
	// second showing would test whether they remember the answer rather than
	// whether they know the thing.
	base.Kind = NextQuestionKind
	if banked, err := s.store.UnansweredQuestion(ctx, userID, chosen.KPID); err == nil && banked != nil {
		base.Question = banked.View(false)
		return &base, nil
	} else if err != nil && !errors.Is(err, quiz.ErrNotFound) {
		return nil, err
	}

	result, err := s.quiz.Generate(ctx, userID, quiz.GenerateRequest{
		KBID:             path.KBID,
		N:                1,
		KnowledgePointID: &chosen.KPID,
		ModuleID:         &module.ID,
		KPName:           point.Name,
	})
	if err != nil {
		return nil, err
	}
	if len(result.Questions) == 0 {
		return nil, quiz.ErrNoQuestions
	}
	base.Question, base.Generated = result.Questions[0].View(false), true
	return &base, nil
}

// Diagnostic generates the opening quiz: one question per knowledge point,
// working down the path from the first module, capped at DiagnosticQuestions.
//
// It exists to SEED the schedule with evidence rather than assumptions. Without
// it every card starts at the same estimate and the first session's ordering is
// arbitrary — the learner is asked about things they already know while the
// gaps sit at the same priority.
func (s *Service) Diagnostic(ctx context.Context, userID, pathID uuid.UUID) ([]map[string]any, error) {
	path, err := s.store.GetPath(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}
	detail, err := s.store.Detail(ctx, userID, pathID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	if len(detail.Modules) == 0 {
		return nil, ErrNotApproved
	}

	// One per module first, then a second pass, so an eight-question diagnostic
	// over three modules covers all three rather than exhausting module one.
	picks := spread(detail.Modules, DiagnosticQuestions)
	if len(picks) == 0 {
		return nil, ErrNotApproved
	}

	out := make([]map[string]any, 0, len(picks))
	var firstErr error
	for _, p := range picks {
		result, err := s.quiz.Generate(ctx, userID, quiz.GenerateRequest{
			KBID:             path.KBID,
			N:                1,
			KnowledgePointID: &p.kpID,
			ModuleID:         &p.moduleID,
			KPName:           p.kpName,
		})
		if err != nil {
			// One knowledge point the material cannot support must not sink the
			// whole diagnostic; a seven-question diagnostic is still a
			// diagnostic. The first failure is kept so that a diagnostic which
			// produced NOTHING can say why.
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, q := range result.Questions {
			out = append(out, q.View(false))
		}
	}
	if len(out) == 0 {
		if firstErr != nil {
			return nil, firstErr
		}
		return nil, quiz.ErrNoQuestions
	}

	if _, err := s.store.AppendEvent(ctx, userID, pathID, "diagnostic_generated",
		map[string]any{"questions": len(out)}); err != nil {
		return nil, err
	}
	return out, nil
}

type pick struct {
	kpID     uuid.UUID
	kpName   string
	moduleID uuid.UUID
}

// spread takes up to n knowledge points, round-robin across modules.
func spread(modules []ModuleView, n int) []pick {
	out := make([]pick, 0, n)
	for round := 0; len(out) < n; round++ {
		progressed := false
		for _, m := range modules {
			if round >= len(m.KnowledgePoints) {
				continue
			}
			progressed = true
			kp := m.KnowledgePoints[round].KnowledgePoint
			out = append(out, pick{kpID: kp.ID, kpName: kp.Name, moduleID: m.Module.ID})
			if len(out) >= n {
				return out
			}
		}
		if !progressed {
			break
		}
	}
	return out
}

// Graduate checks the path for modules that have crossed their bar and records
// each one as an event.
//
// It is called after every attempt rather than on a schedule, and it is
// idempotent: a module already marked graduated returns nothing, so calling it
// twice does not write two events. Both properties are what let the caller
// treat it as "check whether anything just changed" without tracking state.
func (s *Service) Graduate(ctx context.Context, userID, pathID uuid.UUID) ([]GraduatedModule, error) {
	graduated, err := s.store.Graduate(ctx, userID, pathID, s.now().UTC())
	if err != nil {
		return nil, err
	}
	for _, m := range graduated {
		if _, err := s.store.AppendEvent(ctx, userID, pathID, "module_graduated", map[string]any{
			"module_id": m.ModuleID,
			"name":      m.Name,
			"mastery":   m.Mastery,
		}); err != nil {
			return graduated, fmt.Errorf("mastery: record graduation: %w", err)
		}
	}
	return graduated, nil
}

// GraduateForKnowledgePoint runs the graduation check for whichever path a
// knowledge point belongs to.
//
// It exists so the quiz API can call it after an attempt without knowing what a
// path is: the attempt carries a knowledge point, and the module the point
// belongs to knows its path. The alternative — asking the client to call a
// "check graduation" endpoint — makes the learner's browser responsible for
// whether a module they finished is recorded as finished.
func (s *Service) GraduateForKnowledgePoint(ctx context.Context, userID, kpID uuid.UUID) ([]GraduatedModule, error) {
	_, module, err := s.store.KnowledgePoint(ctx, userID, kpID)
	if err != nil {
		return nil, err
	}
	return s.Graduate(ctx, userID, module.PathID)
}

// explainPrompt is the explain-back card's instruction.
func explainPrompt(point *KnowledgePoint) string {
	return fmt.Sprintf("Explain “%s” in your own words, as you would to a friend who has not studied it. "+
		"Say what it is, why it matters, and the part people most often get wrong.", point.Name)
}
