package app

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/api/gcalapi"
	"github.com/D0bby999/anytools/internal/calendar"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gcal"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildGCal is the Google Calendar writer (learning-tool-connections phase
// 3), on the Google grant Drive holds. Nil without Drive.
func buildGCal(pool *pg.Pool, google *drive.Service, events *calendar.Service, due gcal.Counter) (*gcalapi.Handler, *gcal.Service) {
	if google == nil {
		return nil, nil
	}
	svc := gcal.NewService(google, pg.NewGCalStore(pool), events, due)
	return gcalapi.NewHandler(svc), svc
}

// startGCalSync keeps every AnyLearn calendar in step, hourly. The first
// pass waits an interval, as Drive's does: a restart changes nobody's day.
func startGCalSync(ctx context.Context, wg *sync.WaitGroup, svc *gcal.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(gcal.SyncInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				passCtx, cancel := context.WithTimeout(ctx, gcal.SyncInterval-5*time.Minute)
				users, failed := svc.SyncAll(passCtx)
				cancel()
				if users > 0 {
					slog.Info("gcal: sync pass", "users", users, "failed", failed)
				}
			}
		}
	}()
}
