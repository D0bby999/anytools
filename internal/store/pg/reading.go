package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/reading"
)

// ReadingStore is the pgx implementation of reading workspaces and highlights.
//
// Same rule as everywhere else in this package: every statement names user_id,
// even when the primary key alone would have found the row.
type ReadingStore struct{ pool *Pool }

// NewReadingStore builds a ReadingStore over the shared pool.
func NewReadingStore(pool *Pool) *ReadingStore { return &ReadingStore{pool: pool} }

const workspaceColumns = `id, user_id, document_id, progress, session_id, created_at, updated_at`

// EnsureWorkspace returns the user's workspace for a document, creating it on
// first open.
//
// One statement. Two tabs opened on the same document would otherwise both read
// "none" and race to insert, and the unique constraint would turn the loser's
// page load into an error. ON CONFLICT DO UPDATE rather than DO NOTHING so the
// row comes back in the conflicting case too — DO NOTHING returns nothing, and
// a second round trip to fetch it reintroduces the race it just closed.
func (s *ReadingStore) EnsureWorkspace(
	ctx context.Context, userID, documentID uuid.UUID,
) (*reading.Workspace, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO reading_workspaces (user_id, document_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, document_id)
		DO UPDATE SET updated_at = reading_workspaces.updated_at
		RETURNING `+workspaceColumns, userID, documentID)
	return scanWorkspace(row)
}

// ListWorkspaces returns the user's reading workspaces, most recent first.
func (s *ReadingStore) ListWorkspaces(
	ctx context.Context, userID uuid.UUID, limit int,
) ([]reading.Workspace, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+workspaceColumns+`
		   FROM reading_workspaces WHERE user_id = $1
		  ORDER BY updated_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list reading workspaces: %w", err)
	}
	defer rows.Close()

	out := []reading.Workspace{}
	for rows.Next() {
		w, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// GetWorkspace reads one workspace scoped to its owner.
func (s *ReadingStore) GetWorkspace(ctx context.Context, userID, id uuid.UUID) (*reading.Workspace, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+workspaceColumns+` FROM reading_workspaces WHERE id = $1 AND user_id = $2`,
		id, userID)
	return scanWorkspace(row)
}

// DeleteWorkspace removes a workspace; its highlights cascade.
func (s *ReadingStore) DeleteWorkspace(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM reading_workspaces WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete reading workspace: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return reading.ErrNotFound
	}
	return nil
}

// SetProgress records where the reader got to.
func (s *ReadingStore) SetProgress(
	ctx context.Context, userID, id uuid.UUID, p reading.Progress,
) (*reading.Workspace, error) {
	encoded, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("encode reading progress: %w", err)
	}
	row := s.pool.QueryRow(ctx, `
		UPDATE reading_workspaces SET progress = $3, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+workspaceColumns, id, userID, encoded)
	return scanWorkspace(row)
}

// AttachSession records the chat session the tutor pane runs on.
//
// It only writes when the column is still empty (`session_id IS NULL`), so two
// selection actions fired before the first one's session was stored cannot end
// with the second overwriting the first and orphaning its turn.
func (s *ReadingStore) AttachSession(
	ctx context.Context, userID, id, sessionID uuid.UUID,
) (*reading.Workspace, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE reading_workspaces
		   SET session_id = COALESCE(session_id, $3), updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+workspaceColumns, id, userID, sessionID)
	return scanWorkspace(row)
}

// ───────────────────────────────────────────────────────────────── highlights

const highlightColumns = `id, user_id, workspace_id, page, text, color, note_id, created_at`

// CreateHighlight marks a passage.
func (s *ReadingStore) CreateHighlight(
	ctx context.Context, h reading.Highlight,
) (*reading.Highlight, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO reading_highlights (user_id, workspace_id, page, text, color, note_id)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+highlightColumns,
		h.UserID, h.WorkspaceID, h.Page, h.Text, h.Color, h.NoteID)
	return scanHighlight(row)
}

// ListHighlights returns a workspace's highlights in page order.
func (s *ReadingStore) ListHighlights(
	ctx context.Context, userID, workspaceID uuid.UUID,
) ([]reading.Highlight, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+highlightColumns+`
		   FROM reading_highlights WHERE user_id = $1 AND workspace_id = $2
		  ORDER BY page, created_at`, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list highlights: %w", err)
	}
	defer rows.Close()

	out := []reading.Highlight{}
	for rows.Next() {
		h, err := scanHighlight(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *h)
	}
	return out, rows.Err()
}

// GetHighlight reads one highlight.
func (s *ReadingStore) GetHighlight(ctx context.Context, userID, id uuid.UUID) (*reading.Highlight, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+highlightColumns+` FROM reading_highlights WHERE id = $1 AND user_id = $2`,
		id, userID)
	return scanHighlight(row)
}

// UpdateHighlight recolours a highlight or links it to a note.
func (s *ReadingStore) UpdateHighlight(
	ctx context.Context, userID, id uuid.UUID, patch reading.HighlightPatch,
) (*reading.Highlight, error) {
	row := s.pool.QueryRow(ctx, `
		UPDATE reading_highlights
		   SET color = COALESCE($3, color),
		       note_id = COALESCE($4, note_id)
		 WHERE id = $1 AND user_id = $2
		RETURNING `+highlightColumns, id, userID, patch.Color, patch.NoteID)
	return scanHighlight(row)
}

// DeleteHighlight removes a highlight.
func (s *ReadingStore) DeleteHighlight(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM reading_highlights WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete highlight: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return reading.ErrNotFound
	}
	return nil
}

// ─────────────────────────────────────────────────────────────── internals

func scanWorkspace(row pgx.Row) (*reading.Workspace, error) {
	var w reading.Workspace
	var progress []byte
	err := row.Scan(&w.ID, &w.UserID, &w.DocumentID, &progress, &w.SessionID, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, reading.ErrNotFound
		}
		return nil, fmt.Errorf("scan reading workspace: %w", err)
	}
	if len(progress) > 0 {
		if err := json.Unmarshal(progress, &w.Progress); err != nil {
			return nil, fmt.Errorf("decode reading progress: %w", err)
		}
	}
	return &w, nil
}

func scanHighlight(row pgx.Row) (*reading.Highlight, error) {
	var h reading.Highlight
	err := row.Scan(&h.ID, &h.UserID, &h.WorkspaceID, &h.Page, &h.Text, &h.Color, &h.NoteID, &h.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, reading.ErrNotFound
		}
		return nil, fmt.Errorf("scan highlight: %w", err)
	}
	return &h, nil
}
