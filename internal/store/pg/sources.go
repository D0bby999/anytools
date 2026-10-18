package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// sources.go — documentation sites, GitHub repositories and the crawl
// frontier (up-methods phase 18).
//
// Every statement carries `user_id = $n`, except DueSites and DueRepos, the
// weekly re-sync's cross-user scans, only ever called under its advisory
// lock. A row of another user answers authz.ErrNoAccess, exactly like a
// missing one.

// SourceStore persists sites and repositories.
type SourceStore struct{ pool *Pool }

// NewSourceStore returns a SourceStore.
func NewSourceStore(pool *Pool) *SourceStore { return &SourceStore{pool: pool} }

var _ knowledge.SourceStore = (*SourceStore)(nil)

func duplicateSource(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" &&
		(pgErr.ConstraintName == "sites_kb_start_unique" || pgErr.ConstraintName == "repos_kb_source_unique") {
		return knowledge.ErrDuplicateSource
	}
	return err
}

// ─────────────────────────────────────────────────────────────── sites

const siteColumns = `s.id, s.user_id, s.kb_id, s.start_url, s.path_prefix, s.max_depth, s.max_pages,
       s.title, s.status, s.error, s.job_id, s.generation, s.last_crawled_at, s.created_at, s.updated_at,
       s.robots_txt,
       (SELECT count(*) FROM site_pages p WHERE p.site_id = s.id AND p.user_id = s.user_id AND p.crawl_ord IS NOT NULL),
       (SELECT count(*) FROM site_pages p WHERE p.site_id = s.id AND p.user_id = s.user_id AND p.crawl_ord IS NOT NULL AND p.status <> 'pending'),
       (SELECT count(*) FROM documents d WHERE d.site_id = s.id AND d.user_id = s.user_id),
       (SELECT count(*) FROM documents d WHERE d.site_id = s.id AND d.user_id = s.user_id AND d.removed_at IS NOT NULL)`

func scanSite(row pgx.Row) (*knowledge.Site, error) {
	var s knowledge.Site
	var depth, pages int16
	err := row.Scan(&s.ID, &s.UserID, &s.KBID, &s.StartURL, &s.PathPrefix, &depth, &pages,
		&s.Title, &s.Status, &s.Error, &s.JobID, &s.Generation, &s.LastCrawledAt, &s.CreatedAt, &s.UpdatedAt,
		&s.RobotsTxt, &s.Found, &s.Done, &s.Documents, &s.Removed)
	s.MaxDepth, s.MaxPages = int(depth), int(pages)
	return &s, err
}

