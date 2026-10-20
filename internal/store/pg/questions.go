package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/learning"
)

// QuestionStore is the question bank's persistence, and the owner of the one
// transaction in phase 7 that has to be a transaction.
//
// Recording an attempt writes three things — the attempt, the knowledge point's
// FSRS card, and the error record — and phase-07 requires them to land
// together. They have to, and not for tidiness: the card is the schedule and
// the error record is the "have I fixed this yet". An attempt written without
// its card is a wrong answer that never comes back; a card written without its
// attempt is a review with no evidence behind it. Either half alone is a lie
// about what the learner did.
//
// Every query in this file filters on user_id, including the ones already
// scoped by an id the caller verified — the same deliberate redundancy chat.go
// documents, for the same reason.
type QuestionStore struct {
	pool  *Pool
	sched *learning.Scheduler
}

// NewQuestionStore builds a QuestionStore over the shared pool.
func NewQuestionStore(pool *Pool) *QuestionStore {
	return &QuestionStore{pool: pool, sched: learning.NewScheduler()}
}

const questionColumns = `id, user_id, kb_id, session_id, knowledge_point_id, module_id,
	prompt, type, options, answer, explanation, difficulty, source_chunk_ids, created_at, rubric, code`

// qualifiedQuestionColumns is the same list under the bank query's `q` alias.
// Written out rather than derived from questionColumns by string surgery: the
// derivation would be one reformat of the constant above away from producing
// invalid SQL, and it would produce it at runtime, in a query nobody compiles.
const qualifiedQuestionColumns = `q.id, q.user_id, q.kb_id, q.session_id,
	q.knowledge_point_id, q.module_id, q.prompt, q.type, q.options, q.answer,
	q.explanation, q.difficulty, q.source_chunk_ids, q.created_at, q.rubric, q.code`

