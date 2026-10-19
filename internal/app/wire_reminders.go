package app

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/body"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/vocab"
)

// dueTotal is the review reminder's count (push.Counter): the sum Home's "Due
// for review" shows (ui/web/app/routes/home.tsx), read through the same
// service calls behind each of its six rows, so the push and the page give one
// number. Each call is user-scoped; the learners are the reminder's
// candidates, a handful an hour.
type dueTotal struct {
	mastery    *pg.MasteryStore
	mistakes   *pg.QuestionStore
	vocab      *vocab.Service
	loop       *loop.Service
	worksheets *worksheet.Service
}

func newDueTotal(pool *pg.Pool, loopSvc *loop.Service) dueTotal {
	users := pg.NewUserStore(pool)
	return dueTotal{
		mastery:    pg.NewMasteryStore(pool),
		mistakes:   pg.NewQuestionStore(pool),
		vocab:      vocab.NewService(vocab.Config{Store: pg.NewVocabStore(pool), Zones: users}),
		loop:       loopSvc,
		worksheets: worksheet.NewService(pg.NewWorksheetStore(pool), users, nil),
	}
}

// homeDueLimit is the mastery list Home reads, so a learner with more than
// that due reads the same number in both places.
const homeDueLimit = 200

// DueTotal implements push.Counter.
func (d dueTotal) DueTotal(ctx context.Context, userID uuid.UUID) (int, error) {
	now := time.Now()
	points, err := d.mastery.Due(ctx, userID, now.UTC(), homeDueLimit)
	if err != nil {
		return 0, err
	}
	mistakes, err := d.mistakes.ListMistakes(ctx, userID, quiz.PracticeFilter{Now: now}, quiz.PracticeLimit)
	if err != nil {
		return 0, err
	}
	retests, _, err := d.loop.RetestsDue(ctx, userID)
	if err != nil {
		return 0, err
	}
	total := len(points) + mistakes.Remaining + len(retests)
	for _, deck := range []string{vocab.DeckWords, vocab.DeckBook} {
		_, n, err := d.vocab.DueDeck(ctx, userID, deck, 0)
		if err != nil {
			return 0, err
		}
		total += n
	}
	reviews, err := d.worksheets.Due(ctx, userID)
	if err != nil {
		return 0, err
	}
	// A private worksheet's reviews count once per worksheet, as Home's
	// dueCounts does: its titles are not shown, so neither is how many.
	private := map[uuid.UUID]bool{}
	for _, r := range reviews {
		if r.Private {
			private[r.ID] = true
		} else {
			total++
		}
	}
	return total + len(private), nil
}

// newTrainingPlanner is the reminder's push.Planner: Body's service, which
// names the routine the learner's week schedules today. Stateless, so a second
// one beside bodyapi's (wire_body.go) shares nothing that could drift.
func newTrainingPlanner(pool *pg.Pool) *body.Service {
	return body.NewService(pg.NewBodyStore(pool), pg.NewUserStore(pool), nil)
}
