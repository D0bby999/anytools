package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/notebook"
)

// NotebookStore is the pgx implementation of notebook persistence.
//
// EVERY statement in this file names user_id, including the ones whose id is
// already a primary key. That redundancy is the point: a handler's ownership
// check is one refactor away from being moved or cached, and a query that does
// not name the owner is a query that will eventually run without one. It is the
// same rule ChatStore states and the same one red-team RT-3 found broken in the
// system this was ported from.
type NotebookStore struct{ pool *Pool }

// NewNotebookStore builds a NotebookStore over the shared pool.
func NewNotebookStore(pool *Pool) *NotebookStore { return &NotebookStore{pool: pool} }

const notebookColumns = `n.id, n.user_id, n.name, n.is_default, n.created_at, n.updated_at,
	(SELECT count(*) FROM notes WHERE notes.notebook_id = n.id AND notes.user_id = n.user_id)`

// ───────────────────────────────────────────────────────────────── notebooks

// CreateNotebook inserts a notebook.
func (s *NotebookStore) CreateNotebook(
	ctx context.Context, userID uuid.UUID, name string, isDefault bool,
) (*notebook.Notebook, error) {
	row := s.pool.QueryRow(ctx, `
		WITH n AS (
			INSERT INTO notebooks (user_id, name, is_default)
			VALUES ($1, $2, $3)
			RETURNING id, user_id, name, is_default, created_at, updated_at
		)
		SELECT `+notebookColumns+` FROM n`, userID, name, isDefault)
	return scanNotebook(row)
}

