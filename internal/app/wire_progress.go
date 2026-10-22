package app

import (
	"context"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/circleapi"
	"github.com/D0bby999/anytools/internal/api/progressapi"
	"github.com/D0bby999/anytools/internal/circles"
	"github.com/D0bby999/anytools/internal/progress"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildProgress is study days, streaks, milestones and study circles
// (the private design notes). A circle shows each member's
// progress counted by the same service, in the member's own zone.
func buildProgress(pool *pg.Pool, svc *progress.Service) (*progressapi.Handler, *circleapi.Handler) {
	return progressapi.NewHandler(svc), circleapi.NewHandler(circles.NewService(pg.NewCircleStore(pool), svc))
}

// progressStreak is the review reminder's streak (push.Streaker).
type progressStreak struct{ svc *progress.Service }

func (p progressStreak) Streak(ctx context.Context, user uuid.UUID) (int, error) {
	b, err := p.svc.Brief(ctx, user, progress.FreshForHome)
	return b.Streak, err
}
