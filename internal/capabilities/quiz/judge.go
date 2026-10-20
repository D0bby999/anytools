package quiz

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz/mathcheck"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning"
	quizprompts "github.com/D0bby999/anytools/internal/prompts/quiz"
)

// judge.go marks an answer.
//
// Multiple-choice and true/false are marked EXACTLY, in Go, with no model call
// at all. That is not an optimisation, it is the correct behaviour: the answer
// is a label, comparing two labels is not a task that benefits from judgement,
// and asking a model to do it introduces a way for "B" to be marked wrong on a
// bad day — on the learner's own key, at their own cost.
//
// Written answers are marked by their own rubric, criterion by criterion,
// with partial credit (mark.go).
//
// Short and cloze answers go to the model with the rubric in
// internal/prompts/quiz/judge.md. That IS judgement: "the reserve requirement"
// and "reserves you must hold" are the same answer, and no string comparison
// can say so. The rubric exists because an unrubric'd judge is inconsistent
// between two runs on the same answer, which is the risk phase-07 names.
//
// Whatever the judge says, the learner can override it (Override below). A
// grader that cannot be argued with teaches people to distrust the grade
// quietly rather than to correct it.

// JudgeModeExact marks a judgement made by string comparison.
const JudgeModeExact = "exact"

// JudgeModeLLM marks a judgement made by the model.
const JudgeModeLLM = "llm"

// JudgeModeUser marks a verdict the learner overrode.
const JudgeModeUser = "user"

// JudgeModeMath marks a maths answer compared by value, in Go, with no model
// call (mathcheck; plans/261020-1535-beyond-english-learning-areas, phase 2).
const JudgeModeMath = "math"

// ErrUnreadableMath answers a maths answer the checker could not read when
// the client asked to be told (AttemptRequest.AskIfUnreadable). Nothing is
// recorded: an answer that could not be read is not a wrong answer.
var ErrUnreadableMath = errors.New("quiz: this answer could not be read as maths")

// Judgement is the record stored in `question_attempts.judge`.
type Judgement struct {
	Correct   bool     `json:"correct"`
	Mode      string   `json:"mode"`
	Reason    string   `json:"reason,omitempty"`
	Missing   []string `json:"missing,omitempty"`
	ErrorType string   `json:"error_type,omitempty"`
	Model     string   `json:"model,omitempty"`
	Provider  string   `json:"provider,omitempty"`
	// Score and Criteria are a rubric's marking (mode "rubric"): the share of
	// the points awarded, and what each criterion earned.
	Score    *float64          `json:"score,omitempty"`
	Criteria []CriterionResult `json:"criteria,omitempty"`
	// Almost is a maths answer equal to the recorded one but not in the form
	// the question asks for: right, and scheduled as Hard.
	Almost bool `json:"almost,omitempty"`
}

// judgeReply is the model's JSON.
type judgeReply struct {
	Correct   bool     `json:"correct"`
	Reason    string   `json:"reason"`
	Missing   []string `json:"missing"`
	ErrorType string   `json:"error_type"`
}

// AttemptRequest is `POST /v1/questions/{id}/attempt`.
type AttemptRequest struct {
	UserAnswer string `json:"user_answer"`
	// SelfAttribution is the learner's own account of the attempt, and it is
	// the ONLY extra thing this product asks for after an answer. It feeds both
	// the error record and the FSRS rating (learning.RatingFor).
	SelfAttribution string `json:"self_attribution,omitempty"`
	// AskIfUnreadable: a maths answer the checker cannot read is answered
	// with ErrUnreadableMath rather than sent to the model, so the learner
	// can fix it or send it as text. The quiz card sets it; an exam's
	// marking does not, and such an answer goes to the model as before.
	AskIfUnreadable bool `json:"ask_if_unreadable,omitempty"`
}

// AttemptResult is what the learner gets back: the verdict, the answer and
// explanation now that they have earned the right to see them, and — when the
// question belonged to a mastery path — when it comes back.
type AttemptResult struct {
	Attempt     Attempt    `json:"attempt"`
	Answer      string     `json:"answer"`
	Explanation string     `json:"explanation"`
	Scheduled   *Scheduled `json:"scheduled,omitempty"`
	// Sources are the passages the explanation cites, so each marker renders
	// as a chip that opens its page — the same promise chat makes.
	Sources []citations.Source `json:"sources"`
}

