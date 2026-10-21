package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/D0bby999/anytools/internal/api/libraryapi"
	"github.com/D0bby999/anytools/internal/library"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildLibrary is the Library's catalogue (the private design notes). The catalogue built into this binary is loaded into Postgres
// before the server answers, unless the same version or a later one is
// loaded: a data load, not a schema change, so it is not left to
// `anytools migrate`. When it fails (the database is down, or `serve` ran
// before `migrate up`), whatever catalogue is loaded keeps answering, or the
// Library answers 503 "still being loaded" if none is; the load is retried
// in the background, and `anytools library import` runs it by hand.
func buildLibrary(ctx context.Context, pool *pg.Pool) *libraryapi.Handler {
	svc := library.NewService(pg.NewLibraryStore(pool))
	if err := syncLibrary(ctx, svc); err != nil {
		slog.Error("boot: the Library's catalogue was not loaded; retrying in the background", "error", err)
		go retryLibrary(ctx, svc)
	}
	return libraryapi.NewHandler(svc)
}

func syncLibrary(ctx context.Context, svc *library.Service) error {
	loadCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	_, err := svc.Sync(loadCtx, false)
	return err
}

// retryLibrary tries again after one minute, then twice as long each time,
// up to an hour, until the load succeeds or the server stops.
func retryLibrary(ctx context.Context, svc *library.Service) {
	for wait := time.Minute; ; wait = min(2*wait, time.Hour) {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		err := syncLibrary(ctx, svc)
		if err == nil {
			return
		}
		slog.Error("library: the catalogue is still not loaded", "error", err, "next_try", (2 * wait).String())
	}
}
