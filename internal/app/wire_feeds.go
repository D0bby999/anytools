package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_feeds.go — podcast feeds and YouTube playlists and channels in
// Knowledge (up-methods phase 17): the feed collaborators, the
// add_feed_entries job, and the daily check (run inside the web links'
// daily pass, wire_links.go).

// feedDeps are the network collaborators feeds use. The zero value is
// production's; tests aim them at fixtures.
type feedDeps struct {
	// fetch reads feeds and YouTube's pages: security.FetchClient.
	fetch *http.Client
	// media downloads an episode: the same guarded client, with time for
	// knowledge.MaxMediaBytes.
	media *http.Client
	// youtubeBase and dataBase replace YouTube's and the Data API's hosts.
	youtubeBase, dataBase string
}

// feedConfig assembles the knowledge service's feed support.
func feedConfig(pool *pg.Pool, byokSvc *byok.Service, d feedDeps) *knowledge.FeedConfig {
	if d.fetch == nil {
		d.fetch = security.FetchClient(20 * time.Second)
	}
	if d.media == nil {
		d.media = security.FetchClient(10 * time.Minute)
	}
	yt, data := feeds.NewYouTube(d.fetch), feeds.NewData(d.fetch)
	if d.youtubeBase != "" {
		yt.Base = d.youtubeBase
	}
	if d.dataBase != "" {
		data.Base = d.dataBase
	}
	return &knowledge.FeedConfig{
		Store: pg.NewFeedStore(pool), Fetch: d.fetch, MediaFetch: d.media,
		YouTube: yt, Data: data, Keys: byokSvc,
	}
}

// addFeedJobs registers add_feed_entries with every worker.
func addFeedJobs(handlers map[string]jobs.Handler, svc *knowledge.Service, queue *jobs.Queue) {
	handlers[knowledge.JobAddFeedEntries] = feedEntriesHandler(svc, queue)
}

// feedEntriesHandler is the add_feed_entries job: one unit per entry
// (jobs.RunUnits), so a retry never adds an entry twice. A failure of one
// entry is recorded on its row by the service and is not the job's.
func feedEntriesHandler(svc *knowledge.Service, queue *jobs.Queue) jobs.Handler {
	return func(ctx context.Context, job *jobs.Job) error {
		var p knowledge.FeedJobPayload
		if err := decodePayload(job, &p); err != nil {
			return jobs.Terminal(err)
		}
		err := svc.RunFeedAdds(ctx, job.UserID, p,
			func(ctx context.Context, total int, unit func(context.Context, int) (int, error)) error {
				return queue.RunUnits(ctx, job, total, unit)
			})
		if err == nil {
			return nil
		}
		if errors.Is(err, jobs.ErrLeaseLost) {
			return err
		}
		var terminal *jobs.TerminalError
		isTerminal := errors.As(err, &terminal) || knowledge.IsTerminal(err)
		if isTerminal || job.Attempts >= job.MaxAttempts {
			svc.FailFeedAdds(context.WithoutCancel(ctx), job.UserID, p)
		}
		if isTerminal {
			return jobs.Terminal(err)
		}
		return err
	}
}

// runFeedSync is the daily feed check, called from the web links' pass
// under its advisory lock.
func runFeedSync(ctx context.Context, svc *knowledge.Service) {
	rep, err := svc.SyncDueFeeds(ctx)
	switch {
	case errors.Is(err, knowledge.ErrFeedsUnavailable):
	case err != nil:
		slog.Error("knowledge: feed check pass failed", "error", err)
	case rep.Checked > 0:
		slog.Info("knowledge: feed check pass", "checked", rep.Checked, "new", rep.New,
			"auto_added", rep.AutoAdded, "failed", rep.Failed)
	}
}
