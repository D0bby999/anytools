package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/connectors/notion"
)

// NotionStore is notion_pages (learning-tool-connections phase 9).
type NotionStore struct{ pool *Pool }

// NewNotionStore returns a NotionStore.
func NewNotionStore(pool *Pool) *NotionStore { return &NotionStore{pool: pool} }

// List lists a learner's imported pages, newest title first.
func (s *NotionStore) List(ctx context.Context, userID uuid.UUID) ([]notion.Link, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT page_id, kind, title, kb_id, document_id, last_edited, synced_at, gone, last_error
          FROM notion_pages WHERE user_id = $1 ORDER BY title`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: list notion pages: %w", err)
	}
	defer rows.Close()
	var out []notion.Link
	for rows.Next() {
		l := notion.Link{UserID: userID}
		if err := rows.Scan(&l.PageID, &l.Kind, &l.Title, &l.KBID, &l.DocumentID, &l.LastEdited, &l.SyncedAt, &l.Gone, &l.LastError); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Save creates or updates a link.
func (s *NotionStore) Save(ctx context.Context, l notion.Link) error {
	_, err := s.pool.Exec(ctx, `
        INSERT INTO notion_pages (user_id, page_id, kind, title, kb_id, document_id, last_edited, synced_at, gone, last_error)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (user_id, page_id) DO UPDATE SET
            kind = EXCLUDED.kind, title = EXCLUDED.title, kb_id = EXCLUDED.kb_id, document_id = EXCLUDED.document_id,
            last_edited = EXCLUDED.last_edited, synced_at = EXCLUDED.synced_at, gone = EXCLUDED.gone, last_error = EXCLUDED.last_error`,
		l.UserID, l.PageID, l.Kind, clip(l.Title, 500), l.KBID, l.DocumentID, l.LastEdited, l.SyncedAt, l.Gone, clip(l.LastError, 500))
	if err != nil {
		return fmt.Errorf("pg: save notion page: %w", err)
	}
	return nil
}

// DeleteAll forgets a learner's links.
func (s *NotionStore) DeleteAll(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM notion_pages WHERE user_id = $1`, userID)
	return err
}

// Users lists learners with a live imported page and a working grant.
func (s *NotionStore) Users(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT DISTINCT n.user_id FROM notion_pages n
          JOIN app_connections c ON c.user_id = n.user_id AND c.provider = 'notion' AND NOT c.needs_reconnect
         WHERE NOT n.gone`)
	if err != nil {
		return nil, fmt.Errorf("pg: list notion users: %w", err)
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