// CreateSite inserts a site in status queued, with no job yet.
func (st *SourceStore) CreateSite(ctx context.Context, s knowledge.Site) (*knowledge.Site, error) {
	var id uuid.UUID
	err := st.pool.QueryRow(ctx, `
        INSERT INTO sites (user_id, kb_id, start_url, path_prefix, max_depth, max_pages, title)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
		s.UserID, s.KBID, s.StartURL, s.PathPrefix, s.MaxDepth, s.MaxPages, truncateRunes(s.Title, 300)).Scan(&id)
	if err != nil {
		return nil, duplicateSource(fmt.Errorf("pg: create site: %w", err))
	}
	return st.GetSite(ctx, s.UserID, id)
}

// GetSite reads one site.
func (st *SourceStore) GetSite(ctx context.Context, userID, siteID uuid.UUID) (*knowledge.Site, error) {
	s, err := scanSite(st.pool.QueryRow(ctx, `SELECT `+siteColumns+` FROM sites s WHERE s.id = $1 AND s.user_id = $2`, siteID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get site: %w", err)
	}
	return s, nil
}

// ListSites are a knowledge base's sites, newest first.
func (st *SourceStore) ListSites(ctx context.Context, userID, kbID uuid.UUID) ([]knowledge.Site, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+siteColumns+` FROM sites s
        WHERE s.user_id = $1 AND s.kb_id = $2 ORDER BY s.created_at DESC LIMIT 200`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("pg: list sites: %w", err)
	}
	defer rows.Close()
	out := []knowledge.Site{}
	for rows.Next() {
		s, err := scanSite(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: list sites: %w", err)
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// SitePages are a site's pages in crawl order, then the ones the current
// crawl has not reached; at most 400 (a crawl holds 200).
func (st *SourceStore) SitePages(ctx context.Context, userID, siteID uuid.UUID) ([]knowledge.SitePage, error) {
	rows, err := st.pool.Query(ctx, `
        SELECT p.url, p.depth, p.crawl_ord, p.status, p.reason, p.document_id,
               COALESCE(d.title, ''), COALESCE(d.status, ''), d.removed_at
          FROM site_pages p
          LEFT JOIN documents d ON d.id = p.document_id AND d.user_id = p.user_id
         WHERE p.site_id = $1 AND p.user_id = $2
         ORDER BY p.crawl_ord NULLS LAST, p.url
         LIMIT 400`, siteID, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: site pages: %w", err)
	}
	defer rows.Close()
	out := []knowledge.SitePage{}
	for rows.Next() {
		var p knowledge.SitePage
		var depth int16
		var ord *int16
		if err := rows.Scan(&p.URL, &depth, &ord, &p.Status, &p.Reason, &p.DocumentID,
			&p.Title, &p.DocStatus, &p.RemovedAt); err != nil {
			return nil, fmt.Errorf("pg: site pages: %w", err)
		}
		p.Depth = int(depth)
		if ord != nil {
			n := int(*ord)
			p.Ord = &n
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// DeleteSite removes a site; its pages and documents go by cascade.
func (st *SourceStore) DeleteSite(ctx context.Context, userID, siteID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `DELETE FROM sites WHERE id = $1 AND user_id = $2`, siteID, userID)
	if err != nil {
		return fmt.Errorf("pg: delete site: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// QueueSiteCrawl hands a resting site (or a new one) to a crawl job.
func (st *SourceStore) QueueSiteCrawl(ctx context.Context, userID, siteID, jobID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `
        UPDATE sites SET status = 'queued', error = '', job_id = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
           AND (status IN ('ready', 'failed', 'cancelled') OR (status = 'queued' AND job_id IS NULL))`,
		siteID, userID, jobID)
	if err != nil {
		return fmt.Errorf("pg: queue crawl: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return st.siteRefused(ctx, userID, siteID)
	}
	return nil
}

func (st *SourceStore) siteRefused(ctx context.Context, userID, siteID uuid.UUID) error {
	var one int
	err := st.pool.QueryRow(ctx, `SELECT 1 FROM sites WHERE id = $1 AND user_id = $2`, siteID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return authz.ErrNoAccess
	}
	if err != nil {
		return err
	}
	return knowledge.ErrDocumentFinal
}

// BeginCrawl starts a generation. Pages without a document are forgotten;
// pages with one keep it, leave the frontier (crawl_ord NULL) and come back
// when this generation reaches them again.
func (st *SourceStore) BeginCrawl(ctx context.Context, userID, siteID uuid.UUID, robots *string) error {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // committed below

	var startURL string
	err = tx.QueryRow(ctx, `
        UPDATE sites SET status = 'crawling', robots_txt = $3, generation = generation + 1,
                         error = '', updated_at = now()
         WHERE id = $1 AND user_id = $2 AND status = 'queued'
        RETURNING start_url`, siteID, userID, robots).Scan(&startURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return st.siteRefused(ctx, userID, siteID)
	}
	if err != nil {
		return fmt.Errorf("pg: begin crawl: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM site_pages WHERE site_id = $1 AND user_id = $2 AND document_id IS NULL`,
		siteID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE site_pages SET crawl_ord = NULL, status = 'pending', reason = '', updated_at = now()
         WHERE site_id = $1 AND user_id = $2`, siteID, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
        INSERT INTO site_pages (site_id, user_id, url, depth, crawl_ord) VALUES ($1, $2, $3, 0, 0)
        ON CONFLICT (site_id, url) DO UPDATE SET depth = 0, crawl_ord = 0, status = 'pending', reason = ''`,
		siteID, userID, startURL); err != nil {
		return fmt.Errorf("pg: begin crawl: %w", err)
	}
	return tx.Commit(ctx)
}

// CrawlTotal counts the current generation's frontier.
func (st *SourceStore) CrawlTotal(ctx context.Context, userID, siteID uuid.UUID) (int, error) {
	var n int
	err := st.pool.QueryRow(ctx, `SELECT count(*) FROM site_pages
        WHERE site_id = $1 AND user_id = $2 AND crawl_ord IS NOT NULL`, siteID, userID).Scan(&n)
	return n, err
}

// PageAt is the frontier's page at ord, or nil.
func (st *SourceStore) PageAt(ctx context.Context, userID, siteID uuid.UUID, ord int) (*knowledge.SitePage, error) {
	var p knowledge.SitePage
	var depth int16
	err := st.pool.QueryRow(ctx, `
        SELECT url, depth, status, reason, document_id FROM site_pages
         WHERE site_id = $1 AND user_id = $2 AND crawl_ord = $3`, siteID, userID, ord).
		Scan(&p.URL, &depth, &p.Status, &p.Reason, &p.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("pg: page at: %w", err)
	}
	p.Depth = int(depth)
	p.Ord = &ord
	return &p, nil
}

