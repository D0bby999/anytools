package app

import (
	"context"
	"log/slog"
	"sync"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/profileapi"
	"github.com/D0bby999/anytools/internal/learning/profile"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_profile.go assembles learning-depth phase 9: the learner profile's
// handler, the nightly consolidation job, and the reader the chat and mastery
// capabilities pull the profile through.
//
// The job resolves the learner's own `chat` route through the same BYOK
// resolver chat uses, so a learner with nothing routed is skipped rather
// than served by anything else.

// buildProfile returns the profile handler and the job starter.
func buildProfile(pool *pg.Pool, models runtime.ChatProviderResolver) (*profileapi.Handler, func(context.Context, *sync.WaitGroup)) {
	store := pg.NewProfileStore(pool)
	job := profile.NewJob(pool, store, models)
	start := func(ctx context.Context, wg *sync.WaitGroup) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job.Start(ctx)
		}()
		slog.Info("boot: learner-profile consolidation scheduled", "local_hour", profile.ConsolidateHour)
	}
	return profileapi.NewHandler(profile.NewService(store, nil)), start
}

// learnerProfile is the chat and mastery capabilities' view of the profile:
// each asks for its own sections, and gets them rendered and enveloped by
// internal/learning/profile. It lives here because chat must not import the
// envelope (internal/tools' own tests import chat).
type learnerProfile struct{ prompts *profile.Prompts }

func newLearnerProfile(pool *pg.Pool) learnerProfile {
	return learnerProfile{prompts: profile.NewPrompts(pg.NewProfileStore(pool))}
}

// ChatNote implements chat.LearnerProfile: Preferences only.
func (l learnerProfile) ChatNote(ctx context.Context, userID uuid.UUID, kbIDs []uuid.UUID) (string, error) {
	return l.prompts.Note(ctx, userID, profile.UseChat, kbIDs)
}

// MasteryNote implements mastery.Profile: Preferences and this knowledge
// base's Struggles.
func (l learnerProfile) MasteryNote(ctx context.Context, userID, kbID uuid.UUID) (string, error) {
	return l.prompts.Note(ctx, userID, profile.UseMastery, []uuid.UUID{kbID})
}