// InsertQuestions writes a generated batch in one transaction.
//
// One transaction because a generate call is one unit of work a learner paid a
// model for: half a quiz stored because the fourth row tripped a CHECK is worse
// than none, since the missing questions are the ones nobody can tell are
// missing.
func (s *QuestionStore) InsertQuestions(ctx context.Context, qs []quiz.Question) ([]quiz.Question, error) {
	if len(qs) == 0 {
		return nil, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("insert questions: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	out := make([]quiz.Question, 0, len(qs))
	for _, q := range qs {
		stored, err := insertQuestion(ctx, tx, q)
		if err != nil {
			return nil, err
		}
		out = append(out, *stored)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("insert questions: commit: %w", err)
	}
	return out, nil
}

// insertQuestion writes one question inside tx. The exam store calls it too,
// so a generated exam item is stored exactly as a bank question is.
func insertQuestion(ctx context.Context, tx pgx.Tx, q quiz.Question) (*quiz.Question, error) {
	options, err := json.Marshal(nonNilOptions(q.Options))
	if err != nil {
		return nil, fmt.Errorf("insert questions: encode options: %w", err)
	}
	chunkIDs := q.SourceChunkIDs
	if chunkIDs == nil {
		chunkIDs = []uuid.UUID{}
	}
	// NULL for every type but written; the CHECK holds the two together.
	var rubric []byte
	if q.Rubric != nil {
		if rubric, err = json.Marshal(q.Rubric); err != nil {
			return nil, fmt.Errorf("insert questions: encode rubric: %w", err)
		}
	}
	// NULL for every type but code; the CHECK holds the two together.
	var code []byte
	if q.Code != nil {
		if code, err = json.Marshal(q.Code); err != nil {
			return nil, fmt.Errorf("insert questions: encode code: %w", err)
		}
	}
	row := tx.QueryRow(ctx, `
		INSERT INTO questions
			(user_id, kb_id, session_id, knowledge_point_id, module_id,
			 prompt, type, options, answer, explanation, difficulty, source_chunk_ids, rubric, code)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING `+questionColumns,
		q.UserID, q.KBID, q.SessionID, q.KnowledgePointID, q.ModuleID,
		q.Prompt, q.Type, options, q.Answer, q.Explanation, q.Difficulty, chunkIDs, rubric, code)
	return scanQuestion(row)
}

// GetQuestion reads one question scoped to its owner.
func (s *QuestionStore) GetQuestion(ctx context.Context, userID, questionID uuid.UUID) (*quiz.Question, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+questionColumns+` FROM questions WHERE id = $1 AND user_id = $2`,
		questionID, userID)
	return scanQuestion(row)
}

// ListQuestions is the bank.
//
// The attempt summary is a LATERAL rather than a second round trip: the screen
// shows "answered / not answered" on every row, and fetching that per question
// is the classic N+1 that only shows up once someone has a few hundred
// questions — which is the point at which the bank is worth having.
func (s *QuestionStore) ListQuestions(ctx context.Context, userID uuid.UUID, f quiz.Filter) ([]quiz.BankEntry, error) {
	limit := f.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	// Parameters are positional and built alongside the clauses so that an
	// added filter cannot silently shift an existing one's index.
	args := []any{userID}
	where := []string{"q.user_id = $1"}
	add := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if f.KBID != nil {
		add("q.kb_id = $%d", *f.KBID)
	}
	if f.Type != "" {
		add("q.type = $%d", f.Type)
	}
	if f.KnowledgePointID != nil {
		add("q.knowledge_point_id = $%d", *f.KnowledgePointID)
	}
	if f.ModuleID != nil {
		add("q.module_id = $%d", *f.ModuleID)
	}
	if f.Answered != nil {
		if *f.Answered {
			where = append(where, "a.attempts > 0")
		} else {
			where = append(where, "a.attempts = 0")
		}
	}
	args = append(args, limit)

	sql := `
		SELECT ` + qualifiedQuestionColumns + `,
		       a.attempts, a.last_correct, a.last_at, a.last_id,
		       COALESCE(kb.name, ''), COALESCE(kp.name, ''), COALESCE(m.name, '')
		  FROM questions q
		  LEFT JOIN knowledge_bases kb ON kb.id = q.kb_id AND kb.user_id = q.user_id
		  LEFT JOIN knowledge_points kp ON kp.id = q.knowledge_point_id AND kp.user_id = q.user_id
		  LEFT JOIN mastery_modules m ON m.id = q.module_id AND m.user_id = q.user_id
		  CROSS JOIN LATERAL (
		      SELECT count(*) AS attempts,
		             (array_agg(at.is_correct ORDER BY at.created_at DESC))[1] AS last_correct,
		             max(at.created_at) AS last_at,
		             (array_agg(at.id ORDER BY at.created_at DESC))[1] AS last_id
		        FROM question_attempts at
		       WHERE at.question_id = q.id AND at.user_id = q.user_id
		  ) a
		 WHERE ` + strings.Join(where, " AND ") + `
		 ORDER BY q.created_at DESC, q.id
		 LIMIT $` + fmt.Sprint(len(args))

	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("list questions: %w", err)
	}
	defer rows.Close()

	out := []quiz.BankEntry{}
	for rows.Next() {
		var (
			e           quiz.BankEntry
			options     []byte
			sessionID   *uuid.UUID
			kpID        *uuid.UUID
			moduleID    *uuid.UUID
			lastCorrect *bool
			lastAt      *time.Time
			lastID      *uuid.UUID
			rubric      []byte
			code        []byte
		)
		if err := rows.Scan(
			&e.Question.ID, &e.Question.UserID, &e.Question.KBID, &sessionID, &kpID, &moduleID,
			&e.Question.Prompt, &e.Question.Type, &options, &e.Question.Answer,
			&e.Question.Explanation, &e.Question.Difficulty, &e.Question.SourceChunkIDs,
			&e.Question.CreatedAt, &rubric, &code,
			&e.Attempts, &lastCorrect, &lastAt, &lastID,
			&e.KBName, &e.KPName, &e.ModuleName,
		); err != nil {
			return nil, fmt.Errorf("list questions: scan: %w", err)
		}
		e.Question.SessionID, e.Question.KnowledgePointID, e.Question.ModuleID = sessionID, kpID, moduleID
		if err := json.Unmarshal(options, &e.Question.Options); err != nil {
			return nil, fmt.Errorf("list questions: decode options: %w", err)
		}
		if err := decodeRubric(rubric, &e.Question); err != nil {
			return nil, fmt.Errorf("list questions: %w", err)
		}
		if len(code) > 0 {
			e.Question.Code = &quiz.CodeExercise{}
			if err := json.Unmarshal(code, e.Question.Code); err != nil {
				return nil, fmt.Errorf("list questions: decode code: %w", err)
			}
		}
		e.LastCorrect, e.LastAttempt, e.LastAnswerID = lastCorrect, lastAt, lastID
		out = append(out, e)
	}
	return out, rows.Err()
}