// AddFrontier appends urls at the next free ords, until the frontier holds
// maxPages. A URL already in this generation keeps its place; one known from
// an earlier generation rejoins. Serialised on the site row.
func (st *SourceStore) AddFrontier(ctx context.Context, userID, siteID uuid.UUID, urls []string, depth, maxPages int) (int, error) {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // committed below

	var one int
	if err := tx.QueryRow(ctx, `SELECT 1 FROM sites WHERE id = $1 AND user_id = $2 FOR UPDATE`, siteID, userID).Scan(&one); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, authz.ErrNoAccess
		}
		return 0, err
	}
	var next int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(max(crawl_ord) + 1, 0) FROM site_pages
        WHERE site_id = $1 AND user_id = $2`, siteID, userID).Scan(&next); err != nil {
		return 0, err
	}
	added := 0
	for _, u := range urls {
		if next >= maxPages {
			break
		}
		tag, err := tx.Exec(ctx, `
            INSERT INTO site_pages (site_id, user_id, url, depth, crawl_ord) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (site_id, url) DO UPDATE
               SET depth = EXCLUDED.depth, crawl_ord = EXCLUDED.crawl_ord, status = 'pending', reason = '',
                   updated_at = now()
             WHERE site_pages.crawl_ord IS NULL`,
			siteID, userID, u, depth, next)
		if err != nil {
			return 0, fmt.Errorf("pg: add frontier: %w", err)
		}
		if tag.RowsAffected() == 1 {
			next++
			added++
		}
	}
	return added, tx.Commit(ctx)
}

// SetPageResult records what a crawl did with one page.
func (st *SourceStore) SetPageResult(ctx context.Context, userID, siteID uuid.UUID, url, status, reason string, docID *uuid.UUID) error {
	_, err := st.pool.Exec(ctx, `
        UPDATE site_pages SET status = $4, reason = $5, document_id = COALESCE($6, document_id), updated_at = now()
         WHERE site_id = $1 AND user_id = $2 AND url = $3`,
		siteID, userID, url, status, truncateRunes(reason, 300), docID)
	if err != nil {
		return fmt.Errorf("pg: page result: %w", err)
	}
	return nil
}

// SetSiteTitle names a site after its start page.
func (st *SourceStore) SetSiteTitle(ctx context.Context, userID, siteID uuid.UUID, title string) error {
	_, err := st.pool.Exec(ctx, `UPDATE sites SET title = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
		siteID, userID, truncateRunes(title, 300))
	return err
}

