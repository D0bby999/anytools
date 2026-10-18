package exam

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
)

// mark.go is taking an exam: start the clock, autosave answers, submit.
//
// Submitting marks every answer through the question bank's own attempt path
// (Marker.Attempt, which is quiz.Service.Attempt): multiple choice and
// true/false exactly, short and cloze answers by the judge, written answers
// by their rubric with partial credit. Each answer is therefore an ordinary
// attempt — below the bar it opens a mistake that Practice serves, and it is
// Loop evidence (`question_attempt`) like any other.
//
// The clock is the server's: started_at and submitted_at are written here,
// never read from the browser. A submission after the limit is accepted and
// flagged late.

// MaxAnswersPerSave bounds one autosave.
const MaxAnswersPerSave = MaxGenerate

// MaxAnswerChars bounds one answer (the column's CHECK).
const MaxAnswerChars = 20000

// ExamView is an exam as the learner sees it.
type ExamView struct {
	Exam
	// Items are hidden until the exam starts: the questions are the exam.
	Items     []ItemView `json:"items"`
	ItemCount int        `json:"item_count"`
	// DeadlineAt is started_at plus the limit; Late is a submission after it.
	DeadlineAt   *time.Time `json:"deadline_at,omitempty"`
	Late         bool       `json:"late"`
	TakenSeconds *int       `json:"taken_seconds,omitempty"`
	// Marked counts the items marked so far (a submit that stopped part-way
	// marks the rest on the next submit).
	Marked int `json:"marked"`
	// Progress is the generation's checkpoint, with the calls billed.
	Progress *jobs.Progress `json:"progress,omitempty"`
	// Sources are what the revealed explanations cite.
	Sources []citations.Source `json:"sources"`
	// ServerNow lets the browser's timer run on the server's clock.
	ServerNow time.Time `json:"server_now"`
}

// ItemView is one item as the learner sees it.
type ItemView struct {
	ID       uuid.UUID      `json:"id"`
	Ord      int            `json:"ord"`
	Number   string         `json:"number"`
	Points   float64        `json:"points"`
	Question map[string]any `json:"question"`
	Answer   string         `json:"answer"`
	// Set once marked: the share of the points, the points, the verdict and
	// the marking's own record (a rubric's criteria included).
	Score   *float64        `json:"score,omitempty"`
	Awarded *float64        `json:"awarded,omitempty"`
	Correct *bool           `json:"correct,omitempty"`
	Judge   json.RawMessage `json:"judge,omitempty"`
}

