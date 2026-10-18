package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_sources.go — documentation sites and GitHub repositories in Knowledge
// (up-methods phase 18): the source collaborators, the crawl_site and
// sync_repo jobs, and the weekly re-sync pass.

// sourceDeps are the network collaborators sources use. The zero value is
// production's; the end-to-end test scripts both.
type sourceDeps struct {
	// fetch defaults to security.FetchClient (the guarded dialer).
	fetch *http.Client
	// github defaults to the allowlisted github.com client over the same
	// guarded dialer, with a timeout long enough for a 100 MB tarball.
	github  *github.Client
	limiter *crawl.Limiter
}

// sourceConfig assembles the knowledge service's site and repository support.
func sourceConfig(pool *pg.Pool, byokSvc *byok.Service, queue *jobs.Queue, d sourceDeps) *knowledge.SourceConfig {
	if d.fetch == nil {
		d.fetch = security.FetchClient(20 * time.Second)
	}
	if d.github == nil {
		d.github = github.NewClient(security.FetchClient(5 * time.Minute))
	}
	return &knowledge.SourceConfig{
		Store:   pg.NewSourceStore(pool),
		Fetch:   d.fetch,
		GitHub:  d.github,
		Tokens:  byokSvc,
		Cancel:  queue,
		Limiter: d.limiter,
	}
}

// addSourceJobs registers the two source jobs with every worker.
func addSourceJobs(handlers map[string]jobs.Handler, svc *knowledge.Service, queue *jobs.Queue) {
	handlers[knowledge.JobCrawlSite] = crawlSiteHandler(svc, queue)
	handlers[knowledge.JobSyncRepo] = syncRepoHandler(svc)
}

// crawlSiteHandler is the crawl_site job: one unit per page (jobs.RunUnits),
// so a retry resumes at the first unfinished page and a cancel stops after
// the page in flight.
func crawlSiteHandler(svc *knowledge.Service, queue *jobs.Queue) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var p knowledge.SourceJobPayload
		if err := decodePayload(job, &p); err != nil {
			return jobs.Terminal(err)
		}
		err := svc.RunCrawl(ctx, job.UserID, p.SiteID, job.ID,
			func(ctx context.Context, total int, unit func(context.Context, int) (int, error)) error {
				return queue.RunUnits(ctx, job, total, unit)
			})
		if err == nil {
			return nil
		}
		if errors.Is(err, jobs.ErrLeaseLost) {
			// Another worker owns the job now; it writes the outcome.
			return err
		}
		var terminal *jobs.TerminalError
		isTerminal := errors.As(err, &terminal) || knowledge.IsTerminal(err)
		if isTerminal || job.Attempts >= job.MaxAttempts {
			svc.FailCrawl(ctx, job.UserID, p.SiteID, err, errors.Is(err, jobs.ErrCancelled))
		}
		if isTerminal {
			return jobs.Terminal(err)
		}
		return err
	}
}

// syncRepoHandler is the sync_repo job: one pass, resumable by nature (a
// file whose bytes are already stored is not stored again).
func syncRepoHandler(svc *knowledge.Service) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var p knowledge.SourceJobPayload
		if err := decodePayload(job, &p); err != nil {
			return jobs.Terminal(err)
		}
		_, err := svc.SyncRepo(ctx, job.UserID, p.RepoID, job.ID)
		if err == nil {
			return nil
		}
		isTerminal := knowledge.IsTerminal(err)
		if isTerminal || job.Attempts >= job.MaxAttempts {
			svc.FailRepoSync(ctx, job.UserID, p.RepoID, err)
		}
		if isTerminal {
			return jobs.Terminal(err)
		}
		return err
	}
}

// SourceSyncLock is the advisory-lock name the weekly re-sync holds.
const SourceSyncLock = "sync_sources"

// startSourceSync checks hourly for sites and repositories a week past their
// last sync and queues their re-sync, advisory-locked like the web re-sync.
func startSourceSync(ctx context.Context, wg *sync.WaitGroup, pool *pg.Pool, svc *knowledge.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runSourceSync(ctx, pool, svc)
			}
		}
	}()
}

func runSourceSync(ctx context.Context, pool *pg.Pool, svc *knowledge.Service) {
	var rep knowledge.SourceSyncReport
	ran, err := jobs.WithAdvisoryLock(ctx, pool, SourceSyncLock, func(ctx context.Context) error {
		var err error
		rep, err = svc.SyncDueSources(ctx)
		return err
	})
	switch {
	case err != nil:
		slog.Error("knowledge: source re-sync pass failed", "error", err)
	case ran && rep.Sites+rep.Repos+rep.Failed > 0:
		slog.Info("knowledge: source re-sync pass", "sites", rep.Sites, "repos", rep.Repos, "failed", rep.Failed)
	}
}
