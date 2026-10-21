package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/connectors/gcal"
)

// GCalStore is google_calendars (learning-tool-connections phase 3).
type GCalStore struct{ pool *Pool }

// NewGCalStore returns a GCalStore.
func NewGCalStore(pool *Pool) *GCalStore { return &GCalStore{pool: pool} }

// GetLink returns the learner's AnyLearn calendar or gcal.ErrNotEnabled.
func (s *GCalStore) GetLink(ctx context.Context, userID uuid.UUID) (*gcal.Link, error) {
	var l gcal.Link
	err := s.pool.QueryRow(ctx, `
        SELECT user_id, calendar_id, event_ids, synced_at, last_error, created_at
          FROM google_calendars WHERE user_id = $1`, userID).
		Scan(&l.UserID, &l.CalendarID, &l.EventIDs, &l.SyncedAt, &l.LastError, &l.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, gcal.ErrNotEnabled
	}
	if err != nil {
		return nil, fmt.Errorf("pg: read google calendar: %w", err)
	}
	return &l, nil
}

// SaveLink creates or updates the link.
func (s *GCalStore) SaveLink(ctx context.Context, l gcal.Link) error {
	if l.EventIDs == nil {
		l.EventIDs = []string{}
	}
	msg := l.LastError
	if r := []rune(msg); len(r) > 2000 {
		msg = string(r[:2000])
	}
	_, err := s.pool.Exec(ctx, `
        INSERT INTO google_calendars (user_id, calendar_id, event_ids, synced_at, last_error, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
            calendar_id = EXCLUDED.calendar_id, event_ids = EXCLUDED.event_ids,
            synced_at = EXCLUDED.synced_at, last_error = EXCLUDED.last_error`,
		l.UserID, l.CalendarID, l.EventIDs, l.SyncedAt, msg, l.CreatedAt)
	if err != nil {
		return fmt.Errorf("pg: save google calendar: %w", err)
	}
	return nil
}

// DeleteLink forgets the link.
func (s *GCalStore) DeleteLink(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM google_calendars WHERE user_id = $1`, userID)
	return err
}

// ListLinkedUsers lists learners with a calendar whose Google grant still works.
func (s *GCalStore) ListLinkedUsers(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT g.user_id FROM google_calendars g
          JOIN drive_connections d ON d.user_id = g.user_id AND NOT d.needs_reconnect`)
	if err != nil {
		return nil, fmt.Errorf("pg: list google calendars: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
