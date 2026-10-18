package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
)

// WorksheetStore holds up's worksheets (migration 1789945000). Every statement
// names the caller's user_id, and the composite foreign keys to
// learning_states and documents (id, user_id) refuse another user's
// attachment even if a caller forgot to check.
//
// Nothing outside internal/learning/worksheet and this file reads
// worksheets.answers except the export and phase 4's diagnosis (plan
// principle 5). Lists read metadata only.
//
// Recordings (phase 7, worksheet_recordings.go) are files in an ObjectStore,
// so the store that deletes a worksheet needs it: objects go before rows.
type WorksheetStore struct {
	pool    *Pool
	objects blob.ObjectStore
}

// NewWorksheetStore builds the store.
func NewWorksheetStore(pool *Pool) *WorksheetStore { return &WorksheetStore{pool: pool} }

// WithObjects gives the store the ObjectStore its recordings live in.
// Without it, uploads are refused and a worksheet that holds recordings
// cannot be deleted.
func (s *WorksheetStore) WithObjects(objects blob.ObjectStore) *WorksheetStore {
	s.objects = objects
	return s
}

const worksheetColumns = `id, user_id, kind, kind_version, title, answers, state_id, document_id, cycle_id,
	status, private, reviews, section_revs, created_at, updated_at`

// Create inserts a worksheet. The attachment is named with the owner inside
// the INSERT, so a foreign state, document or cycle inserts nothing:
// ErrNotFound. A second close of one cycle is ErrCycleClosed (the unique
// index, phase 10).
func (s *WorksheetStore) Create(ctx context.Context, w worksheet.Worksheet) (*worksheet.Worksheet, error) {
	answers, err := json.Marshal(w.Answers)
	if err != nil {
		return nil, err
	}
	reviews, err := json.Marshal(w.Reviews)
	if err != nil {
		return nil, err
	}
	out, err := scanWorksheet(s.pool.QueryRow(ctx, `
		INSERT INTO worksheets (user_id, kind, kind_version, title, answers, state_id, document_id, status, private, reviews,
		                        cycle_id)
		SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
		 WHERE ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM learning_states WHERE id = $6 AND user_id = $1))
		   AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM documents WHERE id = $7 AND user_id = $1))
		   AND ($11::uuid IS NULL OR EXISTS (SELECT 1 FROM cycles WHERE id = $11 AND user_id = $1))
		RETURNING `+worksheetColumns,
		w.UserID, w.Kind, w.KindVersion, w.Title, answers, w.StateID, w.DocumentID, w.Status, w.Private, reviews,
		w.CycleID))
	if isUniqueViolation(err, "worksheets_cycle_unique") {
		return nil, worksheet.ErrCycleClosed
	}
	if errors.Is(err, worksheet.ErrNotFound) || isForeignKeyViolation(err) {
		return nil, worksheet.ErrNotFound
	}
	if out != nil {
		out.Recordings = []worksheet.Recording{}
	}
	return out, err
}

// StateExists reports whether the learning state is the user's.
func (s *WorksheetStore) StateExists(ctx context.Context, userID, stateID uuid.UUID) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM learning_states WHERE id = $1 AND user_id = $2)`,
		stateID, userID).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("worksheet state: %w", err)
	}
	return ok, nil
}

// DocumentSource is the user's document's source kind, or ErrNotFound.
func (s *WorksheetStore) DocumentSource(ctx context.Context, userID, documentID uuid.UUID) (string, error) {
	var source string
	err := s.pool.QueryRow(ctx, `SELECT source_kind FROM documents WHERE id = $1 AND user_id = $2`,
		documentID, userID).Scan(&source)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", worksheet.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("worksheet document: %w", err)
	}
	return source, nil
}

// CycleState is the learning state of the user's cycle, or ErrNotFound.
func (s *WorksheetStore) CycleState(ctx context.Context, userID, cycleID uuid.UUID) (uuid.UUID, error) {
	var state uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT state_id FROM cycles WHERE id = $1 AND user_id = $2`,
		cycleID, userID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, worksheet.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("worksheet cycle: %w", err)
	}
	return state, nil
}

