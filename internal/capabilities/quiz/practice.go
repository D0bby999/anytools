package quiz

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// practice.go — "practise your mistakes" (learning-depth phase 1).
//
// A mistake is fixed by getting THAT question right again, so practice
// serves the question that was missed, unrevealed, and the answer goes
// through the ordinary attempt route: FSRS, overrides and evidence work
// unchanged. Practice itself makes no model call.

// PracticeLimit caps one practice queue.
const PracticeLimit = 20

// PracticeFilter narrows the queue. Now is the clock "today" is read from, in
// the learner's zone; zero means time.Now.
type PracticeFilter struct {
	KBID   *uuid.UUID
	PathID *uuid.UUID
	Now    time.Time
}

// PracticeItem is one open mistake and the question it is about.
type PracticeItem struct {
	Question Question
	// Status is the mistake's: active, retrying or review.
	Status   string
	OpenedAt time.Time
	// Misses counts the wrong answers the mistake holds.
	Misses int
	KBName string
}

// PracticeQueue is what practice shows: the first items, and how many open
// mistakes there are in all ("N left").
type PracticeQueue struct {
	Items     []PracticeItem
	Remaining int
}

// Practice returns the learner's open mistakes, oldest first: those still
// wrong (active, retrying), then those answered right once on an earlier day
// (review), which one more correct answer today graduates.
func (s *Service) Practice(ctx context.Context, userID uuid.UUID, f PracticeFilter) (*PracticeQueue, error) {
	if f.KBID != nil {
		if err := s.authz.OwnsKB(ctx, userID, *f.KBID); err != nil {
			return nil, ErrNoAccess
		}
	}
	if f.Now.IsZero() {
		f.Now = time.Now()
	}
	return s.store.ListMistakes(ctx, userID, f, PracticeLimit)
}
