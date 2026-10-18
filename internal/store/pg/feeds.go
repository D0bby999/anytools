package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/authz"
	feedconn "github.com/D0bby999/anytools/internal/connectors/feeds"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
)

// feeds.go — podcast feeds, YouTube playlists and channels, and their
// entries (up-methods phase 17).
//
// Every statement carries `user_id = $n`, except DueFeeds, the daily check's
// cross-user scan, only ever called under its advisory lock. A row of
// another user answers authz.ErrNoAccess, exactly like a missing one.

// FeedStore persists feeds.
type FeedStore struct{ pool *Pool }

// NewFeedStore returns a FeedStore.
func NewFeedStore(pool *Pool) *FeedStore { return &FeedStore{pool: pool} }

var _ knowledge.FeedStore = (*FeedStore)(nil)

// videoDoc is a document of the entry's video in the feed's knowledge base,
// however it got there. e and f are the entry and its feed.
const videoDoc = `(SELECT x.id FROM documents x
                    WHERE e.video_id <> '' AND x.user_id = e.user_id AND x.kb_id = f.kb_id
                      AND x.source_kind = 'youtube' AND x.media_id = e.video_id
                    ORDER BY x.created_at LIMIT 1)`

const inKB = `(e.document_id IS NOT NULL OR ` + videoDoc + ` IS NOT NULL)`

const feedColumns = `f.id, f.user_id, f.kb_id, f.kind, f.url, f.title, f.last_checked_at, f.check_error,
       f.auto_add, f.listed_by, f.created_at, f.updated_at,
       (SELECT count(*) FROM feed_entries e WHERE e.feed_id = f.id AND e.user_id = f.user_id),
       (SELECT count(*) FROM feed_entries e WHERE e.feed_id = f.id AND e.user_id = f.user_id
           AND e.is_new AND e.add_status <> 'queued' AND NOT ` + inKB + `),
       (SELECT count(*) FROM feed_entries e WHERE e.feed_id = f.id AND e.user_id = f.user_id AND ` + inKB + `)`

func scanFeed(row pgx.Row) (*knowledge.Feed, error) {
	var f knowledge.Feed
	err := row.Scan(&f.ID, &f.UserID, &f.KBID, &f.Kind, &f.URL, &f.Title, &f.LastCheckedAt, &f.CheckError,
		&f.AutoAdd, &f.ListedBy, &f.CreatedAt, &f.UpdatedAt, &f.Entries, &f.New, &f.Added)
	return &f, err
}