// CycleCloses reads the close of the user's cycle (metadata only) and the
// close of the cycle that started just before it in the same learning state
// (whole, answers included: the next cycle starts from its destinations).
// Every statement names the owner.
func (s *WorksheetStore) CycleCloses(ctx context.Context, userID, cycleID uuid.UUID) (*worksheet.Summary, *worksheet.Worksheet, error) {
	var state uuid.UUID
	var started time.Time
	err := s.pool.QueryRow(ctx, `SELECT state_id, started_at FROM cycles WHERE id = $1 AND user_id = $2`,
		cycleID, userID).Scan(&state, &started)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, worksheet.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("cycle closes: %w", err)
	}
	list, err := s.summaries(ctx, `
		SELECT `+summaryColumns+` FROM worksheets WHERE user_id = $1 AND cycle_id = $2`, userID, cycleID)
	if err != nil {
		return nil, nil, err
	}
	var current *worksheet.Summary
	if len(list) > 0 {
		current = &list[0]
	}
	previous, err := scanWorksheet(s.pool.QueryRow(ctx, `
		SELECT `+worksheetColumns+`
		  FROM worksheets
		 WHERE user_id = $1
		   AND cycle_id = (SELECT id FROM cycles
		                    WHERE user_id = $1 AND state_id = $2 AND (started_at, id) < ($3, $4)
		                    ORDER BY started_at DESC, id DESC
		                    LIMIT 1)`, userID, state, started, cycleID))
	if errors.Is(err, worksheet.ErrNotFound) {
		return current, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return current, previous, nil
}

// Get reads one worksheet, with its recordings.
func (s *WorksheetStore) Get(ctx context.Context, userID, id uuid.UUID) (*worksheet.Worksheet, error) {
	w, err := scanWorksheet(s.pool.QueryRow(ctx,
		`SELECT `+worksheetColumns+` FROM worksheets WHERE id = $1 AND user_id = $2`, id, userID))
	if err != nil {
		return nil, err
	}
	if w.Recordings, err = listRecordings(ctx, s.pool, userID, id); err != nil {
		return nil, err
	}
	return w, nil
}

// summaryColumns are a list's columns: metadata, never answers.
const summaryColumns = `id, kind, title, status, private, state_id, document_id, cycle_id, reviews, updated_at`

// List reads metadata — never answers — newest first, at most f.Limit rows.
func (s *WorksheetStore) List(ctx context.Context, userID uuid.UUID, f worksheet.Filter) ([]worksheet.Summary, error) {
	return s.summaries(ctx, `
		SELECT `+summaryColumns+`
		  FROM worksheets
		 WHERE user_id = $1
		   AND ($2 = '' OR kind = $2)
		   AND ($3::uuid IS NULL OR state_id = $3)
		   AND ($4::uuid IS NULL OR document_id = $4)
		 ORDER BY updated_at DESC, id
		 LIMIT $5`, userID, f.Kind, f.StateID, f.DocumentID, f.Limit)
}

