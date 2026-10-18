package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/learning/loop"
)

// mastery_learn.go is the persistence of learning-depth phase 2: cached
// explanations, explain-back attempts, and the second write path into
// kp_state (RateKnowledgePoint). A file of its own so the question-attempt
// half in mastery.go and questions.go stays as it was.

// awaitingExplain is the SQL test for "this point's next step is an
// explain-back": a concept or design point, not yet passed, with a correct
// answer that no explain-back has followed. An `unjudged` attempt does not
// count — the learner was never told anything. Aliases: kp, st.
const awaitingExplain = `kp.type IN ('concept', 'design')
	AND st.explain_passed_at IS NULL
	AND EXISTS (
	    SELECT 1 FROM question_attempts a
	     WHERE a.user_id = kp.user_id AND a.knowledge_point_id = kp.id AND a.is_correct
	       AND NOT EXISTS (
	           SELECT 1 FROM explain_back_attempts e
	            WHERE e.user_id = kp.user_id AND e.kp_id = kp.id
	              AND e.verdict <> 'unjudged' AND e.created_at >= a.created_at))`

// PointProgress reads what Next decides on.
func (s *MasteryStore) PointProgress(ctx context.Context, userID, kpID uuid.UUID) (*mastery.PointProgress, error) {
	var p mastery.PointProgress
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM question_attempts a
		                WHERE a.user_id = kp.user_id AND a.knowledge_point_id = kp.id AND a.is_correct),
		       EXISTS (SELECT 1 FROM kp_explanations x WHERE x.user_id = kp.user_id AND x.kp_id = kp.id)
		       OR EXISTS (SELECT 1 FROM mastery_events ev
		                   WHERE ev.user_id = kp.user_id AND ev.type = $3
		                     AND ev.payload->>'knowledge_point_id' = kp.id::text),
		       COALESCE(st.explain_passed_at IS NOT NULL, false),
		       COALESCE(`+awaitingExplain+`, false)
		  FROM knowledge_points kp
		  LEFT JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		 WHERE kp.id = $2 AND kp.user_id = $1`, userID, kpID, mastery.EventTeachFailed).
		Scan(&p.HasCorrect, &p.Taught, &p.ExplainPassed, &p.AwaitingExplain)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("point progress: %w", err)
	}
	return &p, nil
}

// AwaitingExplainBack lists the path's active points waiting for an
// explain-back, the one waiting longest first.
func (s *MasteryStore) AwaitingExplainBack(ctx context.Context, userID, pathID uuid.UUID) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kp.id
		  FROM knowledge_points kp
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		  JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		 WHERE kp.user_id = $1 AND m.path_id = $2 AND st.status = 'active'
		   AND `+awaitingExplain+`
		 ORDER BY st.updated_at, kp.id`, userID, pathID)
	if err != nil {
		return nil, fmt.Errorf("awaiting explain-back: %w", err)
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("awaiting explain-back: scan: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ── cached explanations ───────────────────────────────────────────────────

// Explanation reads one cached variant. Stale is decided here, against the
// caller's documents: a cited document whose version moved, or that is gone,
// makes the entry stale. The document ids come out of jsonb and are resolved
// with the owner's id, as every id read from jsonb is.
func (s *MasteryStore) Explanation(
	ctx context.Context, userID, kpID uuid.UUID, model string, variant int,
) (*mastery.Explanation, error) {
	var (
		e       mastery.Explanation
		sources []byte
	)
	err := s.pool.QueryRow(ctx, `
		SELECT x.id, x.user_id, x.kp_id, x.model, x.variant, x.body_md, x.sources, x.created_at,
		       EXISTS (
		           SELECT 1 FROM jsonb_to_recordset(x.source_versions) AS v(document_id uuid, version integer)
		             LEFT JOIN documents d ON d.id = v.document_id AND d.user_id = x.user_id
		            WHERE d.id IS NULL OR d.version <> v.version)
		  FROM kp_explanations x
		 WHERE x.user_id = $1 AND x.kp_id = $2 AND x.model = $3 AND x.variant = $4`,
		userID, kpID, model, variant).
		Scan(&e.ID, &e.UserID, &e.KnowledgePointID, &e.Model, &e.Variant, &e.BodyMD, &sources, &e.CreatedAt, &e.Stale)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("explanation: %w", err)
	}
	if err := json.Unmarshal(sources, &e.Sources); err != nil {
		return nil, fmt.Errorf("explanation: decode sources: %w", err)
	}
	return &e, nil
}

// SaveExplanation writes one variant, replacing an older one of the same key
// (a refresh after the sources changed, or a different angle asked again).
func (s *MasteryStore) SaveExplanation(
	ctx context.Context, e mastery.Explanation, versions []mastery.DocVersion,
) (*mastery.Explanation, error) {
	sources, err := json.Marshal(nonNilCitations(e.Sources))
	if err != nil {
		return nil, fmt.Errorf("save explanation: encode sources: %w", err)
	}
	if versions == nil {
		versions = []mastery.DocVersion{}
	}
	vers, err := json.Marshal(versions)
	if err != nil {
		return nil, fmt.Errorf("save explanation: encode versions: %w", err)
	}
	out := e
	err = s.pool.QueryRow(ctx, `
		INSERT INTO kp_explanations (user_id, kp_id, model, variant, body_md, sources, source_versions)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, kp_id, model, variant) DO UPDATE
		   SET body_md = EXCLUDED.body_md, sources = EXCLUDED.sources,
		       source_versions = EXCLUDED.source_versions, created_at = now()
		RETURNING id, created_at`,
		e.UserID, e.KnowledgePointID, e.Model, e.Variant, e.BodyMD, sources, vers).
		Scan(&out.ID, &out.CreatedAt)
	if isForeignKeyViolation(err) {
		// The point went (its path was re-planned or deleted) while the model
		// was writing; nothing of the caller's is there to cache against.
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("save explanation: %w", err)
	}
	out.Sources = nonNilCitations(out.Sources)
	return &out, nil
}

// DocumentVersions reads the caller's documents' current versions.
func (s *MasteryStore) DocumentVersions(ctx context.Context, userID uuid.UUID, docIDs []uuid.UUID) ([]mastery.DocVersion, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, version FROM documents WHERE user_id = $1 AND id = ANY($2) ORDER BY id`, userID, docIDs)
	if err != nil {
		return nil, fmt.Errorf("document versions: %w", err)
	}
	defer rows.Close()
	out := []mastery.DocVersion{}
	for rows.Next() {
		var v mastery.DocVersion
		if err := rows.Scan(&v.DocumentID, &v.Version); err != nil {
			return nil, fmt.Errorf("document versions: scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ResolveSources re-reads chunk ids as citable sources, scoped to the owner.
// The same query the quiz bank uses, so a chip means one thing everywhere.
func (s *MasteryStore) ResolveSources(ctx context.Context, userID uuid.UUID, chunkIDs []uuid.UUID) ([]citations.Source, error) {
	return (&QuestionStore{pool: s.pool}).Sources(ctx, userID, chunkIDs)
}

// ── explain-back attempts ─────────────────────────────────────────────────

const explainColumns = `id, user_id, kp_id, path_id, request_id, explanation, verdict,
	gaps, misconceptions, feedback, sources, model, override_passed, overridden_at, judged_at, created_at`

// ReserveExplainBack inserts the pending attempt, or returns the one this
// request id already made. The unique key is (user_id, request_id): another
// user's identical request id is a different row, never theirs.
func (s *MasteryStore) ReserveExplainBack(
	ctx context.Context, a mastery.ExplainBackAttempt,
) (*mastery.ExplainBackAttempt, bool, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO explain_back_attempts (user_id, kp_id, path_id, request_id, explanation)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, request_id) DO NOTHING
		RETURNING `+explainColumns,
		a.UserID, a.KnowledgePointID, a.PathID, a.RequestID, a.Explanation)
	created, err := scanExplainBack(row)
	if err == nil {
		return created, true, nil
	}
	if !errors.Is(err, mastery.ErrNotFound) {
		if isForeignKeyViolation(err) {
			return nil, false, mastery.ErrNotFound
		}
		return nil, false, fmt.Errorf("reserve explain-back: %w", err)
	}
	existing, err := scanExplainBack(s.pool.QueryRow(ctx,
		`SELECT `+explainColumns+` FROM explain_back_attempts WHERE user_id = $1 AND request_id = $2`,
		a.UserID, a.RequestID))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

// ReleaseExplainBack drops a reservation that was never judged.
func (s *MasteryStore) ReleaseExplainBack(ctx context.Context, userID, attemptID uuid.UUID) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM explain_back_attempts WHERE id = $1 AND user_id = $2 AND verdict = 'pending'`,
		attemptID, userID); err != nil {
		return fmt.Errorf("release explain-back: %w", err)
	}
	return nil
}

// RecordExplainVerdict writes the verdict and rates the point in ONE
// transaction: a verdict without its rating is a pass the schedule never saw,
// and a rating without its verdict is a review with no evidence behind it.
//
// `unjudged` writes the record and rates nothing: a reply that could not be
// read says nothing about the learner.
func (s *MasteryStore) RecordExplainVerdict(
	ctx context.Context, userID, attemptID uuid.UUID, v mastery.ExplainVerdict, now time.Time,
) (*mastery.ExplainBackAttempt, *quiz.Scheduled, error) {
	switch v.Verdict {
	case mastery.VerdictPassed, mastery.VerdictFailed, mastery.VerdictUnjudged:
	default:
		return nil, nil, fmt.Errorf("record explain verdict: %q is not a verdict", v.Verdict)
	}
	gaps, _ := json.Marshal(nonNilStrings(v.Gaps))
	misconceptions, _ := json.Marshal(nonNilStrings(v.Misconceptions))
	sources, err := json.Marshal(nonNilCitations(v.Sources))
	if err != nil {
		return nil, nil, fmt.Errorf("record explain verdict: encode sources: %w", err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("record explain verdict: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		kpID    uuid.UUID
		verdict string
	)
	err = tx.QueryRow(ctx,
		`SELECT kp_id, verdict FROM explain_back_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		attemptID, userID).Scan(&kpID, &verdict)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("record explain verdict: load: %w", err)
	}
	if verdict != mastery.VerdictPending {
		// Judged already: never rate twice for one explanation.
		return nil, nil, fmt.Errorf("%w: this explanation has already been judged", mastery.ErrBadRequest)
	}

	attempt, err := scanExplainBack(tx.QueryRow(ctx, `
		UPDATE explain_back_attempts
		   SET verdict = $3, gaps = $4, misconceptions = $5, feedback = $6, sources = $7,
		       model = $8, judged_at = now()
		 WHERE id = $1 AND user_id = $2
		 RETURNING `+explainColumns,
		attemptID, userID, v.Verdict, gaps, misconceptions, v.Feedback, sources, v.Model))
	if err != nil {
		return nil, nil, err
	}

	var scheduled *quiz.Scheduled
	if v.Verdict != mastery.VerdictUnjudged {
		scheduled, err = s.rateKnowledgePoint(ctx, tx, userID, kpID, explainRating(v.Verdict == mastery.VerdictPassed),
			RatingSource{Kind: loop.KindExplainBack, ID: attemptID}, now)
		if err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("record explain verdict: commit: %w", err)
	}
	return attempt, scheduled, nil
}

