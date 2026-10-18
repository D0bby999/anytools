package app

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/api/loopapi"
	"github.com/D0bby999/anytools/internal/learning/loop"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_loop.go assembles phase 10: the learning loop's service, its HTTP
// handler, and the nightly evidence-suggestion job.
//
// The service is built BEFORE the turn engine, because the chat capability
// reads linked learning states through it (chat.WithLearningStates). It
// creates resume sessions through its own ChatStore over the same pool; the
// store is a stateless wrapper, so this is the same table the chat handler
// writes, not a second copy of anything.

// buildLoop returns the loop service, its handler and the job starter. now
// may be nil for the wall clock.
func buildLoop(pool *pg.Pool, now func() time.Time) (
	*loop.Service, *loopapi.Handler, func(context.Context, *sync.WaitGroup),
) {
	store := pg.NewLoopStore(pool)
	// Retest days are the learner's calendar days (learning.LocalDay).
	svc := loop.NewService(store, pg.NewChatStore(pool), now).WithZones(pg.NewUserStore(pool))

	job := loop.NewSuggestJob(pool, store)
	start := func(ctx context.Context, wg *sync.WaitGroup) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job.Start(ctx)
		}()
		slog.Info("boot: learning-loop evidence suggestions scheduled", "hour", loop.SuggestHour)
	}
	return svc, loopapi.NewHandler(svc), start
}