// ListNotebooks returns a user's notebooks, most recently touched first.
func (s *NotebookStore) ListNotebooks(ctx context.Context, userID uuid.UUID) ([]notebook.Notebook, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+notebookColumns+`
		  FROM notebooks n
		 WHERE n.user_id = $1
		 ORDER BY n.is_default DESC, n.updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list notebooks: %w", err)
	}
	defer rows.Close()

	out := []notebook.Notebook{}
	for rows.Next() {
		nb, err := scanNotebook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *nb)
	}
	return out, rows.Err()
}

// GetNotebook reads one notebook scoped to its owner.
func (s *NotebookStore) GetNotebook(ctx context.Context, userID, id uuid.UUID) (*notebook.Notebook, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+notebookColumns+` FROM notebooks n WHERE n.id = $1 AND n.user_id = $2`, id, userID)
	return scanNotebook(row)
}

// RenameNotebook renames one.
func (s *NotebookStore) RenameNotebook(
	ctx context.Context, userID, id uuid.UUID, name string,
) (*notebook.Notebook, error) {
	row := s.pool.QueryRow(ctx, `
		WITH n AS (
			UPDATE notebooks SET name = $3, updated_at = now()
			 WHERE id = $1 AND user_id = $2
			RETURNING id, user_id, name, is_default, created_at, updated_at
		)
		SELECT `+notebookColumns+` FROM n`, id, userID, name)
	return scanNotebook(row)
}

// DeleteNotebook removes a notebook; its notes and categories cascade.
func (s *NotebookStore) DeleteNotebook(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM notebooks WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete notebook: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return notebook.ErrNotFound
	}
	return nil
}

// DefaultNotebook returns the user's default notebook, creating it on first use.
//
// One statement, not read-then-write. Two concurrent first saves — the model
// writing a note while the reader saves a highlight — would both read "no
// default" and both insert; the partial unique index would then fail one of
// them with a constraint violation the user would see as "could not save".
// ON CONFLICT resolves it into the same row for both.
//
// The statement runs at most twice. When the conflicting row was committed by
// a concurrent caller after this statement's snapshot was taken, the INSERT
// returns nothing and the SELECT, reading that same snapshot, cannot see the
// row either. A second statement takes a fresh snapshot and does.
func (s *NotebookStore) DefaultNotebook(ctx context.Context, userID uuid.UUID) (*notebook.Notebook, error) {
	nb, err := s.defaultNotebookOnce(ctx, userID)
	if errors.Is(err, notebook.ErrNotFound) {
		return s.defaultNotebookOnce(ctx, userID)
	}
	return nb, err
}

func (s *NotebookStore) defaultNotebookOnce(ctx context.Context, userID uuid.UUID) (*notebook.Notebook, error) {
	row := s.pool.QueryRow(ctx, `
		WITH inserted AS (
			INSERT INTO notebooks (user_id, name, is_default)
			VALUES ($1, 'My notebook', true)
			ON CONFLICT (user_id) WHERE is_default DO NOTHING
			RETURNING id, user_id, name, is_default, created_at, updated_at
		), n AS (
			SELECT * FROM inserted
			UNION ALL
			SELECT id, user_id, name, is_default, created_at, updated_at
			  FROM notebooks WHERE user_id = $1 AND is_default
			 LIMIT 1
		)
		SELECT `+notebookColumns+` FROM n LIMIT 1`, userID)
	return scanNotebook(row)
}

// ───────────────────────────────────────────────────────────────────── notes

const noteColumns = `id, user_id, notebook_id, title, body_md, source, created_by, created_at, updated_at`

// CreateNote inserts a note and its category links.
func (s *NotebookStore) CreateNote(ctx context.Context, n notebook.Note) (*notebook.Note, error) {
	source, err := json.Marshal(n.Source)
	if err != nil {
		return nil, fmt.Errorf("encode note source: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create note: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	row := tx.QueryRow(ctx, `
		INSERT INTO notes (user_id, notebook_id, title, body_md, source, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING `+noteColumns,
		n.UserID, n.NotebookID, n.Title, n.BodyMD, source, n.CreatedBy)
	created, err := scanNote(row)
	if err != nil {
		return nil, err
	}
	if err := setCategories(ctx, tx, n.UserID, created.ID, n.CategoryIDs); err != nil {
		return nil, err
	}
	if err := touchNotebook(ctx, tx, n.UserID, n.NotebookID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create note: %w", err)
	}
	created.CategoryIDs = dedupe(n.CategoryIDs)
	return created, nil
}

// GetNote reads one note with its categories.
func (s *NotebookStore) GetNote(ctx context.Context, userID, id uuid.UUID) (*notebook.Note, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+noteColumns+` FROM notes WHERE id = $1 AND user_id = $2`, id, userID)
	n, err := scanNote(row)
	if err != nil {
		return nil, err
	}
	n.CategoryIDs, err = s.categoriesOf(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	return n, nil
}

// ListNotes returns a notebook's notes, newest first.
//
// The category and document filters are applied in SQL rather than by loading
// everything and filtering in Go — a notebook is unbounded, and "unbounded"
// stops being theoretical the first time an agent writes a note per turn.
func (s *NotebookStore) ListNotes(
	ctx context.Context, userID, notebookID uuid.UUID, f notebook.NoteFilter,
) ([]notebook.Note, error) {
	limit := f.Limit
	if limit <= 0 || limit > notebook.ExportLimit {
		limit = 200
	}

	var docFilter any
	if f.DocumentID != nil {
		// Matched as jsonb containment so the GIN index on `source` serves it.
		docFilter = fmt.Sprintf(`{"id": %q}`, f.DocumentID.String())
	}
	var catFilter any
	if f.CategoryID != nil {
		catFilter = *f.CategoryID
	}

	rows, err := s.pool.Query(ctx, `
		SELECT `+noteColumns+`
		  FROM notes n
		 WHERE n.user_id = $1
		   AND ($2::uuid IS NULL OR n.notebook_id = $2)
		   AND ($3::jsonb IS NULL OR n.source @> $3)
		   AND ($4::uuid IS NULL OR EXISTS (
		         SELECT 1 FROM note_category_links l
		          WHERE l.note_id = n.id AND l.user_id = $1 AND l.category_id = $4))
		 ORDER BY n.created_at DESC, n.id DESC
		 LIMIT $5`,
		userID, nilUUID(notebookID), docFilter, catFilter, limit)
	if err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	defer rows.Close()

	out := []notebook.Note{}
	ids := []uuid.UUID{}
	for rows.Next() {
		n, err := scanNote(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *n)
		ids = append(ids, n.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}

	// One query for every note's categories rather than one per note: a
	// notebook page renders 200 notes, and 200 round trips is the difference
	// between a page that loads and one that times out.
	links, err := s.categoriesFor(ctx, userID, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].CategoryIDs = links[out[i].ID]
	}
	return out, nil
}

// UpdateNote applies a patch.
func (s *NotebookStore) UpdateNote(
	ctx context.Context, userID, id uuid.UUID, patch notebook.NotePatch,
) (*notebook.Note, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update note: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	row := tx.QueryRow(ctx, `
		UPDATE notes
		   SET title = COALESCE($3, title),
		       body_md = COALESCE($4, body_md),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+noteColumns, id, userID, patch.Title, patch.BodyMD)
	updated, err := scanNote(row)
	if err != nil {
		return nil, err
	}
	if patch.CategoryIDs != nil {
		if err := clearCategories(ctx, tx, userID, id); err != nil {
			return nil, err
		}
		if err := setCategories(ctx, tx, userID, id, *patch.CategoryIDs); err != nil {
			return nil, err
		}
	}
	if err := touchNotebook(ctx, tx, userID, updated.NotebookID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update note: %w", err)
	}
	return s.GetNote(ctx, userID, id)
}