// explainRating: a pass is `good` (it does not graduate the point by itself),
// a failure is `hard` with a near due date (rateKnowledgePoint caps it).
func explainRating(passed bool) string {
	if passed {
		return learning.RatingGood
	}
	return learning.RatingHard
}

// RatingSource names the evidence behind a rating: which row gets the
// before-snapshot, so an override can replay from it.
type RatingSource struct {
	Kind string
	ID   uuid.UUID
}

// RateKnowledgePoint applies one rating to a knowledge point outside a
// question attempt, under the same row lock QuestionStore.advance takes.
//
// It is the second write path into kp_state, and the only one that does not
// need a question: explain-back verdicts go through it (red team AS-3). A
// `good` or `easy` rating from an explain-back sets explain_passed_at; any
// other clears it, because the latest explanation is what the gate trusts.
func (s *MasteryStore) RateKnowledgePoint(
	ctx context.Context, userID, kpID uuid.UUID, rating string, src RatingSource, now time.Time,
) (*quiz.Scheduled, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("rate knowledge point: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	scheduled, err := s.rateKnowledgePoint(ctx, tx, userID, kpID, rating, src, now)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("rate knowledge point: commit: %w", err)
	}
	return scheduled, nil
}

// explainSnapshot is kpSnapshot plus the gate column, stored on an
// explain-back attempt as `kp_before`.
type explainSnapshot struct {
	kpSnapshot
	ExplainPassedAt *time.Time `json:"explain_passed_at,omitempty"`
}

