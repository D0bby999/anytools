package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/citations"
)

// ResearchStore persists research_reports. Every query names user_id, for the
// reason ChatStore gives.
type ResearchStore struct {
	pool *Pool
}

// NewResearchStore builds a ResearchStore over the shared pool.
func NewResearchStore(pool *Pool) *ResearchStore { return &ResearchStore{pool: pool} }

const reportColumns = `id, user_id, session_id, turn_id, query, mode, report_md, sources,
	kb_only, kb_only_reason, note_id, verification, open_questions, engine, created_at`

// InsertReport writes one report.
func (s *ResearchStore) InsertReport(ctx context.Context, r research.Report) (*research.Report, error) {
	sources := r.Sources
	if sources == nil {
		sources = []citations.Source{}
	}
	raw, err := json.Marshal(sources)
	if err != nil {
		return nil, fmt.Errorf("insert report: encode sources: %w", err)
	}
	var check []byte
	if r.Verification != nil {
		if check, err = json.Marshal(r.Verification); err != nil {
			return nil, fmt.Errorf("insert report: encode verification: %w", err)
		}
	}
	open := r.OpenQuestions
	if open == nil {
		open = []string{}
	}
	openRaw, _ := json.Marshal(open)
	row := s.pool.QueryRow(ctx, `
		INSERT INTO research_reports
			(user_id, session_id, turn_id, query, mode, report_md, sources, kb_only, kb_only_reason,
			 verification, open_questions, engine)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11::jsonb, $12)
		RETURNING `+reportColumns,
		r.UserID, r.SessionID, r.TurnID, r.Query, r.Mode, r.ReportMD, raw, r.KBOnly, r.KBOnlyReason,
		check, openRaw, r.Engine)
	return scanReport(row)
}

// GetReport reads one report scoped to its owner.
func (s *ResearchStore) GetReport(ctx context.Context, userID, reportID uuid.UUID) (*research.Report, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+reportColumns+` FROM research_reports WHERE id = $1 AND user_id = $2`,
		reportID, userID)
	return scanReport(row)
}

// ListReports returns a user's reports, newest first.
func (s *ResearchStore) ListReports(ctx context.Context, userID uuid.UUID, limit int) ([]research.Report, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+reportColumns+` FROM research_reports
		 WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list reports: %w", err)
	}
	defer rows.Close()
	out := []research.Report{}
	for rows.Next() {
		r, err := scanReport(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// SetReportNote records the notebook entry a report was saved as.
func (s *ResearchStore) SetReportNote(ctx context.Context, userID, reportID uuid.UUID, noteID string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE research_reports SET note_id = $3 WHERE id = $1 AND user_id = $2`,
		reportID, userID, noteID)
	if err != nil {
		return fmt.Errorf("set report note: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return research.ErrNotFound
	}
	return nil
}

func scanReport(row rowScanner) (*research.Report, error) {
	var (
		r                  research.Report
		raw, check, openQs []byte
	)
	err := row.Scan(&r.ID, &r.UserID, &r.SessionID, &r.TurnID, &r.Query, &r.Mode, &r.ReportMD,
		&raw, &r.KBOnly, &r.KBOnlyReason, &r.NoteID, &check, &openQs, &r.Engine, &r.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, research.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan report: %w", err)
	}
	if err := json.Unmarshal(raw, &r.Sources); err != nil {
		return nil, fmt.Errorf("scan report: decode sources: %w", err)
	}
	if len(check) > 0 {
		var v research.Verification
		if err := json.Unmarshal(check, &v); err != nil {
			return nil, fmt.Errorf("scan report: decode verification: %w", err)
		}
		r.Verification = &v
	}
	if err := json.Unmarshal(openQs, &r.OpenQuestions); err != nil {
		return nil, fmt.Errorf("scan report: decode open questions: %w", err)
	}
	return &r, nil
}