// Attempt judges one answer, records it, and advances the schedule.
func (s *Service) Attempt(
	ctx context.Context, userID, questionID uuid.UUID, req AttemptRequest,
) (*AttemptResult, error) {
	attribution := strings.TrimSpace(req.SelfAttribution)
	if !validAttribution(attribution) {
		return nil, fmt.Errorf("%w: unknown self-attribution %q", ErrBadRequest, attribution)
	}
	// AttrDisputed is what an OVERRIDE records. Accepting it on a fresh attempt
	// would let a learner pre-declare a dispute with a verdict that does not
	// exist yet, and would then read back as though the judge had been
	// corrected when nothing was.
	if attribution == learning.AttrDisputed {
		return nil, fmt.Errorf("%w: a dispute is recorded by overriding an attempt, not by making one", ErrBadRequest)
	}

	q, err := s.store.GetQuestion(ctx, userID, questionID)
	if err != nil {
		return nil, err
	}

	answer := capAnswer(strings.TrimSpace(req.UserAnswer), q.Type)

	judgement, err := s.judge(ctx, userID, *q, answer, req.AskIfUnreadable)
	if err != nil {
		return nil, err
	}

	rating := learning.RatingFor(judgement.Correct, attribution)
	if judgement.Almost && rating != learning.RatingAgain {
		rating = learning.RatingHard
	}
	errorType := judgement.ErrorType
	if judgement.Correct {
		errorType = learning.ErrTypeNone
	} else if !validErrorType(errorType) || errorType == learning.ErrTypeNone {
		errorType = learning.ErrTypeUnknown
	}

	attempt, scheduled, err := s.store.RecordAttempt(ctx, AttemptWrite{
		UserID:           userID,
		QuestionID:       q.ID,
		KnowledgePointID: q.KnowledgePointID,
		ModuleID:         q.ModuleID,
		UserAnswer:       answer,
		IsCorrect:        judgement.Correct,
		Score:            judgement.Score,
		Judge:            marshalJudge(judgement),
		ErrorType:        errorType,
		SelfAttribution:  attribution,
		Rating:           rating,
		AIConfirmation:   confirmation(judgement, attribution),
		Now:              s.now().UTC(),
	})
	if err != nil {
		return nil, err
	}

	return &AttemptResult{
		Attempt:     *attempt,
		Answer:      q.Answer,
		Explanation: q.Explanation,
		Scheduled:   scheduled,
		Sources:     s.Sources(ctx, userID, *q),
	}, nil
}

// MaxAnswer and MaxWrittenAnswer cap what is marked and stored: an essay is
// longer than a short answer, and cutting it would mark half of it.
const (
	MaxAnswer        = 4000
	MaxWrittenAnswer = 20000
)

// capAnswer cuts an answer to its type's cap, on a character boundary.
func capAnswer(answer, qType string) string {
	limit := MaxAnswer
	if qType == TypeWritten {
		limit = MaxWrittenAnswer
	}
	if len(answer) <= limit {
		return answer
	}
	runes := []rune(answer)
	if len(runes) > limit {
		runes = runes[:limit]
	}
	return string(runes)
}

// ErrBadRequest is a caller mistake a handler should turn into a 400 with a
// sentence, rather than letting a CHECK constraint surface as a 500.
var ErrBadRequest = fmt.Errorf("quiz: bad request")

// Override records the learner's own verdict over the judge's.
//
// It rewrites the attempt's outcome, marks it overridden, and RESCHEDULES from
// the corrected result — which is the part that would be easy to leave out and
// would make the override cosmetic. A person who proves their short answer was
// right, and then watches the knowledge point come back in ten minutes anyway,
// has been told their correction did not count.
func (s *Service) Override(
	ctx context.Context, userID, attemptID uuid.UUID, correct bool,
) (*AttemptResult, error) {
	attempt, scheduled, err := s.store.OverrideAttempt(ctx, userID, attemptID, correct, learning.AttrDisputed, s.now().UTC())
	if err != nil {
		return nil, err
	}
	q, err := s.store.GetQuestion(ctx, userID, attempt.QuestionID)
	if err != nil {
		return nil, err
	}
	return &AttemptResult{
		Attempt:     *attempt,
		Answer:      q.Answer,
		Explanation: q.Explanation,
		Scheduled:   scheduled,
		Sources:     s.Sources(ctx, userID, *q),
	}, nil
}