func (s *MasteryStore) rateKnowledgePoint(
	ctx context.Context, tx pgx.Tx, userID, kpID uuid.UUID, rating string, src RatingSource, now time.Time,
) (*quiz.Scheduled, error) {
	if src.Kind != loop.KindExplainBack {
		return nil, fmt.Errorf("rate knowledge point: unsupported source %q", src.Kind)
	}
	now = now.UTC()
	passed := rating == learning.RatingGood || rating == learning.RatingEasy

	// Seed, then lock — the same order and the same reason as advance: the
	// snapshot must record whether THIS transaction created the card.
	fresh := s.sched.NewCard(now)
	freshJSON, err := json.Marshal(fresh)
	if err != nil {
		return nil, fmt.Errorf("rate knowledge point: encode new card: %w", err)
	}
	var seeded uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO kp_state (kp_id, user_id, fsrs_card, due_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (kp_id) DO NOTHING
		RETURNING kp_id`, kpID, userID, freshJSON, fresh.Due).Scan(&seeded)
	created := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		if isForeignKeyViolation(err) {
			return nil, mastery.ErrNotFound
		}
		return nil, fmt.Errorf("rate knowledge point: seed card: %w", err)
	}

	var (
		snap     explainSnapshot
		cardJSON []byte
		zone     string
	)
	err = tx.QueryRow(ctx, `
		SELECT st.fsrs_card, st.due_at, st.mastery_estimate, st.status, st.reviews, st.lapses,
		       st.explain_passed_at, u.timezone
		  FROM kp_state st
		  JOIN users u ON u.id = st.user_id
		 WHERE st.kp_id = $1 AND st.user_id = $2
		 FOR UPDATE OF st`, kpID, userID).Scan(
		&cardJSON, &snap.DueAt, &snap.Estimate, &snap.Status, &snap.Reviews, &snap.Lapses,
		&snap.ExplainPassedAt, &zone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("rate knowledge point: load card: %w", err)
	}
	snap.Fresh, snap.Card = created, cardJSON
	snapJSON, err := json.Marshal(snap)
	if err != nil {
		return nil, fmt.Errorf("rate knowledge point: encode snapshot: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE explain_back_attempts SET kp_before = $3 WHERE id = $1 AND user_id = $2`,
		src.ID, userID, snapJSON); err != nil {
		return nil, fmt.Errorf("rate knowledge point: record snapshot: %w", err)
	}

	var card learning.Card
	if len(cardJSON) > 0 {
		if err := json.Unmarshal(cardJSON, &card); err != nil {
			return nil, fmt.Errorf("rate knowledge point: decode card: %w", err)
		}
	}
	next, err := s.sched.Next(card, now, rating)
	if err != nil {
		return nil, err
	}
	nextStatus := snap.Status
	var passedAt *time.Time
	if passed {
		passedAt = &now
	} else {
		// A failed explanation keeps the point in play, and brings it back
		// soon: no later than the start of the learner's next day, whatever
		// interval `hard` would have given a mature card.
		if soon := learning.StartOf(learning.LocalDay(now, zone), zone).AddDate(0, 0, 1).UTC(); next.Due.After(soon) {
			next.Due = soon
		}
		nextStatus = mastery.KPActive
	}
	nextJSON, err := json.Marshal(next)
	if err != nil {
		return nil, fmt.Errorf("rate knowledge point: encode card: %w", err)
	}
	estimate := learning.MasteryEstimate(snap.Estimate, passed)

	if _, err := tx.Exec(ctx, `
		UPDATE kp_state
		   SET fsrs_card = $3, due_at = $4, mastery_estimate = $5, status = $6,
		       reviews = reviews + 1, lapses = $7, explain_passed_at = $8, updated_at = now()
		 WHERE kp_id = $1 AND user_id = $2`,
		kpID, userID, nextJSON, next.Due, estimate, nextStatus, int(next.Lapses), passedAt); err != nil {
		return nil, fmt.Errorf("rate knowledge point: write card: %w", err)
	}
	return &quiz.Scheduled{
		KnowledgePointID: kpID, DueAt: next.Due, MasteryEstimate: estimate,
		Rating: rating, Lapses: int(next.Lapses),
	}, nil
}

