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

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// knowledge_links.go — web and YouTube documents (learning-depth phase 4).
//
// The same rule as knowledge.go: every statement carries `user_id = $n`, except
// DueWebSyncs, which is the sync job's cross-user scan and is only ever called
// under the job's advisory lock.

var _ knowledge.LinkStore = (*KnowledgeStore)(nil)

// documentColumns is every documents column a Document is read with, in
// documentTargets order. One list, so a column added for links cannot be
// read by GetDocument and forgotten by ListDocuments.
func documentColumns(prefix string) string {
	cols := []string{"id", "user_id", "kb_id", "source_kind", "title", "mime", "bytes", "sha256",
		"page_count", "status", "error", "processed_by", "version", "parsed_markdown_path",
		"created_at", "updated_at", "source_url", "auto_sync", "last_synced_at", "sync_error",
		"sync_changes", "timeline", "media_id", "media", "transcript_source",
		"site_id", "repo_id", "source_path", "removed_at", "page_unit",
		"media_sha256", "media_mime", "media_bytes"}
	for i, c := range cols {
		cols[i] = prefix + c
	}
	return strings.Join(cols, ", ")
}

// scannedDocument holds the jsonb and nullable columns until they are decoded.
type scannedDocument struct {
	knowledge.Document
	timeline         []byte
	media            []byte
	transcriptSource *string
}

func documentTargets(d *scannedDocument) []any {
	return []any{&d.ID, &d.UserID, &d.KBID, &d.SourceKind, &d.Title, &d.MIME, &d.Bytes, &d.SHA256,
		&d.PageCount, &d.Status, &d.Error, &d.ProcessedBy, &d.Version, &d.ParsedMarkdownPath,
		&d.CreatedAt, &d.UpdatedAt, &d.SourceURL, &d.AutoSync, &d.LastSyncedAt, &d.SyncError,
		&d.SyncChanges, &d.timeline, &d.MediaID, &d.media, &d.transcriptSource,
		&d.SiteID, &d.RepoID, &d.SourcePath, &d.RemovedAt, &d.PageUnit,
		&d.MediaSHA256, &d.MediaMIME, &d.MediaBytes}
}

func (d *scannedDocument) decodeLinkFields() error {
	// Every scanned document passes here, so this is where a failed parse's
	// stored sentence gets its code back (drive-user-storage phase 4).
	if reason, ok := blob.ReasonOf(d.Error); ok && d.Status == knowledge.StatusFailed {
		d.ErrorCode = reason.Code
	}
	if len(d.timeline) > 0 && string(d.timeline) != "null" {
		if err := json.Unmarshal(d.timeline, &d.Timeline); err != nil {
			return fmt.Errorf("pg: document timeline: %w", err)
		}
	}
	if d.Timed() {
		var m knowledge.VideoMedia
		if len(d.media) > 0 {
			if err := json.Unmarshal(d.media, &m); err != nil {
				return fmt.Errorf("pg: document media: %w", err)
			}
		}
		d.Media = &m
	}
	if d.transcriptSource != nil {
		d.TranscriptSource = *d.transcriptSource
	}
	return nil
}

func nullableJSON(v any, isNil bool) ([]byte, error) {
	if isNil {
		return nil, nil
	}
	return json.Marshal(v)
}

