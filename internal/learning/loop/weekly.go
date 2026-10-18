package loop

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// weekly.go is the weekly review and the rules for writing it back into the
// learning state.
//
// Writeback is the moment a week's review stops being a diary entry and starts
// changing the plan: each diagnosed mistake becomes a hypothesis with a test
// and a stop condition, and the one change for next week is recorded beside
// them. The rules below are what make that worth trusting — a review with no
// evidence, an unscored check, or a zero with no diagnosis is refused, because
// writing it back would put a guess into the state with the same standing as
// a finding.

// Confidence levels on a diagnosed mistake.
const (
	ConfidenceLow    = "low"
	ConfidenceMedium = "medium"
	ConfidenceHigh   = "high"
)

// MaxWeek is the last week number a 90-day cycle has (twelve weeks and six
// days; week 13 holds the tail).
const MaxWeek = 13

// WeeklyReview is one row of weekly_reviews.
type WeeklyReview struct {
	ID      uuid.UUID `json:"id"`
	UserID  uuid.UUID `json:"-"`
	CycleID uuid.UUID `json:"cycle_id"`
	WeekNo  int       `json:"week_no"`

	// Scores are nil until scored: "not scored" and "scored zero" are
	// different facts.
	Completion *int `json:"completion"`
	Quality    *int `json:"quality"`
	Retention  *int `json:"retention"`
	Transfer   *int `json:"transfer"`

	Errors            []ReviewError `json:"errors"`
	Energy            string        `json:"energy"`
	OneVariableChange string        `json:"one_variable_change"`

	WritebackDone bool       `json:"writeback_done"`
	WrittenBackAt *time.Time `json:"written_back_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ReviewError is one diagnosed mistake of the week.
type ReviewError struct {
	Evidence      string `json:"evidence"`
	Cause         string `json:"cause"`
	Confidence    string `json:"confidence"`
	NextTest      string `json:"next_test"`
	StopCondition string `json:"stop_condition"`
}

// ReviewPatch carries the fields a review update may change. WritebackDone is
// absent: only the writeback endpoint sets it.
type ReviewPatch struct {
	Completion        *int           `json:"completion"`
	Quality           *int           `json:"quality"`
	Retention         *int           `json:"retention"`
	Transfer          *int           `json:"transfer"`
	Errors            *[]ReviewError `json:"errors"`
	Energy            *string        `json:"energy"`
	OneVariableChange *string        `json:"one_variable_change"`
}

// Checks returns the four scores by name, in display order.
func (r WeeklyReview) Checks() []ScoredCheck {
	return []ScoredCheck{
		{Name: "completion", Score: r.Completion},
		{Name: "quality", Score: r.Quality},
		{Name: "retention", Score: r.Retention},
		{Name: "transfer", Score: r.Transfer},
	}
}

// ScoredCheck is one of the four checks.
type ScoredCheck struct {
	Name  string
	Score *int
}

// Validate checks a patch before it reaches the database, so the person gets
// a sentence rather than a constraint violation.
func (p ReviewPatch) Validate() error {
	for name, s := range map[string]*int{
		"completion": p.Completion, "quality": p.Quality,
		"retention": p.Retention, "transfer": p.Transfer,
	} {
		if s != nil && (*s < 0 || *s > 2) {
			return fmt.Errorf("%w: %s must be scored 0, 1 or 2", ErrInvalid, name)
		}
	}
	if p.Errors != nil {
		if len(*p.Errors) > 20 {
			return fmt.Errorf("%w: at most 20 mistakes per week", ErrInvalid)
		}
		for i, e := range *p.Errors {
			if e.Confidence != "" && !validConfidence(e.Confidence) {
				return fmt.Errorf("%w: mistake %d: confidence must be low, medium or high", ErrInvalid, i+1)
			}
		}
	}
	if p.Energy != nil && len(*p.Energy) > 1000 {
		return fmt.Errorf("%w: the energy note is too long", ErrInvalid)
	}
	if p.OneVariableChange != nil && len(*p.OneVariableChange) > 1000 {
		return fmt.Errorf("%w: the change for next week is too long", ErrInvalid)
	}
	return nil
}

// WritebackProblems lists every reason a review cannot be written back yet,
// in the order the review form presents them. Empty means it can.
//
// acceptedRefs is the number of ACCEPTED evidence refs on the review.
func WritebackProblems(r WeeklyReview, acceptedRefs int) []string {
	var out []string
	if r.WritebackDone {
		return []string{"This review has already been written back."}
	}
	for _, c := range r.Checks() {
		if c.Score == nil {
			out = append(out, fmt.Sprintf("Score %s (0, 1 or 2).", c.Name))
		}
	}
	if acceptedRefs < 1 {
		out = append(out, "Accept at least one piece of evidence from this week.")
	}
	change := strings.TrimSpace(r.OneVariableChange)
	switch {
	case change == "":
		out = append(out, "Name the one thing you will change next week.")
	case nonEmptyLines(change) > 1:
		out = append(out, "Change one thing at a time: keep next week's change to a single line.")
	}
	anyZero := false
	for _, c := range r.Checks() {
		if c.Score != nil && *c.Score == 0 {
			anyZero = true
		}
	}
	if anyZero && len(r.Errors) == 0 {
		out = append(out, "A check scored 0 needs at least one diagnosed mistake.")
	}
	for i, e := range r.Errors {
		var gaps []string
		if strings.TrimSpace(e.Evidence) == "" {
			gaps = append(gaps, "evidence")
		}
		if strings.TrimSpace(e.Cause) == "" {
			gaps = append(gaps, "cause")
		}
		if !validConfidence(e.Confidence) {
			gaps = append(gaps, "confidence")
		}
		if strings.TrimSpace(e.NextTest) == "" {
			gaps = append(gaps, "next test")
		}
		if strings.TrimSpace(e.StopCondition) == "" {
			gaps = append(gaps, "stop condition")
		}
		if len(gaps) > 0 {
			out = append(out, fmt.Sprintf("Mistake %d is missing: %s.", i+1, strings.Join(gaps, ", ")))
		}
	}
	return out
}

// PlanWriteback returns what writing a review back adds to the state's
// hypotheses, or ErrNotReady with the problems when it may not be written back.
func PlanWriteback(r WeeklyReview, acceptedRefs int) ([]Hypothesis, error) {
	if problems := WritebackProblems(r, acceptedRefs); len(problems) > 0 {
		return nil, &NotReadyError{Problems: problems}
	}
	out := make([]Hypothesis, 0, len(r.Errors)+1)
	for _, e := range r.Errors {
		out = append(out, Hypothesis{
			Claim:         strings.TrimSpace(e.Cause),
			Evidence:      strings.TrimSpace(e.Evidence),
			NextTest:      strings.TrimSpace(e.NextTest),
			StopCondition: strings.TrimSpace(e.StopCondition),
			Confidence:    e.Confidence,
			Week:          r.WeekNo,
			Source:        HypothesisFromError,
		})
	}
	out = append(out, Hypothesis{
		Claim:  strings.TrimSpace(r.OneVariableChange),
		Week:   r.WeekNo,
		Source: HypothesisFromChange,
		// The test of a weekly change is the next week's review; saying so
		// keeps the entry from reading as a finding.
		NextTest: fmt.Sprintf("Compare week %d's scores with week %d's.", r.WeekNo+1, r.WeekNo),
	})
	return out, nil
}

// WeekOf returns the week of a cycle that t falls in, clamped to 1..MaxWeek.
func WeekOf(startedAt, t time.Time) int {
	if t.Before(startedAt) {
		return 1
	}
	w := int(t.Sub(startedAt)/(7*24*time.Hour)) + 1
	if w > MaxWeek {
		return MaxWeek
	}
	return w
}

// WeekWindow returns [from, to) for week w of a cycle.
func WeekWindow(startedAt time.Time, w int) (time.Time, time.Time) {
	from := startedAt.Add(time.Duration(w-1) * 7 * 24 * time.Hour)
	return from, from.Add(7 * 24 * time.Hour)
}

func validConfidence(c string) bool {
	return c == ConfidenceLow || c == ConfidenceMedium || c == ConfidenceHigh
}

func nonEmptyLines(s string) int {
	n := 0
	for _, line := range strings.Split(s, "\n") {
		if strings.TrimSpace(line) != "" {
			n++
		}
	}
	return n
}