// OverrideExplainBack records the learner's opposite verdict.
//
// Like a quiz override it is allowed once, and it REPLAYS rather than steps:
// when nothing has rated the point since this attempt (no later judged
// explain-back, no later question attempt), the card is restored to its
// snapshot and rated with the learner's verdict. Otherwise the verdict is
// corrected on the record, and the gate follows it only if this is the
// point's latest explain-back — later evidence keeps the schedule.
func (s *MasteryStore) OverrideExplainBack(
	ctx context.Context, userID, attemptID uuid.UUID, now time.Time,
) (*mastery.ExplainBackAttempt, *quiz.Scheduled, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("override explain-back: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		kpID       uuid.UUID
		verdict    string
		overridden *time.Time
		judgedAt   *time.Time
		kpBefore   []byte
	)
	err = tx.QueryRow(ctx, `
		SELECT kp_id, verdict, overridden_at, judged_at, kp_before
		  FROM explain_back_attempts WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		attemptID, userID).Scan(&kpID, &verdict, &overridden, &judgedAt, &kpBefore)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("override explain-back: load: %w", err)
	}
	if verdict != mastery.VerdictPassed && verdict != mastery.VerdictFailed {
		return nil, nil, fmt.Errorf("%w: only a judged explanation can be disputed", mastery.ErrBadRequest)
	}
	if overridden != nil {
		return nil, nil, fmt.Errorf("%w: this verdict has already been disputed once", mastery.ErrBadRequest)
	}
	passed := verdict != mastery.VerdictPassed

	// Lock the card before deciding anything about it.
	if _, err := tx.Exec(ctx,
		`SELECT 1 FROM kp_state WHERE kp_id = $1 AND user_id = $2 FOR UPDATE`, kpID, userID); err != nil {
		return nil, nil, fmt.Errorf("override explain-back: lock card: %w", err)
	}

	attempt, err := scanExplainBack(tx.QueryRow(ctx, `
		UPDATE explain_back_attempts SET override_passed = $3, overridden_at = now()
		 WHERE id = $1 AND user_id = $2
		 RETURNING `+explainColumns, attemptID, userID, passed))
	if err != nil {
		return nil, nil, err
	}

	var latestExplain, latestRating bool
	if err := tx.QueryRow(ctx, `
		SELECT NOT EXISTS (
		           SELECT 1 FROM explain_back_attempts
		            WHERE user_id = $1 AND kp_id = $2 AND id <> $3
		              AND verdict IN ('passed', 'failed') AND judged_at >= $4),
		       NOT EXISTS (
		           SELECT 1 FROM question_attempts
		            WHERE user_id = $1 AND knowledge_point_id = $2 AND created_at >= $4)`,
		userID, kpID, attemptID, judgedAt).Scan(&latestExplain, &latestRating); err != nil {
		return nil, nil, fmt.Errorf("override explain-back: latest check: %w", err)
	}

	var scheduled *quiz.Scheduled
	switch {
	case latestExplain && latestRating && len(kpBefore) > 0:
		if err := restoreKPState(ctx, tx, userID, kpID, kpBefore); err != nil {
			return nil, nil, err
		}
		scheduled, err = s.rateKnowledgePoint(ctx, tx, userID, kpID, explainRating(passed),
			RatingSource{Kind: loop.KindExplainBack, ID: attemptID}, now)
		if err != nil {
			return nil, nil, err
		}
	case latestExplain:
		var passedAt *time.Time
		if passed {
			t := now.UTC()
			passedAt = &t
		}
		if _, err := tx.Exec(ctx,
			`UPDATE kp_state SET explain_passed_at = $3, updated_at = now() WHERE kp_id = $1 AND user_id = $2`,
			kpID, userID, passedAt); err != nil {
			return nil, nil, fmt.Errorf("override explain-back: gate: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("override explain-back: commit: %w", err)
	}
	return attempt, scheduled, nil
}

// LatestExplainBack is the point's newest finished attempt.
func (s *MasteryStore) LatestExplainBack(ctx context.Context, userID, kpID uuid.UUID) (*mastery.ExplainBackAttempt, error) {
	return scanExplainBack(s.pool.QueryRow(ctx, `
		SELECT `+explainColumns+`
		  FROM explain_back_attempts
		 WHERE user_id = $1 AND kp_id = $2 AND verdict <> 'pending'
		 ORDER BY created_at DESC, id
		 LIMIT 1`, userID, kpID))
}

// ExplainStatus is the path's gate flag and each point's explain_passed_at.
func (s *MasteryStore) ExplainStatus(ctx context.Context, userID, pathID uuid.UUID) (bool, map[uuid.UUID]time.Time, error) {
	var gate bool
	err := s.pool.QueryRow(ctx,
		`SELECT explain_gate FROM mastery_paths WHERE id = $1 AND user_id = $2`, pathID, userID).Scan(&gate)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, mastery.ErrNotFound
	}
	if err != nil {
		return false, nil, fmt.Errorf("explain status: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT kp.id, st.explain_passed_at
		  FROM knowledge_points kp
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		  JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		 WHERE kp.user_id = $1 AND m.path_id = $2 AND st.explain_passed_at IS NOT NULL`, userID, pathID)
	if err != nil {
		return false, nil, fmt.Errorf("explain status: points: %w", err)
	}
	defer rows.Close()
	passed := map[uuid.UUID]time.Time{}
	for rows.Next() {
		var (
			id uuid.UUID
			at time.Time
		)
		if err := rows.Scan(&id, &at); err != nil {
			return false, nil, fmt.Errorf("explain status: scan: %w", err)
		}
		passed[id] = at
	}
	return gate, passed, rows.Err()
}

