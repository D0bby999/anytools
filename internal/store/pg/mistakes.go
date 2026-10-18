package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
)

// mistakes.go — the life of one mistake (error_records), for EVERY question.
//
// The lifecycle is DeepTutor's (models.py:136): active → retrying → review →
// graduated. Until learning-depth phase 1 only mastery questions reached it,
// because it ran inside `advance`, which needs a knowledge point; a wrong
// answer in a plain quiz left nothing behind to practise. It now runs for
// every attempt, beside the attempt, in the same transaction.
//
// Two correct answers close a mistake rather than one, which is the difference
// between "you got it right once" and "you can get it right". A single-retry
// graduation is why people re-answer a question they have just been shown the
// answer to and believe they have fixed something. And the second must come on
// a LATER DAY in the learner's zone: two right answers a minute apart prove
// the answer was still on screen, not that it was remembered.

// openMistakeSQL opens a mistake, or extends the question's open one. The
// arbiter is the (user, question) index, so a mistake answered wrong in a quiz
// and again in a mastery session is ONE mistake with two entries. A wrong
// answer also clears first_correct_at: the next correct answer starts the
// two-day rule over.
const openMistakeSQL = `
	INSERT INTO error_records
		(user_id, question_id, kp_id, module_id, error_type, self_attribution,
		 ai_confirmation, retry_history, status)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'active')
	ON CONFLICT (user_id, question_id) WHERE status <> 'graduated'
	DO UPDATE SET
		retry_history = error_records.retry_history || EXCLUDED.retry_history,
		kp_id = COALESCE(error_records.kp_id, EXCLUDED.kp_id),
		module_id = COALESCE(error_records.module_id, EXCLUDED.module_id),
		error_type = EXCLUDED.error_type,
		self_attribution = EXCLUDED.self_attribution,
		ai_confirmation = EXCLUDED.ai_confirmation,
		status = 'retrying',
		first_correct_at = NULL,
		updated_at = now()`

type mistakeInput struct {
	UserID      uuid.UUID
	QuestionID  uuid.UUID
	KPID        *uuid.UUID
	ModuleID    *uuid.UUID
	AttemptID   uuid.UUID
	Correct     bool
	ErrorType   string
	Attribution string
	AIConfirm   string
	Now         time.Time
}

