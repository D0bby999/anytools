package knowledge

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/connectors/github"
)

// sources.go — documentation sites and GitHub repositories (up-methods
// phase 18).
//
// A site or a repository is a group of ordinary documents. Each crawled page
// becomes a `site_page` document with its own URL and each imported file a
// `repo_file` document with its own path, parsed, chunked and embedded like
// any link, so a citation names the page or the file. The group remembers
// what was asked (start URL and limits; repository, branch, folder and types)
// and what the last sync found.
//
// Re-sync is weekly, or when the learner asks. Only content whose bytes
// changed is re-indexed; a page or file that is gone is MARKED removed and
// stays until the learner deletes it.

// Site statuses.
const (
	SiteQueued    = "queued"
	SiteCrawling  = "crawling"
	SiteReady     = "ready"
	SiteFailed    = "failed"
	SiteCancelled = "cancelled"
)

// Repo statuses.
const (
	RepoQueued  = "queued"
	RepoSyncing = "syncing"
	RepoReady   = "ready"
	RepoFailed  = "failed"
)

// Site page statuses, per crawl.
const (
	PagePending   = "pending"
	PageAdded     = "added"
	PageChanged   = "changed"
	PageUnchanged = "unchanged"
	PageSkipped   = "skipped"
	PageFailed    = "failed"
	PageRemoved   = "removed"
)

// Job kinds.
const (
	JobCrawlSite = "crawl_site"
	JobSyncRepo  = "sync_repo"
)

// ResyncEvery is how often a site or repository re-syncs on its own.
const ResyncEvery = 7 * 24 * time.Hour

// Site is a crawled documentation site.
type Site struct {
	ID            uuid.UUID  `json:"id"`
	UserID        uuid.UUID  `json:"-"`
	KBID          uuid.UUID  `json:"kb_id"`
	StartURL      string     `json:"start_url"`
	PathPrefix    string     `json:"path_prefix"`
	MaxDepth      int        `json:"max_depth"`
	MaxPages      int        `json:"max_pages"`
	Title         string     `json:"title"`
	Status        string     `json:"status"`
	Error         string     `json:"error,omitempty"`
	JobID         *uuid.UUID `json:"job_id,omitempty"`
	Generation    int        `json:"generation"`
	LastCrawledAt *time.Time `json:"last_crawled_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	// RobotsTxt is the file read at the start of the current crawl; nil when
	// the site has none.
	RobotsTxt *string `json:"-"`
	// Progress of the current or last crawl: pages found, pages finished,
	// and the documents the group holds.
	Found     int `json:"found"`
	Done      int `json:"done"`
	Documents int `json:"documents"`
	Removed   int `json:"removed"`
}

// SitePage is one URL a crawl found.
type SitePage struct {
	URL        string     `json:"url"`
	Depth      int        `json:"depth"`
	Ord        *int       `json:"ord,omitempty"`
	Status     string     `json:"status"`
	Reason     string     `json:"reason,omitempty"`
	DocumentID *uuid.UUID `json:"document_id,omitempty"`
	// From the page's document, when it has one.
	Title     string     `json:"title,omitempty"`
	DocStatus string     `json:"document_status,omitempty"`
	RemovedAt *time.Time `json:"removed_at,omitempty"`
}

// Repo is an imported GitHub repository (or one folder of it).
type Repo struct {
	ID             uuid.UUID  `json:"id"`
	UserID         uuid.UUID  `json:"-"`
	KBID           uuid.UUID  `json:"kb_id"`
	Owner          string     `json:"owner"`
	Name           string     `json:"name"`
	Branch         string     `json:"branch"`
	ResolvedBranch string     `json:"resolved_branch,omitempty"`
	PathPrefix     string     `json:"path_prefix"`
	Extensions     []string   `json:"extensions"`
	IgnorePaths    []string   `json:"ignore_paths"`
	Status         string     `json:"status"`
	Error          string     `json:"error,omitempty"`
	Note           string     `json:"note,omitempty"`
	JobID          *uuid.UUID `json:"job_id,omitempty"`
	CommitSHA      string     `json:"commit_sha,omitempty"`
	FileCount      int        `json:"file_count"`
	LastSyncedAt   *time.Time `json:"last_synced_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	Removed        int        `json:"removed"`
}

// SourceJobPayload is the body of a crawl_site or sync_repo job.
type SourceJobPayload struct {
	SiteID uuid.UUID `json:"site_id,omitempty"`
	RepoID uuid.UUID `json:"repo_id,omitempty"`
}