const attemptColumns = `id, user_id, question_id, knowledge_point_id, module_id,
	user_answer, is_correct, judge, error_type, self_attribution, rating, overridden_at, created_at, score`

// ListAttempts returns a question's attempts, newest first.
func (s *QuestionStore) ListAttempts(ctx context.Context, userID, questionID uuid.UUID, limit int) ([]quiz.Attempt, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+attemptColumns+`
		   FROM question_attempts
		  WHERE user_id = $1 AND question_id = $2
		  ORDER BY created_at DESC, id
		  LIMIT $3`, userID, questionID, limit)
	if err != nil {
		return nil, fmt.Errorf("list attempts: %w", err)
	}
	defer rows.Close()

	out := []quiz.Attempt{}
	for rows.Next() {
		a, err := scanAttempt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// GetAttempt reads one attempt scoped to its owner.
func (s *QuestionStore) GetAttempt(ctx context.Context, userID, attemptID uuid.UUID) (*quiz.Attempt, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+attemptColumns+` FROM question_attempts WHERE id = $1 AND user_id = $2`,
		attemptID, userID)
	return scanAttempt(row)
}

// RecordAttempt writes the attempt, records what it does to the question's
// mistake, and, when the question carries a knowledge point, advances that
// point's card, all in the SAME transaction.
func (s *QuestionStore) RecordAttempt(ctx context.Context, w quiz.AttemptWrite) (*quiz.Attempt, *quiz.Scheduled, error) {
	now := w.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("record attempt: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	judge := w.Judge
	if len(judge) == 0 {
		judge = json.RawMessage(`{}`)
	}

	row := tx.QueryRow(ctx, `
		INSERT INTO question_attempts
			(user_id, question_id, knowledge_point_id, module_id, user_answer,
			 is_correct, judge, error_type, self_attribution, rating, score)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING `+attemptColumns,
		w.UserID, w.QuestionID, w.KnowledgePointID, w.ModuleID, w.UserAnswer,
		w.IsCorrect, []byte(judge), w.ErrorType, w.SelfAttribution, w.Rating, w.Score)
	attempt, err := scanAttempt(row)
	if err != nil {
		return nil, nil, err
	}

	var scheduled *quiz.Scheduled
	if w.KnowledgePointID != nil {
		scheduled, err = s.advance(ctx, tx, advanceInput{
			UserID:     w.UserID,
			KPID:       *w.KnowledgePointID,
			ModuleID:   w.ModuleID,
			QuestionID: w.QuestionID,
			AttemptID:  attempt.ID,
			Correct:    w.IsCorrect,
			Rating:     w.Rating,
			Now:        now,
		})
		if err != nil {
			return nil, nil, err
		}
	}
	if err := s.applyMistake(ctx, tx, mistakeInput{
		UserID:      w.UserID,
		QuestionID:  w.QuestionID,
		KPID:        w.KnowledgePointID,
		ModuleID:    w.ModuleID,
		AttemptID:   attempt.ID,
		Correct:     w.IsCorrect,
		ErrorType:   w.ErrorType,
		Attribution: w.SelfAttribution,
		AIConfirm:   w.AIConfirmation,
		Now:         now,
	}); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("record attempt: commit: %w", err)
	}
	return attempt, scheduled, nil
}