// View reads one exam with its items.
func (s *Service) View(ctx context.Context, userID, id uuid.UUID) (*ExamView, error) {
	e, err := s.store.GetExam(ctx, userID, id)
	if err != nil {
		return nil, ErrNotFound
	}
	items, err := s.store.Items(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	v := &ExamView{Exam: *e, Items: []ItemView{}, ItemCount: len(items), Sources: []citations.Source{},
		ServerNow: s.now().UTC()}
	if e.Status == ExamGenerating {
		v.Progress = s.progress(ctx, userID, e.JobID)
	}
	if e.StartedAt != nil && e.TimeLimitMinutes != nil {
		deadline := e.StartedAt.Add(time.Duration(*e.TimeLimitMinutes) * time.Minute)
		v.DeadlineAt = &deadline
		v.Late = e.SubmittedAt != nil && e.SubmittedAt.After(deadline)
	}
	if e.StartedAt != nil && e.SubmittedAt != nil {
		taken := int(e.SubmittedAt.Sub(*e.StartedAt).Seconds())
		v.TakenSeconds = &taken
	}

	var revealed []quiz.Question
	for _, it := range items {
		if it.AttemptID != nil {
			v.Marked++
		}
		if e.Status != ExamInProgress && e.Status != ExamSubmitted {
			continue
		}
		show := e.Status == ExamSubmitted && it.AttemptID != nil
		iv := ItemView{ID: it.ID, Ord: it.Ord, Number: it.Number, Points: it.Points,
			Question: it.Question.View(show), Answer: it.Answer}
		if show {
			awarded := roundPoints(*it.Score * it.Points)
			iv.Score, iv.Awarded, iv.Correct, iv.Judge = it.Score, &awarded, it.AttemptCorrect, it.Judge
			revealed = append(revealed, it.Question)
		}
		v.Items = append(v.Items, iv)
	}
	if len(revealed) > 0 {
		v.Sources = s.marker.Sources(ctx, userID, revealed...)
	}
	return v, nil
}

// Start starts the clock on a generated exam. limit overrides the template's
// time limit; nil keeps it.
func (s *Service) Start(ctx context.Context, userID, id uuid.UUID, limit *int) (*ExamView, error) {
	if limit != nil && (*limit < 1 || *limit > 600) {
		return nil, errorf("the time limit is 1 to 600 minutes")
	}
	ok, err := s.store.Start(ctx, userID, id, limit, s.now().UTC())
	if err != nil {
		return nil, err
	}
	if !ok {
		if _, err := s.store.GetExam(ctx, userID, id); err != nil {
			return nil, ErrNotFound
		}
		return nil, ErrConflict
	}
	return s.View(ctx, userID, id)
}

// SaveAnswers autosaves answers to an exam in progress. Every item must be
// this exam's; one that is not refuses the whole save.
func (s *Service) SaveAnswers(ctx context.Context, userID, id uuid.UUID, answers []Answer) error {
	if len(answers) > MaxAnswersPerSave {
		return errorf("save at most %d answers at once", MaxAnswersPerSave)
	}
	for _, a := range answers {
		if utf8.RuneCountInString(a.Text) > MaxAnswerChars {
			return errorf("an answer is at most %d characters", MaxAnswerChars)
		}
	}
	return s.store.SaveAnswers(ctx, userID, id, answers, s.now().UTC())
}

// Submit ends the exam and marks every answer not yet marked.
//
// Marking makes up to one model call per short, cloze or written answer, so
// it runs MarkWorkers at a time. An answer whose marking fails stays
// unmarked, the others are kept, and the error says how many are left:
// submitting again marks only those.
func (s *Service) Submit(ctx context.Context, userID, id uuid.UUID) (*ExamView, error) {
	e, err := s.store.BeginSubmit(ctx, userID, id, s.now().UTC())
	if err != nil {
		return nil, err
	}
	items, err := s.store.Items(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if e.Status == ExamSubmitted {
		return s.View(ctx, userID, id)
	}

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
		failed   int
	)
	sem := make(chan struct{}, MarkWorkers)
	for i := range items {
		if items[i].AttemptID != nil {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(it *ExamItem) {
			defer func() { <-sem; wg.Done() }()
			err := s.markItem(ctx, userID, it)
			if err != nil {
				mu.Lock()
				failed++
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
			}
		}(&items[i])
	}
	wg.Wait()
	if failed > 0 {
		return nil, &IncompleteError{Unmarked: failed, Total: len(items), Cause: firstErr}
	}

	var score, maxScore float64
	for _, it := range items {
		score += *it.Score * it.Points
		maxScore += it.Points
	}
	if err := s.store.FinishMarking(ctx, userID, id, roundPoints(score), roundPoints(maxScore)); err != nil {
		return nil, err
	}
	return s.View(ctx, userID, id)
}

// markItem answers one item's question through the bank and records the
// attempt on the item. A written answer's score is its rubric's share; any
// other is 1 or 0.
func (s *Service) markItem(ctx context.Context, userID uuid.UUID, it *ExamItem) error {
	res, err := s.marker.Attempt(ctx, userID, it.Question.ID, quiz.AttemptRequest{UserAnswer: it.Answer})
	if err != nil {
		return err
	}
	score := 0.0
	switch {
	case res.Attempt.Score != nil:
		score = *res.Attempt.Score
	case res.Attempt.IsCorrect:
		score = 1
	}
	if err := s.store.SaveMark(ctx, userID, it.ID, res.Attempt.ID, score); err != nil {
		return err
	}
	it.AttemptID, it.Score = &res.Attempt.ID, &score
	return nil
}

func roundPoints(v float64) float64 { return math.Round(v*100) / 100 }

// IncompleteError is a submit whose marking stopped part-way: it is
// ErrMarkingIncomplete, and it is its first failure's cause (a missing route,
// a provider error) for the handler to name.
type IncompleteError struct {
	Unmarked, Total int
	Cause           error
}

func (e *IncompleteError) Error() string {
	return fmt.Sprintf("%s: %d of %d answers are not marked yet: %v", ErrMarkingIncomplete, e.Unmarked, e.Total, e.Cause)
}

// Unwrap exposes both the sentinel and the cause.
func (e *IncompleteError) Unwrap() []error { return []error{ErrMarkingIncomplete, e.Cause} }