// CreateFeed inserts a feed and its first listing. The knowledge base's row
// is locked while its feeds are counted, so two adds at once cannot both
// take the last place.
func (st *FeedStore) CreateFeed(ctx context.Context, f knowledge.Feed, l knowledge.FeedListing, max int, at time.Time) (*knowledge.Feed, error) {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var n int
	err = tx.QueryRow(ctx, `
        SELECT (SELECT count(*) FROM feeds WHERE kb_id = k.id AND user_id = k.user_id)
          FROM knowledge_bases k WHERE k.id = $1 AND k.user_id = $2 FOR UPDATE`, f.KBID, f.UserID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: count feeds: %w", err)
	}
	if n >= max {
		return nil, knowledge.ErrFeedLimit
	}

	var id uuid.UUID
	err = tx.QueryRow(ctx, `
        INSERT INTO feeds (user_id, kb_id, kind, url, title, listed_by, check_error, last_checked_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
		f.UserID, f.KBID, f.Kind, f.URL, truncateRunes(f.Title, 300), f.ListedBy, truncateRunes(f.CheckError, 500), at).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "feeds_kb_url_unique" {
			return nil, knowledge.ErrDuplicateSource
		}
		return nil, fmt.Errorf("pg: create feed: %w", err)
	}
	// The first listing is what the feed has, not what is new.
	if _, err := upsertEntries(ctx, tx, f.UserID, id, l.Entries, false); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return st.GetFeed(ctx, f.UserID, id)
}

// upsertEntries stores a listing, in its order. An entry seen before keeps
// its marks; one not in this listing moves after the listed ones. It
// returns how many entries were new, and keeps the feed's newest
// feedconn.MaxEntries (never dropping one in the knowledge base or queued).
func upsertEntries(ctx context.Context, tx pgx.Tx, userID, feedID uuid.UUID, entries []feedconn.Entry, markNew bool) (int, error) {
	if len(entries) > feedconn.MaxEntries {
		entries = entries[:feedconn.MaxEntries]
	}
	if _, err := tx.Exec(ctx, `
        UPDATE feed_entries SET position = 1000000 WHERE feed_id = $1 AND user_id = $2`, feedID, userID); err != nil {
		return 0, fmt.Errorf("pg: feed entries: %w", err)
	}
	n := len(entries)
	keys, titles, urls, types, videos := make([]string, n), make([]string, n), make([]string, n), make([]string, n), make([]string, n)
	positions, durations := make([]int32, n), make([]int32, n)
	sizes := make([]int64, n)
	published := make([]*time.Time, n)
	for i, e := range entries {
		keys[i], titles[i], urls[i], videos[i] = e.Key, truncateRunes(e.Title, 300), e.MediaURL, e.VideoID
		types[i] = truncateRunes(e.MediaType, 100)
		positions[i], durations[i], sizes[i], published[i] = int32(i), int32(e.DurationSeconds), e.MediaSize, e.Published
	}
	rows, err := tx.Query(ctx, `
        INSERT INTO feed_entries (feed_id, user_id, entry_key, position, title, published_at, duration_seconds,
                                  media_url, media_type, media_bytes, video_id, is_new)
        SELECT $1, $2, k, p, t, d, s, u, ty, b, v, $12
          FROM unnest($3::text[], $4::int[], $5::text[], $6::timestamptz[], $7::int[], $8::text[], $9::text[],
                      $10::bigint[], $11::text[]) AS x(k, p, t, d, s, u, ty, b, v)
        ON CONFLICT (feed_id, entry_key) DO UPDATE
           SET position = EXCLUDED.position, title = EXCLUDED.title,
               published_at = COALESCE(EXCLUDED.published_at, feed_entries.published_at),
               -- A keyless listing says nothing of length; keep what the
               -- Data API said.
               duration_seconds = CASE WHEN EXCLUDED.duration_seconds > 0 THEN EXCLUDED.duration_seconds
                                       ELSE feed_entries.duration_seconds END,
               media_url = EXCLUDED.media_url, media_type = EXCLUDED.media_type, media_bytes = EXCLUDED.media_bytes
        RETURNING (xmax = 0)`,
		feedID, userID, keys, positions, titles, published, durations, urls, types, sizes, videos, markNew)
	if err != nil {
		return 0, fmt.Errorf("pg: feed entries: %w", err)
	}
	inserted := 0
	for rows.Next() {
		var fresh bool
		if err := rows.Scan(&fresh); err != nil {
			rows.Close()
			return 0, fmt.Errorf("pg: feed entries: %w", err)
		}
		if fresh {
			inserted++
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("pg: feed entries: %w", err)
	}
	if _, err := tx.Exec(ctx, `
        DELETE FROM feed_entries e USING (
               SELECT entry_key, row_number() OVER (ORDER BY position, published_at DESC NULLS LAST, first_seen_at DESC) AS n
                 FROM feed_entries WHERE feed_id = $1 AND user_id = $2) r
         WHERE e.feed_id = $1 AND e.user_id = $2 AND e.entry_key = r.entry_key AND r.n > $3
           AND e.document_id IS NULL AND e.add_status <> 'queued'`, feedID, userID, feedconn.MaxEntries); err != nil {
		return 0, fmt.Errorf("pg: trim feed entries: %w", err)
	}
	if !markNew {
		return 0, nil
	}
	return inserted, nil
}

// GetFeed reads one feed.
func (st *FeedStore) GetFeed(ctx context.Context, userID, feedID uuid.UUID) (*knowledge.Feed, error) {
	f, err := scanFeed(st.pool.QueryRow(ctx, `SELECT `+feedColumns+` FROM feeds f WHERE f.id = $1 AND f.user_id = $2`, feedID, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: get feed: %w", err)
	}
	return f, nil
}

// ListFeeds are a knowledge base's feeds, newest first (at most 20 exist).
func (st *FeedStore) ListFeeds(ctx context.Context, userID, kbID uuid.UUID) ([]knowledge.Feed, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+feedColumns+` FROM feeds f
        WHERE f.user_id = $1 AND f.kb_id = $2 ORDER BY f.created_at DESC LIMIT 100`, userID, kbID)
	if err != nil {
		return nil, fmt.Errorf("pg: list feeds: %w", err)
	}
	defer rows.Close()
	out := []knowledge.Feed{}
	for rows.Next() {
		f, err := scanFeed(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: list feeds: %w", err)
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

const entryColumns = `e.entry_key, e.title, e.published_at, e.duration_seconds, e.media_url, e.media_type,
       e.media_bytes, e.video_id, e.is_new, e.add_status, e.add_error,
       COALESCE(e.document_id, ` + videoDoc + `),
       COALESCE((SELECT d.status FROM documents d WHERE d.id = COALESCE(e.document_id, ` + videoDoc + `) AND d.user_id = e.user_id), '')`

func scanEntry(row pgx.Row) (*knowledge.FeedEntry, error) {
	var e knowledge.FeedEntry
	err := row.Scan(&e.Key, &e.Title, &e.PublishedAt, &e.DurationSeconds, &e.MediaURL, &e.MediaType,
		&e.MediaBytes, &e.VideoID, &e.New, &e.AddStatus, &e.AddError, &e.DocumentID, &e.DocStatus)
	if e.DocumentID != nil {
		// In the knowledge base: no longer new.
		e.New = false
	}
	return &e, err
}

// FeedEntries are a feed's entries in the latest listing's order, at most
// feedconn.MaxEntries plus those kept because they were added.
func (st *FeedStore) FeedEntries(ctx context.Context, userID, feedID uuid.UUID) ([]knowledge.FeedEntry, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+entryColumns+`
          FROM feed_entries e JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
         WHERE e.feed_id = $1 AND e.user_id = $2
         ORDER BY e.position, e.published_at DESC NULLS LAST, e.first_seen_at DESC
         LIMIT 1000`, feedID, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: feed entries: %w", err)
	}
	defer rows.Close()
	out := []knowledge.FeedEntry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: feed entries: %w", err)
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// FeedEntry reads one entry of the caller's feed.
func (st *FeedStore) FeedEntry(ctx context.Context, userID, feedID uuid.UUID, key string) (*knowledge.FeedEntry, error) {
	e, err := scanEntry(st.pool.QueryRow(ctx, `SELECT `+entryColumns+`
          FROM feed_entries e JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
         WHERE e.feed_id = $1 AND e.user_id = $2 AND e.entry_key = $3`, feedID, userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, authz.ErrNoAccess
	}
	if err != nil {
		return nil, fmt.Errorf("pg: feed entry: %w", err)
	}
	return e, nil
}

// DeleteFeed removes a feed and its entries. Its documents stay.
func (st *FeedStore) DeleteFeed(ctx context.Context, userID, feedID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `DELETE FROM feeds WHERE id = $1 AND user_id = $2`, feedID, userID)
	if err != nil {
		return fmt.Errorf("pg: delete feed: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return authz.ErrNoAccess
	}
	return nil
}

// SetFeedAutoAdd turns auto_add on or off.
func (st *FeedStore) SetFeedAutoAdd(ctx context.Context, userID, feedID uuid.UUID, on bool) (*knowledge.Feed, error) {
	tag, err := st.pool.Exec(ctx, `UPDATE feeds SET auto_add = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
		feedID, userID, on)
	if err != nil {
		return nil, fmt.Errorf("pg: feed auto add: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, authz.ErrNoAccess
	}
	return st.GetFeed(ctx, userID, feedID)
}

// MarkFeedSeen clears the feed's "New" marks.
func (st *FeedStore) MarkFeedSeen(ctx context.Context, userID, feedID uuid.UUID) error {
	if _, err := st.GetFeed(ctx, userID, feedID); err != nil {
		return err
	}
	_, err := st.pool.Exec(ctx, `UPDATE feed_entries SET is_new = false WHERE feed_id = $1 AND user_id = $2 AND is_new`,
		feedID, userID)
	if err != nil {
		return fmt.Errorf("pg: feed seen: %w", err)
	}
	return nil
}

// RecordFeedCheck stores a listing and the check's time.
func (st *FeedStore) RecordFeedCheck(ctx context.Context, userID, feedID uuid.UUID, l knowledge.FeedListing, at time.Time) (int, error) {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `
        UPDATE feeds SET title = CASE WHEN $3 <> '' THEN $3 ELSE title END, listed_by = $4,
                         check_error = $5, last_checked_at = $6, updated_at = now()
         WHERE id = $1 AND user_id = $2`,
		feedID, userID, truncateRunes(l.Title, 300), l.ListedBy, truncateRunes(l.Note, 500), at)
	if err != nil {
		return 0, fmt.Errorf("pg: feed check: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return 0, authz.ErrNoAccess
	}
	n, err := upsertEntries(ctx, tx, userID, feedID, l.Entries, true)
	if err != nil {
		return 0, err
	}
	return n, tx.Commit(ctx)
}

// RecordFeedError stores a failed check.
func (st *FeedStore) RecordFeedError(ctx context.Context, userID, feedID uuid.UUID, msg string, at time.Time) error {
	_, err := st.pool.Exec(ctx, `
        UPDATE feeds SET check_error = $3, last_checked_at = $4, updated_at = now() WHERE id = $1 AND user_id = $2`,
		feedID, userID, truncateRunes(msg, 500), at)
	if err != nil {
		return fmt.Errorf("pg: feed error: %w", err)
	}
	return nil
}

// QueueFeedEntries marks the named entries of the caller's feed queued,
// except those in the knowledge base or queued already. A key that is not
// one of this feed's entries matches nothing.
func (st *FeedStore) QueueFeedEntries(ctx context.Context, userID, feedID uuid.UUID, keys []string) ([]string, error) {
	rows, err := st.pool.Query(ctx, `
        UPDATE feed_entries e SET add_status = 'queued', add_error = ''
          FROM feeds f
         WHERE e.feed_id = $1 AND e.user_id = $2 AND f.id = e.feed_id AND f.user_id = e.user_id
           AND e.entry_key = ANY($3) AND e.add_status <> 'queued' AND NOT `+inKB+`
        RETURNING e.entry_key`, feedID, userID, keys)
	if err != nil {
		return nil, fmt.Errorf("pg: queue feed entries: %w", err)
	}
	return inRequestOrder(rows, keys)
}

// inRequestOrder collects the returned keys in the order they were asked.
func inRequestOrder(rows pgx.Rows, keys []string) ([]string, error) {
	got := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			rows.Close()
			return nil, err
		}
		got[k] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []string{}
	for _, k := range keys {
		if got[k] {
			out = append(out, k)
		}
	}
	return out, nil
}

