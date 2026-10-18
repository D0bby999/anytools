package loop

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
)

// Weekly capacities: how much a week can hold. Planning a reduced week in
// advance is how a busy week stays a week of the cycle instead of a gap in it.
const (
	CapacityFull    = "full"
	CapacityReduced = "reduced"
	CapacityMinimum = "minimum"
)

// MaxWeeklyQuestions is the number of weekly question slots in a cycle.
const MaxWeeklyQuestions = 12

// Cycle is one 90-day cycle of a learning state.
type Cycle struct {
	ID              uuid.UUID        `json:"id"`
	UserID          uuid.UUID        `json:"-"`
	StateID         uuid.UUID        `json:"state_id"`
	StartedAt       time.Time        `json:"started_at"`
	Phase           string           `json:"phase"`
	GateEvidence    []GateRecord     `json:"gate_evidence"`
	WeeklyQuestions []WeeklyQuestion `json:"weekly_questions"`
	Interruptions   []Interruption   `json:"interruptions"`
	Day90ReviewMD   string           `json:"day90_review_md"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

// WeeklyQuestion is the question one week of the cycle is trying to answer.
type WeeklyQuestion struct {
	Question string `json:"question"`
	Capacity string `json:"capacity"`
}

// GateRecord is one granted advance, frozen at the moment it was granted.
type GateRecord struct {
	From    string      `json:"from"`
	To      string      `json:"to"`
	At      time.Time   `json:"at"`
	RefIDs  []uuid.UUID `json:"ref_ids"`
	Reviews int         `json:"reviews"`
}

// CyclePatch carries the fields a cycle update may change. Phase is absent:
// only Advance moves it, and only through a gate.
type CyclePatch struct {
	WeeklyQuestions *[]WeeklyQuestion `json:"weekly_questions"`
	Day90ReviewMD   *string           `json:"day90_review_md"`
}

// Validate checks a patch.
func (p CyclePatch) Validate() error {
	if p.WeeklyQuestions != nil {
		qs := *p.WeeklyQuestions
		if len(qs) > MaxWeeklyQuestions {
			return fmt.Errorf("%w: a cycle has %d weekly questions at most", ErrInvalid, MaxWeeklyQuestions)
		}
		for i, q := range qs {
			if len(q.Question) > MaxTaskLen {
				return fmt.Errorf("%w: week %d's question is too long", ErrInvalid, i+1)
			}
			if strings.TrimSpace(q.Question) != "" && !validCapacity(q.Capacity) {
				return fmt.Errorf("%w: week %d's capacity must be full, reduced or minimum", ErrInvalid, i+1)
			}
		}
	}
	if p.Day90ReviewMD != nil && len(*p.Day90ReviewMD) > MaxHandoverLen {
		return fmt.Errorf("%w: the 90-day review is too long", ErrInvalid)
	}
	return nil
}

// CycleDetail is a cycle with what its page needs: the gate as it stands, its
// reviews, and the week it is in.
type CycleDetail struct {
	Cycle
	Goal        string         `json:"goal"`
	CurrentWeek int            `json:"current_week"`
	Gate        GateResult     `json:"gate"`
	Reviews     []WeeklyReview `json:"reviews"`
	// Day is the cycle's day on the learner's calendar (CycleDay). From
	// CloseFromDay on, the page offers "Close this cycle".
	Day          int `json:"day"`
	CloseFromDay int `json:"close_from_day"`
}

// CloseFromDay is the day of a cycle from which its page offers the
// structured day-90 close (up methods, phase 10): the last week of the
// twelve, so the close is written while the cycle is still fresh.
const CloseFromDay = 84

// CycleDay is the day of the cycle t falls on, counted on the learner's
// calendar in zone: 1 on the day it started, whatever the hour. Before the
// start it is 1.
func CycleDay(startedAt, t time.Time, zone string) int {
	start, now := learning.LocalDay(startedAt, zone), learning.LocalDay(t, zone)
	days := int(dayTime(now).Sub(dayTime(start)).Hours()/24) + 1
	if days < 1 {
		return 1
	}
	return days
}

func dayTime(d learning.Day) time.Time {
	return time.Date(d.Year, d.Month, d.Day, 0, 0, 0, 0, time.UTC)
}

func validCapacity(c string) bool {
	return c == CapacityFull || c == CapacityReduced || c == CapacityMinimum
}