// OverrideAttempt replaces a verdict with the learner's own and reschedules.
//
// It does NOT insert a second attempt. An override is a correction to what
// happened, not a new answer: adding a row would double the attempt count, and
// the bank would show a learner answering twice when they answered once and
// disagreed with the marking.
//
// Overriding twice is refused rather than applied. A second override would
// reschedule from a card that already absorbed the first, compounding a single
// disagreement into two interval changes.
func (s *QuestionStore) OverrideAttempt(
	ctx context.Context, userID, attemptID uuid.UUID, correct bool, attribution string, now time.Time,
) (*quiz.Attempt, *quiz.Scheduled, error) {
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("override attempt: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	// FOR UPDATE, so two overrides racing on one attempt serialize and the
	// second sees overridden_at set.
	var (
		existingOverridden *time.Time
		questionID         uuid.UUID
		kpBefore           []byte
		errorBefore        []byte
	)
	err = tx.QueryRow(ctx,
		`SELECT overridden_at, question_id, kp_before, error_before FROM question_attempts
		  WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		attemptID, userID).Scan(&existingOverridden, &questionID, &kpBefore, &errorBefore)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, quiz.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("override attempt: load: %w", err)
	}
	if existingOverridden != nil {
		return nil, nil, fmt.Errorf("%w: this attempt has already been corrected once", quiz.ErrBadRequest)
	}

	rating := learning.RatingFor(correct, attribution)
	errorType := learning.ErrTypeNone
	if !correct {
		errorType = learning.ErrTypeUnknown
	}

	// The judge record keeps what the grader originally said, under `original`,
	// so the bank can show both. Losing it would make an override look like the
	// marking had always agreed. A rubric's score goes with it: the learner's
	// verdict is right or wrong, not a share of the points (the score stays
	// readable under `original`).
	row := tx.QueryRow(ctx, `
		UPDATE question_attempts
		   SET is_correct = $3,
		       score = NULL,
		       rating = $4,
		       error_type = $5,
		       self_attribution = $6,
		       overridden_at = now(),
		       judge = jsonb_build_object(
		           'mode', 'user',
		           'correct', $3::boolean,
		           'reason', 'The learner corrected this verdict.',
		           'original', judge)
		 WHERE id = $1 AND user_id = $2
		 RETURNING `+attemptColumns,
		attemptID, userID, correct, rating, errorType, attribution)
	attempt, err := scanAttempt(row)
	if err != nil {
		return nil, nil, err
	}

	// Reschedule by REPLAYING, not by stepping again: restore the card to what
	// it was before this attempt and apply the corrected verdict to that. A
	// second Next() on top of the wrong one would keep the lapse and the lost
	// stability the learner just proved they did not deserve.
	//
	// Only when this is the knowledge point's latest attempt. Restoring an older
	// snapshot would erase every review since; in that case the verdict is
	// corrected on the record and the later reviews keep the schedule.
	// The mistake is replayed the same way, for EVERY question: restore the
	// question's mistake to what it was before this attempt, then apply the
	// corrected verdict. Only when this is the question's latest attempt, for
	// the same reason as the card below. An attempt from before error_before
	// existed has no snapshot, and its mistake is left alone.
	if len(errorBefore) > 0 {
		var latest bool
		if err := tx.QueryRow(ctx, `
			SELECT NOT EXISTS (
				SELECT 1 FROM question_attempts
				 WHERE user_id = $1 AND question_id = $2 AND id <> $3
				   AND created_at >= $4)`,
			userID, questionID, attempt.ID, attempt.CreatedAt).Scan(&latest); err != nil {
			return nil, nil, fmt.Errorf("override attempt: latest answer check: %w", err)
		}
		if latest {
			if err := restoreMistake(ctx, tx, userID, questionID, errorBefore); err != nil {
				return nil, nil, err
			}
			if err := s.applyMistake(ctx, tx, mistakeInput{
				UserID:      userID,
				QuestionID:  questionID,
				KPID:        attempt.KnowledgePointID,
				ModuleID:    attempt.ModuleID,
				AttemptID:   attempt.ID,
				Correct:     correct,
				ErrorType:   errorType,
				Attribution: attribution,
				AIConfirm:   "overridden by the learner",
				Now:         now,
			}); err != nil {
				return nil, nil, err
			}
		}
	}

	var scheduled *quiz.Scheduled
	if attempt.KnowledgePointID != nil && len(kpBefore) > 0 {
		kpID := *attempt.KnowledgePointID
		var latest bool
		if err := tx.QueryRow(ctx, `
			SELECT NOT EXISTS (
				SELECT 1 FROM question_attempts
				 WHERE user_id = $1 AND knowledge_point_id = $2 AND id <> $3
				   AND created_at >= $4)
			   AND NOT EXISTS (
				SELECT 1 FROM explain_back_attempts
				 WHERE user_id = $1 AND kp_id = $2 AND judged_at >= $4
				   AND verdict IN ('passed', 'failed'))`,
			userID, kpID, attempt.ID, attempt.CreatedAt).Scan(&latest); err != nil {
			return nil, nil, fmt.Errorf("override attempt: latest check: %w", err)
		}
		if latest {
			if err := restoreKPState(ctx, tx, userID, kpID, kpBefore); err != nil {
				return nil, nil, err
			}
			scheduled, err = s.advance(ctx, tx, advanceInput{
				UserID:     userID,
				KPID:       kpID,
				ModuleID:   attempt.ModuleID,
				QuestionID: questionID,
				AttemptID:  attempt.ID,
				Correct:    correct,
				Rating:     rating,
				Now:        now,
			})
			if err != nil {
				return nil, nil, err
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("override attempt: commit: %w", err)
	}
	return attempt, scheduled, nil
}

// Sources resolves chunk ids to citable sources, scoped to the owner.
func (s *QuestionStore) Sources(ctx context.Context, userID uuid.UUID, chunkIDs []uuid.UUID) ([]citations.Source, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT c.id, c.document_id, d.title, c.page_start
		  FROM chunks c
		  JOIN documents d ON d.id = c.document_id AND d.user_id = c.user_id
		 WHERE c.user_id = $1 AND c.id = ANY($2)`, userID, chunkIDs)
	if err != nil {
		return nil, fmt.Errorf("quiz sources: %w", err)
	}
	defer rows.Close()
	out := []citations.Source{}
	for rows.Next() {
		var (
			id, docID uuid.UUID
			title     string
			page      int
		)
		if err := rows.Scan(&id, &docID, &title, &page); err != nil {
			return nil, fmt.Errorf("quiz sources: scan: %w", err)
		}
		out = append(out, citations.Source{
			Kind: "chunk", ID: id.String(), Title: title, Page: page, DocumentID: docID.String(),
		})
	}
	return out, rows.Err()
}

// ── scanning ──────────────────────────────────────────────────────────────

// scanQuestion reads the question columns, then any extra columns a query
// selects after them into extra.
func scanQuestion(row pgx.Row, extra ...any) (*quiz.Question, error) {
	var (
		q         quiz.Question
		options   []byte
		sessionID *uuid.UUID
		kpID      *uuid.UUID
		moduleID  *uuid.UUID
	)
	var rubric, code []byte
	err := row.Scan(append([]any{&q.ID, &q.UserID, &q.KBID, &sessionID, &kpID, &moduleID,
		&q.Prompt, &q.Type, &options, &q.Answer, &q.Explanation, &q.Difficulty,
		&q.SourceChunkIDs, &q.CreatedAt, &rubric, &code}, extra...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, quiz.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan question: %w", err)
	}
	q.SessionID, q.KnowledgePointID, q.ModuleID = sessionID, kpID, moduleID
	if err := json.Unmarshal(options, &q.Options); err != nil {
		return nil, fmt.Errorf("scan question: decode options: %w", err)
	}
	if err := decodeRubric(rubric, &q); err != nil {
		return nil, fmt.Errorf("scan question: %w", err)
	}
	if len(code) > 0 {
		q.Code = &quiz.CodeExercise{}
		if err := json.Unmarshal(code, q.Code); err != nil {
			return nil, fmt.Errorf("scan question: decode code: %w", err)
		}
	}
	return &q, nil
}

// decodeRubric reads questions.rubric, NULL for every type but written.
func decodeRubric(raw []byte, q *quiz.Question) error {
	if len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, &q.Rubric); err != nil {
		return fmt.Errorf("decode rubric: %w", err)
	}
	return nil
}

func scanAttempt(row pgx.Row) (*quiz.Attempt, error) {
	var (
		a        quiz.Attempt
		judge    []byte
		kpID     *uuid.UUID
		moduleID *uuid.UUID
		overrode *time.Time
	)
	err := row.Scan(&a.ID, &a.UserID, &a.QuestionID, &kpID, &moduleID,
		&a.UserAnswer, &a.IsCorrect, &judge, &a.ErrorType, &a.SelfAttribution,
		&a.Rating, &overrode, &a.CreatedAt, &a.Score)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, quiz.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan attempt: %w", err)
	}
	a.KnowledgePointID, a.ModuleID, a.OverriddenAt = kpID, moduleID, overrode
	a.Judge = json.RawMessage(judge)
	return &a, nil
}

func nonNilOptions(in []quiz.Option) []quiz.Option {
	if in == nil {
		return []quiz.Option{}
	}
	return in
}