func nullableText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// lockAutoSync serialises auto-sync changes for one user inside tx, so two
// concurrent requests cannot both see 19 and both turn on the 20th and 21st.
func lockAutoSync(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (int, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`,
		jobs.AdvisoryKey("auto-sync:"+userID.String())); err != nil {
		return 0, err
	}
	var n int
	err := tx.QueryRow(ctx,
		`SELECT count(*) FROM documents WHERE user_id = $1 AND auto_sync`, userID).Scan(&n)
	return n, err
}

// CreateLinkDocument inserts a web, youtube or media document in the status
// the caller chose (queued, or needs_transcript for a video without captions
// or an uploaded recording).
func (s *KnowledgeStore) CreateLinkDocument(ctx context.Context, d knowledge.Document) (*knowledge.Document, error) {
	timeline, err := nullableJSON(d.Timeline, d.Timeline == nil)
	if err != nil {
		return nil, err
	}
	media := []byte("{}")
	if d.Media != nil {
		if media, err = json.Marshal(d.Media); err != nil {
			return nil, err
		}
	}
	pb := d.ProcessedBy
	if len(pb) == 0 {
		pb = json.RawMessage("{}")
	}
	status := d.Status
	if status == "" {
		status = knowledge.StatusQueued
	}
	unit := d.PageUnit
	if unit == "" {
		unit = knowledge.PageUnitPage
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // committed below

	if d.AutoSync {
		n, err := lockAutoSync(ctx, tx, d.UserID)
		if err != nil {
			return nil, fmt.Errorf("pg: auto-sync count: %w", err)
		}
		if n >= knowledge.MaxAutoSyncLinks {
			return nil, knowledge.ErrAutoSyncLimit
		}
	}

	var out scannedDocument
	err = tx.QueryRow(ctx, `
        INSERT INTO documents
            (user_id, kb_id, source_kind, title, mime, bytes, sha256, page_count, status, error,
             processed_by, source_url, auto_sync, last_synced_at, timeline, media_id, media, transcript_source,
             site_id, repo_id, source_path, page_unit, media_sha256, media_mime, media_bytes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21, $22, $23, $24, $25)
        RETURNING `+documentColumns(""),
		d.UserID, d.KBID, d.SourceKind, d.Title, d.MIME, d.Bytes, d.SHA256, d.PageCount, status, d.Error,
		pb, d.SourceURL, d.AutoSync, d.LastSyncedAt, timeline, d.MediaID, media,
		nullableText(d.TranscriptSource), d.SiteID, d.RepoID, d.SourcePath, unit,
		d.MediaSHA256, d.MediaMIME, d.MediaBytes).
		Scan(documentTargets(&out)...)
	if err != nil {
		return nil, fmt.Errorf("pg: create link document: %w", err)
	}
	if err := out.decodeLinkFields(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out.Document, nil
}

// SetAutoSync turns a web document's daily re-sync on or off.
func (s *KnowledgeStore) SetAutoSync(ctx context.Context, userID, docID uuid.UUID, on bool) (*knowledge.Document, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // committed below

	if on {
		n, err := lockAutoSync(ctx, tx, userID)
		if err != nil {
			return nil, fmt.Errorf("pg: auto-sync count: %w", err)
		}
		var already bool
		err = tx.QueryRow(ctx, `SELECT auto_sync FROM documents WHERE id = $1 AND user_id = $2`,
			docID, userID).Scan(&already)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, authz.ErrNoAccess
		}
		if err != nil {
			return nil, err
		}
		if !already && n >= knowledge.MaxAutoSyncLinks {
			return nil, knowledge.ErrAutoSyncLimit
		}
	}

	var out scannedDocument
	err = tx.QueryRow(ctx, `
        UPDATE documents SET auto_sync = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind = 'web'
        RETURNING `+documentColumns(""), docID, userID, on).Scan(documentTargets(&out)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: set auto sync: %w", err)
	}
	if err := out.decodeLinkFields(); err != nil {
		return nil, err
	}
	return &out.Document, tx.Commit(ctx)
}

// ReplaceLinkContent writes a link's new content and puts it back on the
// queue: new bytes and digest, a new version when a parsed copy already
// exists (blob.PutParsed writes `<doc>-v<version>.md`, so the viewer keeps
// serving the old copy until the new one is complete), status `queued`.
//
// Like ResetDocumentForReprocessing it leaves a resting state on purpose, and
// only from the statuses the caller names, so a request cannot yank a
// document out from under a running parse.
func (s *KnowledgeStore) ReplaceLinkContent(ctx context.Context, userID, docID uuid.UUID, c knowledge.LinkContent) (*knowledge.Document, error) {
	timeline, err := nullableJSON(c.Timeline, c.Timeline == nil)
	if err != nil {
		return nil, err
	}
	var media []byte
	if c.Media != nil {
		if media, err = json.Marshal(c.Media); err != nil {
			return nil, err
		}
	}
	pb, err := json.Marshal(c.ProcessedBy)
	if err != nil {
		return nil, err
	}
	from := c.From
	if len(from) == 0 {
		from = []string{knowledge.StatusReady, knowledge.StatusFailed, knowledge.StatusNeedsTranscript}
	}

	var out scannedDocument
	err = s.pool.QueryRow(ctx, `
        UPDATE documents SET
            title             = COALESCE(NULLIF($3, ''), title),
            mime              = $4,
            bytes             = $5,
            sha256            = $6,
            page_count        = $7,
            timeline          = $8,
            transcript_source = COALESCE($9, transcript_source),
            media             = COALESCE($10, media),
            processed_by      = $11,
            status            = 'queued',
            error             = '',
            removed_at        = NULL,
            version           = CASE WHEN parsed_markdown_path = '' THEN version ELSE version + 1 END,
            updated_at        = now()
        WHERE id = $1 AND user_id = $2 AND status = ANY($12)
        RETURNING `+documentColumns(""),
		docID, userID, c.Title, c.MIME, c.Bytes, c.SHA256, c.PageCount, timeline,
		nullableText(c.TranscriptSource), media, pb, from).
		Scan(documentTargets(&out)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, s.refusedOrNoAccess(ctx, userID, docID)
	}
	if err != nil {
		return nil, fmt.Errorf("pg: replace link content: %w", err)
	}
	if err := out.decodeLinkFields(); err != nil {
		return nil, err
	}
	return &out.Document, nil
}

// SetVideoMedia records what the server learned about a video (duration,
// tracks, why captions failed) without touching its status.
func (s *KnowledgeStore) SetVideoMedia(ctx context.Context, userID, docID uuid.UUID, m knowledge.VideoMedia) error {
	raw, err := json.Marshal(m)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET media = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind IN ('youtube', 'media')`, docID, userID, raw)
	if err != nil {
		return fmt.Errorf("pg: set video media: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// RecordSync writes one sync's outcome on its own row: a changed page counts
// toward the weekly back-off, an unchanged one resets it, and a failure keeps
// the count and says why.
func (s *KnowledgeStore) RecordSync(ctx context.Context, userID, docID uuid.UUID, r knowledge.SyncResult) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE documents SET
            last_synced_at = $3,
            sync_error     = $4,
            sync_changes   = CASE WHEN $4 <> '' THEN sync_changes
                                  WHEN $5 THEN LEAST(sync_changes + 1, 1000)
                                  ELSE 0 END
        WHERE id = $1 AND user_id = $2`, docID, userID, r.At, r.Err, r.Changed)
	if err != nil {
		return fmt.Errorf("pg: record sync: %w", err)
	}
	return nil
}

// BeginTranscription moves a video from needs_transcript (or failed) to
// parsing while its AI transcript is made. Only from those: a second click
// while one runs is refused, not queued twice on the learner's key.
func (s *KnowledgeStore) BeginTranscription(ctx context.Context, userID, docID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `
        UPDATE documents SET status = 'parsing', error = '', updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind IN ('youtube', 'media')
          AND status IN ('needs_transcript', 'failed')`, docID, userID)
	if err != nil {
		return fmt.Errorf("pg: begin transcription: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return s.refusedOrNoAccess(ctx, userID, docID)
	}
	return nil
}

// MarkNeedsTranscript puts a video whose transcription stopped back to
// waiting for the learner, with the reason. Only from parsing: a transcript
// the learner uploaded meanwhile must not be overwritten by a late failure.
func (s *KnowledgeStore) MarkNeedsTranscript(ctx context.Context, userID, docID uuid.UUID, reason string) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE documents SET status = 'needs_transcript', error = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind IN ('youtube', 'media') AND status = 'parsing'`,
		docID, userID, reason)
	if err != nil {
		return fmt.Errorf("pg: mark needs transcript: %w", err)
	}
	return nil
}

// MarkNeedsTranscriptTx is the transcribe_video job's gave-up backstop,
// inside the queue's transaction. A no-op when the handler already settled
// the document with its own, more specific reason.
func MarkNeedsTranscriptTx(ctx context.Context, tx pgx.Tx, userID, docID uuid.UUID, reason string) error {
	_, err := tx.Exec(ctx, `
        UPDATE documents SET status = 'needs_transcript', error = $3, updated_at = now()
        WHERE id = $1 AND user_id = $2 AND source_kind IN ('youtube', 'media') AND status = 'parsing'`,
		docID, userID, reason)
	return err
}

// DueWebSyncs lists auto-syncing pages whose next sync is due. The cutoffs are
// computed by the caller: a daily page is due once `daily` has passed since its
// last sync, a page that changed on WeeklyAfterChanges syncs in a row once
// `weekly` has. Across users, by design; see the file comment.
func (s *KnowledgeStore) DueWebSyncs(ctx context.Context, daily, weekly time.Time, limit int) ([]knowledge.Document, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT `+documentColumns("")+`
        FROM documents
        WHERE auto_sync AND source_kind = 'web' AND status IN ('ready', 'failed')
          AND (last_synced_at IS NULL
               OR last_synced_at <= CASE WHEN sync_changes >= $1 THEN $3::timestamptz ELSE $2::timestamptz END)
        ORDER BY last_synced_at NULLS FIRST
        LIMIT $4`, knowledge.WeeklyAfterChanges, daily, weekly, limit)
	if err != nil {
		return nil, fmt.Errorf("pg: due web syncs: %w", err)
	}
	defer rows.Close()
	var out []knowledge.Document
	for rows.Next() {
		var d scannedDocument
		if err := rows.Scan(documentTargets(&d)...); err != nil {
			return nil, err
		}
		if err := d.decodeLinkFields(); err != nil {
			return nil, err
		}
		out = append(out, d.Document)
	}
	return out, rows.Err()
}