// SourceStore is the persistence sites and repositories need. Every method
// but the Due scans is scoped by user.
type SourceStore interface {
	CreateSite(ctx context.Context, s Site) (*Site, error)
	GetSite(ctx context.Context, userID, siteID uuid.UUID) (*Site, error)
	ListSites(ctx context.Context, userID, kbID uuid.UUID) ([]Site, error)
	SitePages(ctx context.Context, userID, siteID uuid.UUID) ([]SitePage, error)
	DeleteSite(ctx context.Context, userID, siteID uuid.UUID) error
	// QueueSiteCrawl moves a resting site (or a new one) to queued with its
	// job; ErrDocumentFinal when it is already queued or crawling.
	QueueSiteCrawl(ctx context.Context, userID, siteID, jobID uuid.UUID) error
	// BeginCrawl starts a generation: robots.txt stored, the frontier reset to
	// the start URL, status crawling. Only from queued.
	BeginCrawl(ctx context.Context, userID, siteID uuid.UUID, robots *string) error
	CrawlTotal(ctx context.Context, userID, siteID uuid.UUID) (int, error)
	PageAt(ctx context.Context, userID, siteID uuid.UUID, ord int) (*SitePage, error)
	// AddFrontier appends new URLs at the next ords, up to maxPages in all.
	AddFrontier(ctx context.Context, userID, siteID uuid.UUID, urls []string, depth, maxPages int) (int, error)
	SetPageResult(ctx context.Context, userID, siteID uuid.UUID, url, status, reason string, docID *uuid.UUID) error
	SetSiteTitle(ctx context.Context, userID, siteID uuid.UUID, title string) error
	// FinishCrawl marks the documents of pages the generation did not reach
	// as removed and the site ready.
	FinishCrawl(ctx context.Context, userID, siteID uuid.UUID, at time.Time) (int, error)
	SettleSite(ctx context.Context, userID, siteID uuid.UUID, status, reason string) error
	DueSites(ctx context.Context, before time.Time, limit int) ([]Site, error)

	CreateRepo(ctx context.Context, r Repo) (*Repo, error)
	GetRepo(ctx context.Context, userID, repoID uuid.UUID) (*Repo, error)
	ListRepos(ctx context.Context, userID, kbID uuid.UUID) ([]Repo, error)
	DeleteRepo(ctx context.Context, userID, repoID uuid.UUID) error
	QueueRepoSync(ctx context.Context, userID, repoID, jobID uuid.UUID) error
	BeginRepoSync(ctx context.Context, userID, repoID uuid.UUID) error
	FinishRepoSync(ctx context.Context, userID, repoID uuid.UUID, branch, sha, note string, at time.Time) error
	SettleRepo(ctx context.Context, userID, repoID uuid.UUID, reason string) error
	DueRepos(ctx context.Context, before time.Time, limit int) ([]Repo, error)

	// GroupDocuments are a site's or a repository's documents.
	GroupDocuments(ctx context.Context, userID uuid.UUID, siteID, repoID *uuid.UUID) ([]Document, error)
	SetRemoved(ctx context.Context, userID, docID uuid.UUID, at *time.Time) error
}

// GitHubTokens reads the learner's own GitHub token ("" when they have none).
// Wired to byok in internal/app; this package never stores one.
type GitHubTokens interface {
	GitHubToken(ctx context.Context, userID uuid.UUID) (string, error)
}

// Canceller asks a job to stop (jobs.Queue.RequestCancel).
type Canceller interface {
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
}

// SourceConfig turns sites and repositories on. It needs Links as well:
// pages and files are stored through the link store.
type SourceConfig struct {
	Store SourceStore
	// Fetch is security.FetchClient in production, as for links.
	Fetch   *http.Client
	GitHub  *github.Client
	Tokens  GitHubTokens
	Cancel  Canceller
	Limiter *crawl.Limiter
}

// ErrDuplicateSource is a site (same start URL) or repository (same
// repository, branch and folder) already in the knowledge base.
var ErrDuplicateSource = errors.New("this source is already in this knowledge base")

// ErrSourcesUnavailable is returned when sources are not wired.
var ErrSourcesUnavailable = errors.New("knowledge: sites and repositories are not configured")

func (s *Service) sourceDeps() (*SourceConfig, error) {
	if s.sources == nil || s.sources.Store == nil || s.links == nil || s.links.Store == nil {
		return nil, ErrSourcesUnavailable
	}
	return s.sources, nil
}

// ───────────────────────────────────────────────────────── shared reads

// ListSites are a knowledge base's sites with their progress.
func (s *Service) ListSites(ctx context.Context, userID, kbID uuid.UUID) ([]Site, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, err
	}
	return deps.Store.ListSites(ctx, userID, kbID)
}