// Sources resolves what the given questions' explanations cite, in one query.
//
// A failure returns no sources rather than failing the call: the verdict and
// the explanation are the answer, and the chips are how to check it. Markers
// without a source render as plain text, which is visibly less, not wrong.
func (s *Service) Sources(ctx context.Context, userID uuid.UUID, qs ...Question) []citations.Source {
	seen := map[uuid.UUID]bool{}
	var ids []uuid.UUID
	add := func(id uuid.UUID) {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, q := range qs {
		for _, ref := range citations.Parse(q.Explanation) {
			if id, err := uuid.Parse(ref.ID); err == nil && ref.Kind == "chunk" {
				add(id)
			}
		}
	}
	if len(ids) == 0 {
		return []citations.Source{}
	}
	sources, err := s.store.Sources(ctx, userID, ids)
	if err != nil {
		slog.Warn("quiz: resolving cited sources failed", "user", userID, "error", err)
		return []citations.Source{}
	}
	return sources
}

// judge routes to the exact, the maths or the model path.
func (s *Service) judge(ctx context.Context, userID uuid.UUID, q Question, answer string, askIfUnreadable bool) (Judgement, error) {
	switch q.Type {
	case TypeMCQ:
		return exactJudge(matchesLabel(q.Options, q.Answer, answer)), nil
	case TypeTF:
		got, ok := normalizeBoolean(answer)
		return exactJudge(ok && got == q.Answer), nil
	case TypeWritten:
		return s.rubricJudge(ctx, userID, q, answer)
	}
	if strings.TrimSpace(answer) != "" {
		switch mathcheck.Judge(q.Prompt, q.Answer, answer) {
		case mathcheck.Right:
			return Judgement{Correct: true, Mode: JudgeModeMath}, nil
		case mathcheck.Almost:
			return Judgement{
				Correct: true, Mode: JudgeModeMath, Almost: true,
				Reason: "Equal to the answer, but not in the form the question asks for.",
			}, nil
		case mathcheck.Wrong:
			return Judgement{
				Correct: false, Mode: JudgeModeMath, ErrorType: learning.ErrTypeUnknown,
				Reason: "The value differs from the recorded answer.",
			}, nil
		case mathcheck.Unreadable:
			if askIfUnreadable {
				return Judgement{}, ErrUnreadableMath
			}
		}
	}
	return s.llmJudge(ctx, userID, q, answer)
}

func exactJudge(correct bool) Judgement {
	j := Judgement{Correct: correct, Mode: JudgeModeExact}
	if !correct {
		// An exact-marked answer cannot say WHY it was wrong beyond "that is
		// not the one", so the error type stays unknown rather than guessing.
		// The learner's self-attribution is what fills it in.
		j.ErrorType = learning.ErrTypeUnknown
		j.Reason = "That is not the answer recorded for this question."
	}
	return j
}

// matchesLabel compares a learner's multiple-choice answer to the correct
// label, accepting the option text as well as the label itself.
func matchesLabel(options []Option, want, got string) bool {
	label, ok := matchOptionLabel(options, got)
	return ok && label == want
}

// llmJudge marks a short or cloze answer with the rubric.
func (s *Service) llmJudge(ctx context.Context, userID uuid.UUID, q Question, answer string) (Judgement, error) {
	// An empty answer is not sent to a model. It is unambiguously incorrect,
	// and paying for a model call to be told so is spending a learner's key on
	// a foregone conclusion.
	if strings.TrimSpace(answer) == "" {
		return Judgement{
			Correct: false, Mode: JudgeModeExact, ErrorType: learning.ErrTypeUnknown,
			Reason: "No answer was given.",
		}, nil
	}

	provider, err := s.providers.ChatFor(ctx, userID, string(functionQuiz))
	if err != nil {
		return Judgement{}, err
	}
	model := provider.DefaultModel()

	var b strings.Builder
	fmt.Fprintf(&b, "Question (%s): %s\n\n", q.Type, q.Prompt)
	fmt.Fprintf(&b, "Model answer: %s\n\n", q.Answer)
	fmt.Fprintf(&b, "The learner answered: %s\n", answer)

	var reply judgeReply
	if err := askJSON(ctx, provider, model, quizprompts.Judge, b.String(), &reply); err != nil {
		return Judgement{}, err
	}

	errorType := strings.ToLower(strings.TrimSpace(reply.ErrorType))
	if reply.Correct {
		errorType = learning.ErrTypeNone
	} else if !validErrorType(errorType) || errorType == learning.ErrTypeNone {
		errorType = learning.ErrTypeUnknown
	}

	return Judgement{
		Correct:   reply.Correct,
		Mode:      JudgeModeLLM,
		Reason:    strings.TrimSpace(reply.Reason),
		Missing:   reply.Missing,
		ErrorType: errorType,
		Model:     model,
		Provider:  provider.Name(),
	}, nil
}

// confirmation is what lands in `error_records.ai_confirmation`: whether the
// judge's read of the mistake agreed with the learner's own.
//
// It is computed rather than asked for, because asking the model a second
// question ("do you agree with their self-diagnosis?") is a second call on the
// learner's key to produce a comparison Go can make.
func confirmation(j Judgement, attribution string) string {
	if j.Correct || attribution == learning.AttrNone {
		return ""
	}
	switch {
	case attribution == learning.AttrCareless && j.ErrorType == learning.ErrTypeCareless,
		attribution == learning.AttrMisread && j.ErrorType == learning.ErrTypeMisread,
		attribution == learning.AttrKnowledgeGap && j.ErrorType == learning.ErrTypeConcept,
		attribution == learning.AttrGuessed && j.ErrorType == learning.ErrTypeRecall:
		return "agreed: " + j.ErrorType
	case j.ErrorType == learning.ErrTypeUnknown:
		return "no view: " + attribution
	default:
		return "differs: you said " + attribution + ", the marking says " + j.ErrorType
	}
}