// QueueAutoAdd marks up to max of the feed's new entries queued, newest
// first, less those auto-added since `since`.
func (st *FeedStore) QueueAutoAdd(ctx context.Context, userID, feedID uuid.UUID, since time.Time, max int, at time.Time) ([]string, error) {
	rows, err := st.pool.Query(ctx, `
        WITH pick AS (
            SELECT e.entry_key, e.position
              FROM feed_entries e JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
             WHERE e.feed_id = $1 AND e.user_id = $2 AND e.is_new AND e.add_status = '' AND NOT `+inKB+`
             ORDER BY e.position, e.published_at DESC NULLS LAST
             LIMIT GREATEST($4 - (SELECT count(*) FROM feed_entries u
                                   WHERE u.feed_id = $1 AND u.user_id = $2 AND u.auto_added_at > $3), 0)
               FOR UPDATE OF e)
        UPDATE feed_entries e SET add_status = 'queued', add_error = '', auto_added_at = $5
          FROM pick
         WHERE e.feed_id = $1 AND e.user_id = $2 AND e.entry_key = pick.entry_key
        RETURNING e.entry_key, pick.position`, feedID, userID, since, max, at)
	if err != nil {
		return nil, fmt.Errorf("pg: auto add: %w", err)
	}
	defer rows.Close()
	type picked struct {
		key string
		pos int
	}
	var all []picked
	for rows.Next() {
		var p picked
		if err := rows.Scan(&p.key, &p.pos); err != nil {
			return nil, fmt.Errorf("pg: auto add: %w", err)
		}
		all = append(all, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(all, func(i, j int) bool { return all[i].pos < all[j].pos })
	out := make([]string, 0, len(all))
	for _, p := range all {
		out = append(out, p.key)
	}
	return out, nil
}

// SetEntryAdded records the document an entry became (nil: a document of
// its video was there already).
func (st *FeedStore) SetEntryAdded(ctx context.Context, userID, feedID uuid.UUID, key string, docID *uuid.UUID) error {
	_, err := st.pool.Exec(ctx, `
        UPDATE feed_entries SET document_id = COALESCE($4, document_id), add_status = '', add_error = '', is_new = false
         WHERE feed_id = $1 AND user_id = $2 AND entry_key = $3`, feedID, userID, key, docID)
	if err != nil {
		return fmt.Errorf("pg: entry added: %w", err)
	}
	return nil
}

// SetEntryFailed records why an entry was not added.
func (st *FeedStore) SetEntryFailed(ctx context.Context, userID, feedID uuid.UUID, key, msg string) error {
	if msg == "" {
		msg = "the entry could not be added"
	}
	_, err := st.pool.Exec(ctx, `
        UPDATE feed_entries SET add_status = 'failed', add_error = $4
         WHERE feed_id = $1 AND user_id = $2 AND entry_key = $3`, feedID, userID, key, truncateRunes(msg, 300))
	if err != nil {
		return fmt.Errorf("pg: entry failed: %w", err)
	}
	return nil
}

// DueFeeds are the feeds last checked before `before`, across users,
// longest-waiting first. Only the daily check calls it, under its lock.
func (st *FeedStore) DueFeeds(ctx context.Context, before time.Time, limit int) ([]knowledge.Feed, error) {
	rows, err := st.pool.Query(ctx, `SELECT `+feedColumns+` FROM feeds f
        WHERE f.last_checked_at IS NULL OR f.last_checked_at < $1
        ORDER BY f.last_checked_at NULLS FIRST LIMIT $2`, before, limit)
	if err != nil {
		return nil, fmt.Errorf("pg: due feeds: %w", err)
	}
	defer rows.Close()
	out := []knowledge.Feed{}
	for rows.Next() {
		f, err := scanFeed(rows)
		if err != nil {
			return nil, fmt.Errorf("pg: due feeds: %w", err)
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}

// FeedReapHandler settles the entries of an add_feed_entries job the reaper
// gave up on, so none stays "queued" for ever.
func FeedReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if !job.Terminal || job.Kind != knowledge.JobAddFeedEntries {
			return nil
		}
		var p knowledge.FeedJobPayload
		if err := json.Unmarshal(job.Payload, &p); err != nil {
			return nil
		}
		_, err := tx.Exec(ctx, `
            UPDATE feed_entries SET add_status = 'failed', add_error = 'adding stopped before it finished. Try again.'
             WHERE feed_id = $1 AND user_id = $2 AND add_status = 'queued' AND entry_key = ANY($3)`,
			p.FeedID, job.UserID, p.Keys)
		return err
	}
}