func scanExplainBack(row pgx.Row) (*mastery.ExplainBackAttempt, error) {
	var (
		a                          mastery.ExplainBackAttempt
		gaps, misconceptions, srcs []byte
	)
	err := row.Scan(&a.ID, &a.UserID, &a.KnowledgePointID, &a.PathID, &a.RequestID, &a.Explanation,
		&a.Verdict, &gaps, &misconceptions, &a.Feedback, &srcs, &a.Model,
		&a.OverridePassed, &a.OverriddenAt, &a.JudgedAt, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan explain-back: %w", err)
	}
	for _, f := range []struct {
		raw []byte
		out any
	}{{gaps, &a.Gaps}, {misconceptions, &a.Misconceptions}, {srcs, &a.Sources}} {
		if err := json.Unmarshal(f.raw, f.out); err != nil {
			return nil, fmt.Errorf("scan explain-back: decode: %w", err)
		}
	}
	a.Passed = a.Verdict == mastery.VerdictPassed
	a.Gaps, a.Misconceptions, a.Sources = nonNilStrings(a.Gaps), nonNilStrings(a.Misconceptions), nonNilCitations(a.Sources)
	return &a, nil
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func nonNilCitations(in []citations.Source) []citations.Source {
	if in == nil {
		return []citations.Source{}
	}
	return in
}

// isForeignKeyViolation: a composite ownership key refused the row — the
// parent is gone, or was never the caller's. Answered as not found.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
