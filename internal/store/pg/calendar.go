package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/calendar"
)

// CalendarStore is calendar_feeds and the rows a study calendar is built
// from (learning-tool-connections phase 2).
type CalendarStore struct {
	pool   *Pool
	encKey string
}

// NewCalendarStore returns a CalendarStore.
func NewCalendarStore(pool *Pool, encKey string) *CalendarStore {
	return &CalendarStore{pool: pool, encKey: encKey}
}

const calendarFeedColumns = `user_id, token_enc, named, include_review, include_loop, include_body, created_at, last_fetched_at`

func (s *CalendarStore) scanFeed(row pgx.Row) (*calendar.Feed, error) {
	var f calendar.Feed
	var enc string
	err := row.Scan(&f.UserID, &enc, &f.Named, &f.Include.Review, &f.Include.Loop, &f.Include.Body, &f.CreatedAt, &f.FetchedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, calendar.ErrNoFeed
	}
	if err != nil {
		return nil, fmt.Errorf("pg: read calendar feed: %w", err)
	}
	if f.Token, err = decryptIfPresent(enc, s.encKey, "calendar feed"); err != nil {
		return nil, err
	}
	return &f, nil
}

// GetFeed returns the learner's feed or calendar.ErrNoFeed.
func (s *CalendarStore) GetFeed(ctx context.Context, userID uuid.UUID) (*calendar.Feed, error) {
	return s.scanFeed(s.pool.QueryRow(ctx, `SELECT `+calendarFeedColumns+` FROM calendar_feeds WHERE user_id = $1`, userID))
}

// FeedByHash finds the feed a token belongs to.
func (s *CalendarStore) FeedByHash(ctx context.Context, hash []byte) (*calendar.Feed, error) {
	return s.scanFeed(s.pool.QueryRow(ctx, `SELECT `+calendarFeedColumns+` FROM calendar_feeds WHERE token_hash = $1`, hash))
}

// SaveFeed creates the feed or replaces its token and options.
func (s *CalendarStore) SaveFeed(ctx context.Context, f calendar.Feed, hash []byte) error {
	enc, err := encryptOrFail(f.Token, s.encKey, "calendar_feeds.token_enc")
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(ctx, `
        INSERT INTO calendar_feeds (user_id, token_hash, token_enc, named, include_review, include_loop, include_body, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id) DO UPDATE SET
            token_hash = EXCLUDED.token_hash, token_enc = EXCLUDED.token_enc,
            named = EXCLUDED.named, include_review = EXCLUDED.include_review,
            include_loop = EXCLUDED.include_loop, include_body = EXCLUDED.include_body,
            created_at = EXCLUDED.created_at, last_fetched_at = NULL`,
		f.UserID, hash, enc, f.Named, f.Include.Review, f.Include.Loop, f.Include.Body, f.CreatedAt)
	if err != nil {
		return fmt.Errorf("pg: save calendar feed: %w", err)
	}
	return nil
}

// UpdateFeedOptions sets the titles and the kinds of events.
func (s *CalendarStore) UpdateFeedOptions(ctx context.Context, userID uuid.UUID, named bool, inc calendar.Include) error {
	_, err := s.pool.Exec(ctx, `
        UPDATE calendar_feeds SET named = $2, include_review = $3, include_loop = $4, include_body = $5
         WHERE user_id = $1`, userID, named, inc.Review, inc.Loop, inc.Body)
	if err != nil {
		return fmt.Errorf("pg: update calendar feed: %w", err)
	}
	return nil
}

// MarkFetched records a calendar app's read.
func (s *CalendarStore) MarkFetched(ctx context.Context, userID uuid.UUID, at time.Time) error {
	_, err := s.pool.Exec(ctx, `UPDATE calendar_feeds SET last_fetched_at = $2 WHERE user_id = $1`, userID, at)
	return err
}

// Source reads the learner's zone, language and review hour, the newest
// cycle of each learning state, and the training week.
func (s *CalendarStore) Source(ctx context.Context, userID uuid.UUID) (*calendar.Source, error) {
	src := calendar.Source{UserID: userID}
	var since *time.Time
	err := s.pool.QueryRow(ctx, `
        SELECT u.timezone, u.language, u.reminder_hour,
               (SELECT created_at FROM calendar_feeds WHERE user_id = u.id)
          FROM users u WHERE u.id = $1`, userID).Scan(&src.Zone, &src.Language, &src.ReminderHour, &since)
	if err != nil {
		return nil, fmt.Errorf("pg: read calendar source: %w", err)
	}
	if since != nil {
		src.Since = *since
	}

	rows, err := s.pool.Query(ctx, `
        SELECT DISTINCT ON (c.state_id) c.id, ls.goal, c.started_at
          FROM cycles c JOIN learning_states ls ON ls.id = c.state_id AND ls.user_id = c.user_id
         WHERE c.user_id = $1 AND c.started_at > now() - interval '100 days'
         ORDER BY c.state_id, c.started_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: read calendar cycles: %w", err)
	}
	for rows.Next() {
		var c calendar.Cycle
		if err := rows.Scan(&c.ID, &c.Goal, &c.StartedAt); err != nil {
			rows.Close()
			return nil, err
		}
		src.Cycles = append(src.Cycles, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = s.pool.Query(ctx, `
        SELECT w.weekday, r.name
          FROM body_week w JOIN body_routines r ON r.id = w.routine_id AND r.user_id = w.user_id
         WHERE w.user_id = $1 ORDER BY w.weekday`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: read calendar training week: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d calendar.TrainingDay
		if err := rows.Scan(&d.Weekday, &d.Routine); err != nil {
			return nil, err
		}
		src.Training = append(src.Training, d)
	}
	return &src, rows.Err()
}