// FinishCrawl ends a generation: every document of a page it did not reach
// is marked removed (never deleted), and the site is ready.
func (st *SourceStore) FinishCrawl(ctx context.Context, userID, siteID uuid.UUID, at time.Time) (int, error) {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // committed below

	tag, err := tx.Exec(ctx, `
        UPDATE documents d SET removed_at = $3, updated_at = now()
          FROM site_pages p
         WHERE p.site_id = $1 AND p.user_id = $2 AND p.crawl_ord IS NULL AND p.document_id = d.id
           AND d.user_id = $2 AND d.removed_at IS NULL`, siteID, userID, at)
	if err != nil {
		return 0, fmt.Errorf("pg: finish crawl: %w", err)
	}
	if _, err := tx.Exec(ctx, `
        UPDATE site_pages SET status = 'removed', reason = 'no longer linked from the site', updated_at = now()
         WHERE site_id = $1 AND user_id = $2 AND crawl_ord IS NULL`, siteID, userID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
        UPDATE sites SET status = 'ready', error = '', last_crawled_at = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2`, siteID, userID, at); err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), tx.Commit(ctx)
}

// SettleSite ends a crawl that will not finish: failed or cancelled. The
// time is recorded, so a site that fails is retried a week later rather
// than every hour.
func (st *SourceStore) SettleSite(ctx context.Context, userID, siteID uuid.UUID, status, reason string) error {
	if status == knowledge.SiteFailed && reason == "" {
		reason = "the crawl failed"
	}
	_, err := st.pool.Exec(ctx, `
        UPDATE sites SET status = $3, error = $4, last_crawled_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2`, siteID, userID, status, truncateRunes(reason, 500))
	return err
}

// DueSites are resting sites last crawled before the cutoff, across users.
func (st *SourceStore) DueSites(ctx context.Context, before time.Time, limit int) ([]knowledge.Site, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+siteColumns+` FROM sites s
        WHERE s.status IN ('ready', 'failed') AND s.last_crawled_at < $1
        ORDER BY s.last_crawled_at LIMIT $2`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("pg: due sites: %w", err)
	}
	defer rows.Close()
	var out []knowledge.Site
	for rows.Next() {
		s, err := scanSite(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────── repositories

const repoColumns = `r.id, r.user_id, r.kb_id, r.owner, r.name, r.branch, r.resolved_branch, r.path_prefix,
       r.extensions, r.ignore_paths, r.status, r.error, r.note, r.job_id, r.commit_sha,
       (SELECT count(*) FROM documents d WHERE d.repo_id = r.id AND d.user_id = r.user_id AND d.removed_at IS NULL),
       r.last_synced_at, r.created_at, r.updated_at,
       (SELECT count(*) FROM documents d WHERE d.repo_id = r.id AND d.user_id = r.user_id AND d.removed_at IS NOT NULL)`

func scanRepo(row pgx.Row) (*knowledge.Repo, error) {
	var r knowledge.Repo
	err := row.Scan(&r.ID, &r.UserID, &r.KBID, &r.Owner, &r.Name, &r.Branch, &r.ResolvedBranch, &r.PathPrefix,
		&r.Extensions, &r.IgnorePaths, &r.Status, &r.Error, &r.Note, &r.JobID, &r.CommitSHA,
		&r.FileCount, &r.LastSyncedAt, &r.CreatedAt, &r.UpdatedAt, &r.Removed)
	return &r, err
}

// CreateRepo inserts a repository in status queued, with no job yet.
func (st *SourceStore) CreateRepo(ctx context.Context, r knowledge.Repo) (*knowledge.Repo, error) {
	var id uuid.UUID
	err := st.pool.QueryRow(ctx, `
        INSERT INTO repos (user_id, kb_id, owner, name, branch, path_prefix, extensions, ignore_paths)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
		r.UserID, r.KBID, r.Owner, r.Name, r.Branch, r.PathPrefix, r.Extensions, r.IgnorePaths).Scan(&id)
	if err != nil {
		return nil, duplicateSource(fmt.Errorf("pg: create repo: %w", err))
	}
	return st.GetRepo(ctx, r.UserID, id)
}

