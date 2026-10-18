package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/writingdiag"
)

// WorksheetDiagnosisStore holds the writing evidence card's per-pass
// diagnoses (migration 1790020000). It never reads or writes a worksheet's
// answers: the draft is read through the worksheet store, and a diagnosis is
// its own row. Every statement names the caller's user_id, and the composite
// foreign key to worksheets (id, user_id) refuses a diagnosis on another
// user's worksheet even if a caller forgot to check.
type WorksheetDiagnosisStore struct{ pool *Pool }

// NewWorksheetDiagnosisStore builds the store.
func NewWorksheetDiagnosisStore(pool *Pool) *WorksheetDiagnosisStore {
	return &WorksheetDiagnosisStore{pool: pool}
}

const diagnosisColumns = `id, worksheet_id, pass, draft_sha256, issues, model, created_at`

func scanDiagnosis(row pgx.Row) (*writingdiag.Diagnosis, error) {
	var d writingdiag.Diagnosis
	var raw []byte
	var pass int16
	if err := row.Scan(&d.ID, &d.WorksheetID, &pass, &d.DraftSHA256, &raw, &d.Model, &d.CreatedAt); err != nil {
		return nil, err
	}
	d.Pass = int(pass)
	if err := json.Unmarshal(raw, &d.Issues); err != nil {
		return nil, fmt.Errorf("worksheet diagnosis %s: %w", d.ID, err)
	}
	return &d, nil
}

// Find is one pass's diagnosis of one draft, or nil.
func (s *WorksheetDiagnosisStore) Find(ctx context.Context, userID, worksheetID uuid.UUID, pass int, draftSHA256 string) (*writingdiag.Diagnosis, error) {
	d, err := scanDiagnosis(s.pool.QueryRow(ctx, `
		SELECT `+diagnosisColumns+` FROM worksheet_diagnoses
		 WHERE user_id = $1 AND worksheet_id = $2 AND pass = $3 AND draft_sha256 = $4`,
		userID, worksheetID, pass, draftSHA256))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find worksheet diagnosis: %w", err)
	}
	return d, nil
}

// Save stores a diagnosis. Two requests racing for the same pass and draft
// both get the first one stored.
func (s *WorksheetDiagnosisStore) Save(ctx context.Context, userID uuid.UUID, d writingdiag.Diagnosis) (*writingdiag.Diagnosis, error) {
	issues, err := json.Marshal(d.Issues)
	if err != nil {
		return nil, err
	}
	saved, err := scanDiagnosis(s.pool.QueryRow(ctx, `
		INSERT INTO worksheet_diagnoses (user_id, worksheet_id, pass, draft_sha256, issues, model, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (worksheet_id, pass, draft_sha256) DO NOTHING
		RETURNING `+diagnosisColumns,
		userID, d.WorksheetID, d.Pass, d.DraftSHA256, issues, d.Model, d.CreatedAt))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		existing, err := s.Find(ctx, userID, d.WorksheetID, d.Pass, d.DraftSHA256)
		if err == nil && existing == nil {
			// The conflicting row is not this user's: the worksheet is not
			// theirs either.
			return nil, writingdiag.ErrNotFound
		}
		return existing, err
	case isForeignKeyViolation(err):
		// The worksheet was deleted meanwhile, or was never the caller's.
		return nil, writingdiag.ErrNotFound
	case err != nil:
		return nil, fmt.Errorf("save worksheet diagnosis: %w", err)
	}
	return saved, nil
}

// List is one draft's diagnoses, by pass.
func (s *WorksheetDiagnosisStore) List(ctx context.Context, userID, worksheetID uuid.UUID, draftSHA256 string) ([]writingdiag.Diagnosis, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+diagnosisColumns+` FROM worksheet_diagnoses
		 WHERE user_id = $1 AND worksheet_id = $2 AND draft_sha256 = $3
		 ORDER BY pass`, userID, worksheetID, draftSHA256)
	if err != nil {
		return nil, fmt.Errorf("list worksheet diagnoses: %w", err)
	}
	defer rows.Close()
	out := []writingdiag.Diagnosis{}
	for rows.Next() {
		d, err := scanDiagnosis(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}
