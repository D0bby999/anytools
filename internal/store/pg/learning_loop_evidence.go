package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// ──────────────────────────────────────────────────────────── evidence refs

const evidenceColumns = `id, user_id, review_id, chain_id, COALESCE(timepoint, ''), kind, ref_id, note,
	status, suggested_by, created_at, updated_at`

// OwnsTarget reports whether userID owns the row an evidence ref would name.
//
// ref_id cannot carry a foreign key (it names eight tables), so this is the
// check that stands in for one, and the service runs it on every write.
// An unknown kind answers false: a kind whose ownership cannot be proven
// cannot be attached.
func (s *LoopStore) OwnsTarget(ctx context.Context, userID uuid.UUID, kind string, refID uuid.UUID) (bool, error) {
	var sql string
	switch kind {
	case loop.KindQuestionAttempt:
		sql = `SELECT EXISTS (SELECT 1 FROM question_attempts WHERE id = $1 AND user_id = $2)`
	case loop.KindKPState:
		sql = `SELECT EXISTS (SELECT 1 FROM kp_state WHERE kp_id = $1 AND user_id = $2)`
	case loop.KindNote:
		sql = `SELECT EXISTS (SELECT 1 FROM notes WHERE id = $1 AND user_id = $2)`
	case loop.KindChatMessage:
		sql = `SELECT EXISTS (SELECT 1 FROM chat_messages WHERE id = $1 AND user_id = $2)`
	case loop.KindResearchReport:
		sql = `SELECT EXISTS (SELECT 1 FROM research_reports WHERE id = $1 AND user_id = $2)`
	case loop.KindExplainBack:
		sql = `SELECT EXISTS (SELECT 1 FROM explain_back_attempts WHERE id = $1 AND user_id = $2)`
	case loop.KindCardEntry:
		sql = `SELECT EXISTS (SELECT 1 FROM card_entries WHERE id = $1 AND user_id = $2)`
	case loop.KindWorksheet:
		// A private worksheet is not the owner's to attach either: every
		// write path that names one is refused (plan principle 5).
		sql = `SELECT EXISTS (SELECT 1 FROM worksheets WHERE id = $1 AND user_id = $2 AND NOT private)`
	default:
		return false, nil
	}
	var ok bool
	if err := s.pool.QueryRow(ctx, sql, refID, userID).Scan(&ok); err != nil {
		return false, fmt.Errorf("evidence target ownership: %w", err)
	}
	return ok, nil
}

// AddEvidence inserts a ref, or — when the same target is already on the same
// review, or at the same timepoint of the same chain — accepts that one. That
// makes "accept a suggestion" and "add evidence" one idempotent call.
func (s *LoopStore) AddEvidence(ctx context.Context, e loop.EvidenceRef) (*loop.EvidenceRef, error) {
	conflict := `(review_id, kind, ref_id) WHERE review_id IS NOT NULL AND chain_id IS NULL`
	if e.ChainID != nil {
		conflict = `(chain_id, timepoint, kind, ref_id) WHERE chain_id IS NOT NULL`
	}
	// The parent is named with the owner, so a foreign review or chain id finds
	// nothing to insert from and the caller sees ErrNotFound.
	row := s.pool.QueryRow(ctx, `
		INSERT INTO evidence_refs (user_id, review_id, chain_id, timepoint, kind, ref_id, note, status, suggested_by)
		SELECT $1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9
		 WHERE ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM weekly_reviews WHERE id = $2 AND user_id = $1))
		   AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM evidence_chains WHERE id = $3 AND user_id = $1))
		ON CONFLICT `+conflict+` DO UPDATE
		   SET status = EXCLUDED.status,
		       timepoint = COALESCE(EXCLUDED.timepoint, evidence_refs.timepoint),
		       note = CASE WHEN EXCLUDED.note = '' THEN evidence_refs.note ELSE EXCLUDED.note END,
		       updated_at = now()
		RETURNING `+evidenceColumns,
		e.UserID, e.ReviewID, e.ChainID, e.Timepoint, e.Kind, e.RefID, e.Note, e.Status, e.SuggestedBy)
	ref, err := scanEvidence(row)
	if err != nil {
		return nil, err
	}
	if err := s.resolveTargets(ctx, e.UserID, []*loop.EvidenceRef{ref}); err != nil {
		return nil, err
	}
	return ref, nil
}

// ListEvidence returns the refs on one review or one chain, targets resolved.
func (s *LoopStore) ListEvidence(
	ctx context.Context, userID uuid.UUID, reviewID, chainID *uuid.UUID,
) ([]loop.EvidenceRef, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+evidenceColumns+` FROM evidence_refs
		 WHERE user_id = $1
		   AND ($2::uuid IS NULL OR review_id = $2)
		   AND ($3::uuid IS NULL OR chain_id = $3)
		   AND ($2::uuid IS NOT NULL OR $3::uuid IS NOT NULL)
		 ORDER BY created_at, id`, userID, reviewID, chainID)
	if err != nil {
		return nil, fmt.Errorf("list evidence: %w", err)
	}
	defer rows.Close()
	out := []loop.EvidenceRef{}
	for rows.Next() {
		r, err := scanEvidence(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	ptrs := make([]*loop.EvidenceRef, len(out))
	for i := range out {
		ptrs[i] = &out[i]
	}
	return out, s.resolveTargets(ctx, userID, ptrs)
}

// UpdateEvidence changes a ref's status, timepoint or note.
func (s *LoopStore) UpdateEvidence(
	ctx context.Context, userID, id uuid.UUID, p loop.EvidencePatch,
) (*loop.EvidenceRef, error) {
	ref, err := scanEvidence(s.pool.QueryRow(ctx, `
		UPDATE evidence_refs
		   SET status = COALESCE($3, status),
		       timepoint = CASE WHEN $4::text IS NULL THEN timepoint ELSE NULLIF($4, '') END,
		       note = COALESCE($5, note),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+evidenceColumns, id, userID, p.Status, p.Timepoint, p.Note))
	if err != nil {
		return nil, err
	}
	return ref, s.resolveTargets(ctx, userID, []*loop.EvidenceRef{ref})
}

// GetEvidence reads one ref scoped to its owner, target resolved.
func (s *LoopStore) GetEvidence(ctx context.Context, userID, id uuid.UUID) (*loop.EvidenceRef, error) {
	ref, err := scanEvidence(s.pool.QueryRow(ctx,
		`SELECT `+evidenceColumns+` FROM evidence_refs WHERE id = $1 AND user_id = $2`, id, userID))
	if err != nil {
		return nil, err
	}
	return ref, s.resolveTargets(ctx, userID, []*loop.EvidenceRef{ref})
}

// DeleteEvidence removes a ref.
func (s *LoopStore) DeleteEvidence(ctx context.Context, userID, id uuid.UUID) error {
	return execOne(ctx, s.pool, `DELETE FROM evidence_refs WHERE id = $1 AND user_id = $2`, id, userID)
}

func scanEvidence(row pgx.Row) (*loop.EvidenceRef, error) {
	var e loop.EvidenceRef
	if err := row.Scan(&e.ID, &e.UserID, &e.ReviewID, &e.ChainID, &e.Timepoint, &e.Kind, &e.RefID,
		&e.Note, &e.Status, &e.SuggestedBy, &e.CreatedAt, &e.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan evidence ref")
	}
	return &e, nil
}