// DeleteNote removes a note.
func (s *NotebookStore) DeleteNote(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM notes WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete note: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return notebook.ErrNotFound
	}
	return nil
}

// MoveNote moves a note to another notebook and drops its category links.
//
// Both notebooks are named by (id, user_id): the composite foreign key means a
// destination belonging to someone else is rejected by the DATABASE, not merely
// by the handler that was supposed to check.
func (s *NotebookStore) MoveNote(
	ctx context.Context, userID, noteID, toNotebookID uuid.UUID,
) (*notebook.Note, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("move note: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// The destination is verified here rather than left to the foreign key, so
	// a foreign notebook id is ErrNotFound (404) instead of a constraint error
	// the API would have to report as 500.
	var exists bool
	if err := tx.QueryRow(ctx,
		`SELECT true FROM notebooks WHERE id = $1 AND user_id = $2`,
		toNotebookID, userID).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notebook.ErrNotFound
		}
		return nil, fmt.Errorf("move note: %w", err)
	}

	row := tx.QueryRow(ctx, `
		UPDATE notes SET notebook_id = $3, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+noteColumns, noteID, userID, toNotebookID)
	moved, err := scanNote(row)
	if err != nil {
		return nil, err
	}
	// A category belongs to ONE notebook, so carrying the links across would
	// file the note under labels the destination does not have.
	if err := clearCategories(ctx, tx, userID, noteID); err != nil {
		return nil, err
	}
	if err := touchNotebook(ctx, tx, userID, toNotebookID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("move note: %w", err)
	}
	moved.CategoryIDs = []uuid.UUID{}
	return moved, nil
}

// ──────────────────────────────────────────────────────────────── categories

const categoryColumns = `id, user_id, notebook_id, name, created_at`

// CreateCategory adds a label to a notebook.
func (s *NotebookStore) CreateCategory(
	ctx context.Context, userID, notebookID uuid.UUID, name string,
) (*notebook.Category, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO note_categories (user_id, notebook_id, name)
		VALUES ($1, $2, $3)
		ON CONFLICT (notebook_id, name) DO UPDATE SET name = EXCLUDED.name
		RETURNING `+categoryColumns, userID, notebookID, name)
	return scanCategory(row)
}

// ListCategories returns a notebook's categories, alphabetically.
func (s *NotebookStore) ListCategories(
	ctx context.Context, userID, notebookID uuid.UUID,
) ([]notebook.Category, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+categoryColumns+`
		   FROM note_categories WHERE user_id = $1 AND notebook_id = $2 ORDER BY name`,
		userID, notebookID)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	defer rows.Close()

	out := []notebook.Category{}
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// DeleteCategory removes a label; its links cascade, its notes do not.
func (s *NotebookStore) DeleteCategory(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM note_categories WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete category: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return notebook.ErrNotFound
	}
	return nil
}

// ─────────────────────────────────────────────────────────────── internals