// GetSite is one site with its pages.
func (s *Service) GetSite(ctx context.Context, userID, siteID uuid.UUID) (*Site, []SitePage, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, nil, err
	}
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		return nil, nil, err
	}
	pages, err := deps.Store.SitePages(ctx, userID, siteID)
	if err != nil {
		return nil, nil, err
	}
	return site, pages, nil
}

// ListRepos are a knowledge base's repositories.
func (s *Service) ListRepos(ctx context.Context, userID, kbID uuid.UUID) ([]Repo, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, err
	}
	return deps.Store.ListRepos(ctx, userID, kbID)
}

// GetRepo is one repository with its files.
func (s *Service) GetRepo(ctx context.Context, userID, repoID uuid.UUID) (*Repo, []Document, error) {
	deps, err := s.sourceDeps()
	if err != nil {
		return nil, nil, err
	}
	repo, err := deps.Store.GetRepo(ctx, userID, repoID)
	if err != nil {
		return nil, nil, err
	}
	docs, err := deps.Store.GroupDocuments(ctx, userID, nil, &repoID)
	if err != nil {
		return nil, nil, err
	}
	return repo, docs, nil
}

// DeleteSite removes a site and its documents, with their files. A crawl in
// flight is asked to stop; its next unit finds the site gone.
func (s *Service) DeleteSite(ctx context.Context, userID, siteID uuid.UUID) error {
	deps, err := s.sourceDeps()
	if err != nil {
		return err
	}
	site, err := deps.Store.GetSite(ctx, userID, siteID)
	if err != nil {
		return err
	}
	return s.deleteGroup(ctx, userID, site.JobID, &siteID, nil, func() error {
		return deps.Store.DeleteSite(ctx, userID, siteID)
	})
}

// DeleteRepo removes a repository and its documents, with their files.
func (s *Service) DeleteRepo(ctx context.Context, userID, repoID uuid.UUID) error {
	deps, err := s.sourceDeps()
	if err != nil {
		return err
	}
	repo, err := deps.Store.GetRepo(ctx, userID, repoID)
	if err != nil {
		return err
	}
	return s.deleteGroup(ctx, userID, repo.JobID, nil, &repoID, func() error {
		return deps.Store.DeleteRepo(ctx, userID, repoID)
	})
}

func (s *Service) deleteGroup(ctx context.Context, userID uuid.UUID, jobID, siteID, repoID *uuid.UUID, del func() error) error {
	if jobID != nil && s.sources.Cancel != nil {
		_, _ = s.sources.Cancel.RequestCancel(ctx, userID, *jobID)
	}
	docs, err := s.sources.Store.GroupDocuments(ctx, userID, siteID, repoID)
	if err != nil {
		return err
	}
	// The documents go with the group by cascade; their files are removed
	// after, as DeleteKB does.
	if err := del(); err != nil {
		return err
	}
	for _, d := range docs {
		s.deleteFiles(ctx, userID, d.ID, d.SHA256)
	}
	return nil
}

// ───────────────────────────────────────────────────── weekly re-sync

// SourceSyncReport is one pass of the weekly re-sync.
type SourceSyncReport struct {
	Sites, Repos, Failed int
}

// SyncDueSources queues a re-sync of every site and repository last synced
// a week ago or more, across users. Each one is queued on its own; an error
// on one is logged and the pass goes on. Only a failure to LIST ends it.
func (s *Service) SyncDueSources(ctx context.Context) (SourceSyncReport, error) {
	var rep SourceSyncReport
	deps, err := s.sourceDeps()
	if err != nil {
		return rep, err
	}
	// An hour's slack, so an hourly ticker does not drift a week's sync.
	before := s.now().Add(-ResyncEvery + time.Hour)
	sites, err := deps.Store.DueSites(ctx, before, 100)
	if err != nil {
		return rep, err
	}
	for _, site := range sites {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		if _, err := s.queueCrawl(ctx, site.UserID, site.ID); err != nil {
			rep.Failed++
			slog.Info("knowledge: weekly site re-sync not queued", "site", site.ID, "error", err)
			continue
		}
		rep.Sites++
	}
	repos, err := deps.Store.DueRepos(ctx, before, 100)
	if err != nil {
		return rep, err
	}
	for _, repo := range repos {
		if ctx.Err() != nil {
			return rep, ctx.Err()
		}
		if _, err := s.queueRepoSync(ctx, repo.UserID, repo.ID); err != nil {
			rep.Failed++
			slog.Info("knowledge: weekly repository re-sync not queued", "repo", repo.ID, "error", err)
			continue
		}
		rep.Repos++
	}
	return rep, nil
}