// openMistake is an open error_records row, as an override snapshot holds it.
type openMistake struct {
	ID             uuid.UUID       `json:"id"`
	KPID           *uuid.UUID      `json:"kp_id"`
	ModuleID       *uuid.UUID      `json:"module_id"`
	ErrorType      string          `json:"error_type"`
	Attribution    string          `json:"self_attribution"`
	AIConfirm      string          `json:"ai_confirmation"`
	RetryHistory   json.RawMessage `json:"retry_history"`
	Status         string          `json:"status"`
	FirstCorrectAt *time.Time      `json:"first_correct_at"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// mistakeSnapshot is question_attempts.error_before. Open is nil when the
// question had no open mistake before the attempt.
type mistakeSnapshot struct {
	Open *openMistake `json:"open"`
}

// lockOpenMistake reads the question's open mistake FOR UPDATE, or nil. Two
// answers to one question submitted at once serialize here, so the second sees
// the first one's `review` and the two-day rule cannot be raced.
func lockOpenMistake(ctx context.Context, tx pgx.Tx, userID, questionID uuid.UUID) (*openMistake, error) {
	var m openMistake
	err := tx.QueryRow(ctx, `
		SELECT id, kp_id, module_id, error_type, self_attribution, ai_confirmation,
		       retry_history, status, first_correct_at, created_at, updated_at
		  FROM error_records
		 WHERE user_id = $1 AND question_id = $2 AND status <> 'graduated'
		 FOR UPDATE`, userID, questionID).Scan(
		&m.ID, &m.KPID, &m.ModuleID, &m.ErrorType, &m.Attribution, &m.AIConfirm,
		&m.RetryHistory, &m.Status, &m.FirstCorrectAt, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mistake: lock: %w", err)
	}
	return &m, nil
}

// applyMistake records what one attempt does to its question's mistake, and
// stores the mistake as it stood before the attempt on the attempt row, for an
// override to restore.
func (s *QuestionStore) applyMistake(ctx context.Context, tx pgx.Tx, in mistakeInput) error {
	before, err := lockOpenMistake(ctx, tx, in.UserID, in.QuestionID)
	if err != nil {
		return err
	}
	snap, err := json.Marshal(mistakeSnapshot{Open: before})
	if err != nil {
		return fmt.Errorf("mistake: encode snapshot: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE question_attempts SET error_before = $3 WHERE id = $1 AND user_id = $2`,
		in.AttemptID, in.UserID, snap); err != nil {
		return fmt.Errorf("mistake: record snapshot: %w", err)
	}

	entry, err := json.Marshal([]map[string]any{{
		"attempt_id": in.AttemptID,
		"at":         in.Now,
		"is_correct": in.Correct,
	}})
	if err != nil {
		return fmt.Errorf("mistake: encode retry: %w", err)
	}

	if !in.Correct {
		if _, err := tx.Exec(ctx, openMistakeSQL,
			in.UserID, in.QuestionID, in.KPID, in.ModuleID,
			nonEmpty(in.ErrorType, learning.ErrTypeUnknown), in.Attribution, in.AIConfirm, entry); err != nil {
			return fmt.Errorf("mistake: open: %w", err)
		}
		return nil
	}

	// Correct. With no open mistake there is nothing to do: a question
	// answered right the first time never opens one.
	if before == nil {
		return nil
	}
	status, firstCorrect := "review", &in.Now
	if before.Status == "review" && before.FirstCorrectAt != nil {
		firstCorrect = before.FirstCorrectAt
		zone, err := userZone(ctx, tx, in.UserID)
		if err != nil {
			return err
		}
		if learning.LocalDay(*before.FirstCorrectAt, zone).Before(learning.LocalDay(in.Now, zone)) {
			status = "graduated"
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE error_records
		   SET retry_history = retry_history || $3::jsonb,
		       status = $4,
		       first_correct_at = $5,
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2`,
		before.ID, in.UserID, entry, status, firstCorrect); err != nil {
		return fmt.Errorf("mistake: advance: %w", err)
	}
	return nil
}

// restoreMistake puts a question's mistake back to the attempt's snapshot:
// the attempt being overridden never happened, as far as the mistake knows.
// The caller then applies the corrected verdict with applyMistake.
//
// A snapshot with no open mistake means this attempt opened (or advanced
// nothing on) the current one, so whatever is open now goes. The caller has
// checked the attempt is the question's latest, so no later attempt's work is
// undone.
func restoreMistake(ctx context.Context, tx pgx.Tx, userID, questionID uuid.UUID, raw []byte) error {
	var snap mistakeSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return fmt.Errorf("override: decode mistake snapshot: %w", err)
	}
	if snap.Open == nil {
		if _, err := tx.Exec(ctx,
			`DELETE FROM error_records WHERE user_id = $1 AND question_id = $2 AND status <> 'graduated'`,
			userID, questionID); err != nil {
			return fmt.Errorf("override: drop mistake: %w", err)
		}
		return nil
	}
	m := snap.Open
	// The snapshot's row may since have graduated, so it is matched by id,
	// not by "open". Any OTHER open row for the question was opened after
	// the snapshot by this attempt's own graduation-then-reopen, which a
	// single attempt cannot do, so there is none to clear.
	if _, err := tx.Exec(ctx, `
		UPDATE error_records
		   SET kp_id = $3, module_id = $4, error_type = $5, self_attribution = $6,
		       ai_confirmation = $7, retry_history = $8, status = $9,
		       first_correct_at = $10, updated_at = $11
		 WHERE id = $1 AND user_id = $2`,
		m.ID, userID, m.KPID, m.ModuleID, m.ErrorType, m.Attribution, m.AIConfirm,
		[]byte(m.RetryHistory), m.Status, m.FirstCorrectAt, m.UpdatedAt); err != nil {
		return fmt.Errorf("override: restore mistake: %w", err)
	}
	return nil
}

// userZone is the learner's IANA zone, read inside the caller's transaction.
func userZone(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (string, error) {
	var zone string
	if err := tx.QueryRow(ctx, `SELECT timezone FROM users WHERE id = $1`, userID).Scan(&zone); err != nil {
		return "", fmt.Errorf("mistake: learner's zone: %w", err)
	}
	return zone, nil
}

func nonEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// ListMistakes is the practice queue (quiz.Service.Practice). "Today" starts at
// midnight in the learner's zone: a mistake in review becomes practisable
// again only once its first correct answer is from an earlier day, since only
// a later day's answer can graduate it.
func (s *QuestionStore) ListMistakes(
	ctx context.Context, userID uuid.UUID, f quiz.PracticeFilter, limit int,
) (*quiz.PracticeQueue, error) {
	var zone string
	if err := s.pool.QueryRow(ctx, `SELECT timezone FROM users WHERE id = $1`, userID).Scan(&zone); err != nil {
		return nil, fmt.Errorf("practice: learner's zone: %w", err)
	}
	todayStart := learning.StartOf(learning.LocalDay(f.Now, zone), zone)

	// Every table is read with the caller's user_id, including the path filter:
	// another user's path id matches no module of this user's.
	const from = `
		  FROM error_records e
		  JOIN questions q ON q.id = e.question_id AND q.user_id = e.user_id
		  LEFT JOIN knowledge_points kp ON kp.id = e.kp_id AND kp.user_id = e.user_id
		  LEFT JOIN knowledge_bases kb ON kb.id = q.kb_id AND kb.user_id = q.user_id
		 WHERE e.user_id = $1
		   AND (e.status IN ('active', 'retrying')
		        OR (e.status = 'review' AND e.first_correct_at < $2))
		   AND ($3::uuid IS NULL OR q.kb_id = $3)
		   AND ($4::uuid IS NULL OR EXISTS (
		         SELECT 1 FROM mastery_modules m
		          WHERE m.user_id = $1 AND m.path_id = $4
		            AND m.id = COALESCE(e.module_id, kp.module_id, q.module_id)))`
	args := []any{userID, todayStart, f.KBID, f.PathID}

	out := &quiz.PracticeQueue{Items: []quiz.PracticeItem{}}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) `+from, args...).Scan(&out.Remaining); err != nil {
		return nil, fmt.Errorf("practice: count: %w", err)
	}
	rows, err := s.pool.Query(ctx, `
		SELECT `+qualifiedQuestionColumns+`, e.status, e.created_at, COALESCE(kb.name, ''),
		       (SELECT count(*) FROM jsonb_array_elements(e.retry_history) x
		         WHERE x->>'is_correct' = 'false')`+from+`
		 ORDER BY CASE WHEN e.status = 'review' THEN 1 ELSE 0 END, e.created_at, e.id
		 LIMIT `+fmt.Sprint(limit), args...)
	if err != nil {
		return nil, fmt.Errorf("practice: list: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it quiz.PracticeItem
		q, err := scanQuestion(rows, &it.Status, &it.OpenedAt, &it.KBName, &it.Misses)
		if err != nil {
			return nil, err
		}
		it.Question = *q
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}