// GetRepo reads one repository.
func (st *SourceStore) GetRepo(ctx context.Context, userID, repoID uuid.UUID) (*knowledge.Repo, error) {
	r, err := scanRepo(st.pool.QueryRow(ctx, `SELECT `+repoColumns+` FROM repos r WHERE r.id = $1 AND r.user_id = $2`, repoID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get repo: %w", err)
	}
	return r, nil
}

// ListRepos are a knowledge base's repositories, newest first.
func (st *SourceStore) ListRepos(ctx context.Context, userID, kbID uuid.UUID) ([]knowledge.Repo, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+repoColumns+` FROM repos r
        WHERE r.user_id = $1 AND r.kb_id = $2 ORDER BY r.created_at DESC LIMIT 200`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("pg: list repos: %w", err)
	}
	defer rows.Close()
	out := []knowledge.Repo{}
	for rows.Next() {
		r, err := scanRepo(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: list repos: %w", err)
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// DeleteRepo removes a repository; its documents go by cascade.
func (st *SourceStore) DeleteRepo(ctx context.Context, userID, repoID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `DELETE FROM repos WHERE id = $1 AND user_id = $2`, repoID, userID)
	if err != nil {
		return fmt.Errorf("pg: delete repo: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// QueueRepoSync hands a resting repository (or a new one) to a sync job.
func (st *SourceStore) QueueRepoSync(ctx context.Context, userID, repoID, jobID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `
        UPDATE repos SET status = 'queued', error = '', job_id = $3, updated_at = now()
         WHERE id = $1 AND user_id = $2
           AND (status IN ('ready', 'failed') OR (status = 'queued' AND job_id IS NULL))`,
		repoID, userID, jobID)
	if err != nil {
		return fmt.Errorf("pg: queue repo sync: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var one int
		err := st.pool.QueryRow(ctx, `SELECT 1 FROM repos WHERE id = $1 AND user_id = $2`, repoID, userID).Scan(&one)
		if errors.Is(err, pgx.ErrNoRows) {
			return authz.ErrNoAccess
		}
		return knowledge.ErrDocumentFinal
	}
	return nil
}

// BeginRepoSync marks a sync as running.
func (st *SourceStore) BeginRepoSync(ctx context.Context, userID, repoID uuid.UUID) error {
	_, err := st.pool.Exec(ctx, `UPDATE repos SET status = 'syncing', updated_at = now()
        WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'syncing')`, repoID, userID)
	return err
}

// FinishRepoSync records the commit the documents now reflect.
func (st *SourceStore) FinishRepoSync(ctx context.Context, userID, repoID uuid.UUID, branch, sha, note string, at time.Time) error {
	_, err := st.pool.Exec(ctx, `
        UPDATE repos SET status = 'ready', error = '', resolved_branch = $3, commit_sha = $4, note = $5,
                         last_synced_at = $6, updated_at = now()
         WHERE id = $1 AND user_id = $2`, repoID, userID, truncateRunes(branch, 255), sha, truncateRunes(note, 500), at)
	return err
}

// SettleRepo fails a sync that will not finish. The commit is left alone,
// so the next sync tries again in full.
func (st *SourceStore) SettleRepo(ctx context.Context, userID, repoID uuid.UUID, reason string) error {
	if reason == "" {
		reason = "the sync failed"
	}
	_, err := st.pool.Exec(ctx, `
        UPDATE repos SET status = 'failed', error = $3, last_synced_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2`, repoID, userID, truncateRunes(reason, 500))
	return err
}

// DueRepos are resting repositories last synced before the cutoff, across users.
func (st *SourceStore) DueRepos(ctx context.Context, before time.Time, limit int) ([]knowledge.Repo, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+repoColumns+` FROM repos r
        WHERE r.status IN ('ready', 'failed') AND r.last_synced_at < $1
        ORDER BY r.last_synced_at LIMIT $2`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("pg: due repos: %w", err)
	}
	defer rows.Close()
	var out []knowledge.Repo
	for rows.Next() {
		r, err := scanRepo(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// ───────────────────────────────────────────────────── grouped documents

// GroupDocuments are a site's or a repository's documents (bounded by the
// crawl and file caps).
func (st *SourceStore) GroupDocuments(ctx context.Context, userID uuid.UUID, siteID, repoID *uuid.UUID) ([]knowledge.Document, error) {
	where, arg := "site_id = $2", any(siteID)
	if repoID != nil {
		where, arg = "repo_id = $2", any(repoID)
	}
	rows, err := st.pool.Query(ctx, `SELECT `+documentColumns("")+` FROM documents
        WHERE user_id = $1 AND `+where+` ORDER BY source_path, source_url LIMIT 5000`, userID, arg)
	if err != nil {
		return nil, fmt.Errorf("pg: group documents: %w", err)
	}
	defer rows.Close()
	out := []knowledge.Document{}
	for rows.Next() {
		var d scannedDocument
		if err := rows.Scan(documentTargets(&d)...); err != nil {
			return nil, fmt.Errorf("pg: group documents: %w", err)
		}
		if err := d.decodeLinkFields(); err != nil {
			return nil, err
		}
		out = append(out, d.Document)
	}
	return out, rows.Err()
}

// SetRemoved marks (or, with nil, unmarks) a page or file as gone from its
// site or repository.
func (st *SourceStore) SetRemoved(ctx context.Context, userID, docID uuid.UUID, at *time.Time) error {
	_, err := st.pool.Exec(ctx, `UPDATE documents SET removed_at = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind IN ('site_page', 'repo_file')`, docID, userID, at)
	return err
}

func truncateRunes(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

// SourceReapHandler settles a site or repository whose crawl or sync job gave
// up, in the job's final transaction: without it, a job out of attempts
// leaves its site "crawling" forever and no re-sync could be queued again.
// Only the job the row names is settled; a newer one is left alone.
func SourceReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if !job.Terminal || (job.Kind != knowledge.JobCrawlSite && job.Kind != knowledge.JobSyncRepo) {
			return nil
		}
		var p knowledge.SourceJobPayload
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return nil
		}
		if job.Kind == knowledge.JobCrawlSite {
			_, err := tx.Exec(ctx, `
                UPDATE sites SET status = 'failed', error = 'the crawl stopped before it finished. Try a re-sync.',
                                 last_crawled_at = now(), updated_at = now()
                 WHERE id = $1 AND user_id = $2 AND job_id = $3 AND status IN ('queued', 'crawling')`,
				p.SiteID, job.UserID, job.ID)
			return err
		}
		_, err := tx.Exec(ctx, `
            UPDATE repos SET status = 'failed', error = 'the sync stopped before it finished. Try a re-sync.',
                             last_synced_at = now(), updated_at = now()
             WHERE id = $1 AND user_id = $2 AND job_id = $3 AND status IN ('queued', 'syncing')`,
			p.RepoID, job.UserID, job.ID)
		return err
	}
}