func (s *NotebookStore) categoriesOf(ctx context.Context, userID, noteID uuid.UUID) ([]uuid.UUID, error) {
	byNote, err := s.categoriesFor(ctx, userID, []uuid.UUID{noteID})
	if err != nil {
		return nil, err
	}
	return byNote[noteID], nil
}

func (s *NotebookStore) categoriesFor(
	ctx context.Context, userID uuid.UUID, noteIDs []uuid.UUID,
) (map[uuid.UUID][]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.note_id, l.category_id
		  FROM note_category_links l
		  JOIN note_categories c ON c.id = l.category_id AND c.user_id = l.user_id
		 WHERE l.user_id = $1 AND l.note_id = ANY($2)
		 ORDER BY c.name`, userID, noteIDs)
	if err != nil {
		return nil, fmt.Errorf("read note categories: %w", err)
	}
	defer rows.Close()

	out := map[uuid.UUID][]uuid.UUID{}
	for rows.Next() {
		var noteID, catID uuid.UUID
		if err := rows.Scan(&noteID, &catID); err != nil {
			return nil, fmt.Errorf("scan note category: %w", err)
		}
		out[noteID] = append(out[noteID], catID)
	}
	return out, rows.Err()
}

func setCategories(ctx context.Context, tx pgx.Tx, userID, noteID uuid.UUID, ids []uuid.UUID) error {
	for _, id := range dedupe(ids) {
		// The insert names user_id, and the composite foreign keys mean a
		// category belonging to someone else cannot be linked even if a handler
		// forgot to check.
		_, err := tx.Exec(ctx, `
			INSERT INTO note_category_links (user_id, note_id, category_id)
			VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, userID, noteID, id)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" {
			// Someone else's category, or none: the same answer for both,
			// and a 404 rather than a 500 (isolation suite, audit F-8).
			return notebook.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("link note category: %w", err)
		}
	}
	return nil
}

func clearCategories(ctx context.Context, tx pgx.Tx, userID, noteID uuid.UUID) error {
	_, err := tx.Exec(ctx,
		`DELETE FROM note_category_links WHERE note_id = $1 AND user_id = $2`, noteID, userID)
	if err != nil {
		return fmt.Errorf("clear note categories: %w", err)
	}
	return nil
}

func touchNotebook(ctx context.Context, tx pgx.Tx, userID, notebookID uuid.UUID) error {
	_, err := tx.Exec(ctx,
		`UPDATE notebooks SET updated_at = now() WHERE id = $1 AND user_id = $2`, notebookID, userID)
	if err != nil {
		return fmt.Errorf("touch notebook: %w", err)
	}
	return nil
}

func dedupe(ids []uuid.UUID) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ids))
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if id == uuid.Nil || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

// nilUUID turns the Nil uuid into a SQL NULL, so one query serves both "this
// notebook" and "every notebook".
func nilUUID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func scanNotebook(row pgx.Row) (*notebook.Notebook, error) {
	var nb notebook.Notebook
	err := row.Scan(&nb.ID, &nb.UserID, &nb.Name, &nb.IsDefault, &nb.CreatedAt, &nb.UpdatedAt, &nb.NoteCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notebook.ErrNotFound
		}
		return nil, fmt.Errorf("scan notebook: %w", err)
	}
	return &nb, nil
}

func scanNote(row pgx.Row) (*notebook.Note, error) {
	var n notebook.Note
	var source []byte
	err := row.Scan(&n.ID, &n.UserID, &n.NotebookID, &n.Title, &n.BodyMD, &source,
		&n.CreatedBy, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notebook.ErrNotFound
		}
		return nil, fmt.Errorf("scan note: %w", err)
	}
	if len(source) > 0 {
		if err := json.Unmarshal(source, &n.Source); err != nil {
			return nil, fmt.Errorf("decode note source: %w", err)
		}
	}
	n.CategoryIDs = []uuid.UUID{}
	return &n, nil
}

func scanCategory(row pgx.Row) (*notebook.Category, error) {
	var c notebook.Category
	err := row.Scan(&c.ID, &c.UserID, &c.NotebookID, &c.Name, &c.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, notebook.ErrNotFound
		}
		return nil, fmt.Errorf("scan note category: %w", err)
	}
	return &c, nil
}