func (s *WorksheetStore) summaries(ctx context.Context, query string, args ...any) ([]worksheet.Summary, error) {
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list worksheets: %w", err)
	}
	defer rows.Close()
	out := []worksheet.Summary{}
	for rows.Next() {
		var w worksheet.Summary
		var reviews []byte
		if err := rows.Scan(&w.ID, &w.Kind, &w.Title, &w.Status, &w.Private, &w.StateID, &w.DocumentID,
			&w.CycleID, &reviews, &w.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(reviews, &w.Reviews); err != nil {
			return nil, fmt.Errorf("worksheet %s reviews: %w", w.ID, err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// Update locks the row, lets fn decide, and writes each named section with
// jsonb_set — a write never rewrites a section it does not name. The new
// revision is strictly after the old one, so two writes in the same
// microsecond still differ.
func (s *WorksheetStore) Update(
	ctx context.Context, userID, id uuid.UUID, fn func(*worksheet.Worksheet) (*worksheet.Write, error),
) (*worksheet.Worksheet, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	w, err := scanWorksheet(tx.QueryRow(ctx,
		`SELECT `+worksheetColumns+` FROM worksheets WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID))
	if err != nil {
		return nil, err
	}
	// Read under the row lock, which every recording write takes first: an
	// audio value is checked against exactly the recordings that exist.
	if w.Recordings, err = listRecordings(ctx, tx, userID, id); err != nil {
		return nil, err
	}
	write, err := fn(w)
	if err != nil {
		return nil, err
	}
	var rev time.Time
	if err := tx.QueryRow(ctx, `SELECT greatest(clock_timestamp(), $1::timestamptz + interval '1 microsecond')`,
		w.UpdatedAt).Scan(&rev); err != nil {
		return nil, err
	}
	for section, fields := range write.Sections {
		raw, err := json.Marshal(fields)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE worksheets SET answers = jsonb_set(answers, ARRAY[$3::text], $4::jsonb)
			 WHERE id = $1 AND user_id = $2`, id, userID, section, raw); err != nil {
			return nil, fmt.Errorf("write worksheet section: %w", err)
		}
	}
	revs := map[string]time.Time{}
	for _, key := range write.Touched {
		revs[key] = rev
	}
	revsJSON, err := json.Marshal(revs)
	if err != nil {
		return nil, err
	}
	var reviews []byte
	if write.Reviews != nil {
		if reviews, err = json.Marshal(write.Reviews); err != nil {
			return nil, err
		}
	}
	out, err := scanWorksheet(tx.QueryRow(ctx, `
		UPDATE worksheets SET
			title = COALESCE($3, title),
			status = COALESCE($4, status),
			reviews = COALESCE($5::jsonb, reviews),
			section_revs = section_revs || $6::jsonb,
			updated_at = $7
		 WHERE id = $1 AND user_id = $2
		RETURNING `+worksheetColumns,
		id, userID, write.Title, write.Status, reviews, revsJSON, rev))
	if err != nil {
		return nil, err
	}
	out.Recordings = w.Recordings
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// Delete removes a worksheet. Its recordings' files go first, under the row
// lock, then the row, whose recordings cascade. There is no background
// reaper of objects, so a file that cannot be deleted fails the request with
// everything kept, and it can be retried.
func (s *WorksheetStore) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var locked uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM worksheets WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return worksheet.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("delete worksheet: %w", err)
	}
	recs, err := listRecordings(ctx, tx, userID, id)
	if err != nil {
		return err
	}
	if err := s.deleteFiles(ctx, userID, recs); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM worksheets WHERE id = $1 AND user_id = $2`, id, userID); err != nil {
		return fmt.Errorf("delete worksheet: %w", err)
	}
	return tx.Commit(ctx)
}

// Due lists open worksheets' reviews that are not done and fall on or before
// today (the learner's local date, computed in Go). A private worksheet's
// title is not even read: the column is replaced in SQL.
func (s *WorksheetStore) Due(ctx context.Context, userID uuid.UUID, today string, limit int) ([]worksheet.DueReview, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT w.id, w.kind, CASE WHEN w.private THEN '' ELSE w.title END, w.private,
		       r.key, r.value->>'due'
		  FROM worksheets w, jsonb_each(w.reviews) r
		 WHERE w.user_id = $1 AND w.status = 'open'
		   AND (r.value->>'due')::date <= $2::date
		   AND NOT COALESCE((r.value->>'done')::boolean, false)
		 ORDER BY (r.value->>'due')::date, w.id, r.key
		 LIMIT $3`, userID, today, limit)
	if err != nil {
		return nil, fmt.Errorf("due worksheets: %w", err)
	}
	defer rows.Close()
	out := []worksheet.DueReview{}
	for rows.Next() {
		var d worksheet.DueReview
		if err := rows.Scan(&d.ID, &d.Kind, &d.Title, &d.Private, &d.Review, &d.Due); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func scanWorksheet(row pgx.Row) (*worksheet.Worksheet, error) {
	var w worksheet.Worksheet
	var answers, reviews, revs []byte
	err := row.Scan(&w.ID, &w.UserID, &w.Kind, &w.KindVersion, &w.Title, &answers, &w.StateID, &w.DocumentID,
		&w.CycleID, &w.Status, &w.Private, &reviews, &revs, &w.CreatedAt, &w.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, worksheet.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("worksheet: %w", err)
	}
	if err := json.Unmarshal(answers, &w.Answers); err != nil {
		return nil, fmt.Errorf("worksheet %s answers: %w", w.ID, err)
	}
	if err := json.Unmarshal(reviews, &w.Reviews); err != nil {
		return nil, fmt.Errorf("worksheet %s reviews: %w", w.ID, err)
	}
	if err := json.Unmarshal(revs, &w.SectionRevs); err != nil {
		return nil, fmt.Errorf("worksheet %s revisions: %w", w.ID, err)
	}
	return &w, nil
}
