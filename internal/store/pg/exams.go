package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/capabilities/exam"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/jobs"
)

// ExamStore is exam_templates, exams and exam_items (learning-depth phase 3).
// Every statement names the owner, including those already scoped by an id
// the caller verified.
type ExamStore struct{ pool *Pool }

// NewExamStore builds the store.
func NewExamStore(pool *Pool) *ExamStore { return &ExamStore{pool: pool} }

var _ exam.Store = (*ExamStore)(nil)

// ── templates ─────────────────────────────────────────────────────────────

const templateColumns = `id, user_id, title, filename, kind, sha256, bytes, page_count, status, error,
	parsed_by, items, warnings, total_points, time_limit_minutes, job_id, created_at, updated_at`

func scanTemplate(row pgx.Row) (*exam.Template, error) {
	var (
		t               exam.Template
		items, warnings []byte
	)
	err := row.Scan(&t.ID, &t.UserID, &t.Title, &t.Filename, &t.Kind, &t.SHA256, &t.Bytes, &t.PageCount,
		&t.Status, &t.Error, &t.ParsedBy, &items, &warnings, &t.TotalPoints, &t.TimeLimitMinutes,
		&t.JobID, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, exam.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("exam template: scan: %w", err)
	}
	t.Items, t.Warnings = []exam.Item{}, []string{}
	if err := json.Unmarshal(items, &t.Items); err != nil {
		return nil, fmt.Errorf("exam template: decode items: %w", err)
	}
	_ = json.Unmarshal(warnings, &t.Warnings)
	return &t, nil
}

// CreateTemplate inserts an uploaded paper's template.
func (s *ExamStore) CreateTemplate(ctx context.Context, t exam.Template) (*exam.Template, error) {
	return scanTemplate(s.pool.QueryRow(ctx, `
		INSERT INTO exam_templates (user_id, title, filename, kind, sha256, bytes, page_count, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+templateColumns,
		t.UserID, t.Title, t.Filename, t.Kind, t.SHA256, t.Bytes, t.PageCount, t.Status))
}

// GetTemplate reads one template.
func (s *ExamStore) GetTemplate(ctx context.Context, userID, id uuid.UUID) (*exam.Template, error) {
	return scanTemplate(s.pool.QueryRow(ctx,
		`SELECT `+templateColumns+` FROM exam_templates WHERE id = $1 AND user_id = $2`, id, userID))
}

// ListTemplates lists templates, newest first.
func (s *ExamStore) ListTemplates(ctx context.Context, userID uuid.UUID) ([]exam.Template, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+templateColumns+` FROM exam_templates
		 WHERE user_id = $1 ORDER BY created_at DESC, id LIMIT 50`, userID)
	if err != nil {
		return nil, fmt.Errorf("exam templates: %w", err)
	}
	defer rows.Close()
	out := []exam.Template{}
	for rows.Next() {
		t, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// SetTemplateJob records the extraction job, for Cancel.
func (s *ExamStore) SetTemplateJob(ctx context.Context, userID, id, jobID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE exam_templates SET job_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, id, userID, jobID)
	return err
}

// SetTemplateStatus moves an extraction on; parsedBy is kept when empty.
func (s *ExamStore) SetTemplateStatus(ctx context.Context, userID, id uuid.UUID, status, parsedBy string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE exam_templates
		   SET status = $3, parsed_by = COALESCE(NULLIF(left($4, 200), ''), parsed_by), updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status NOT IN ('review', 'ready', 'failed')`,
		id, userID, status, parsedBy)
	return err
}

// SaveBatch stores one extraction batch, replacing an earlier attempt's.
func (s *ExamStore) SaveBatch(ctx context.Context, userID, templateID uuid.UUID, batch int, items []exam.Item) error {
	raw, err := json.Marshal(items)
	if err != nil {
		return fmt.Errorf("exam batch: encode: %w", err)
	}
	// The composite foreign key refuses a template that is not this user's.
	_, err = s.pool.Exec(ctx, `
		INSERT INTO exam_template_batches (template_id, user_id, batch, items)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (template_id, batch) DO UPDATE SET items = EXCLUDED.items
		 WHERE exam_template_batches.user_id = EXCLUDED.user_id`,
		templateID, userID, batch, raw)
	return err
}

// Batches reads a template's stored batches, by number.
func (s *ExamStore) Batches(ctx context.Context, userID, templateID uuid.UUID) (map[int][]exam.Item, error) {
	rows, err := s.pool.Query(ctx, `SELECT batch, items FROM exam_template_batches
		 WHERE template_id = $1 AND user_id = $2`, templateID, userID)
	if err != nil {
		return nil, fmt.Errorf("exam batches: %w", err)
	}
	defer rows.Close()
	out := map[int][]exam.Item{}
	for rows.Next() {
		var (
			b   int
			raw []byte
		)
		if err := rows.Scan(&b, &raw); err != nil {
			return nil, fmt.Errorf("exam batches: scan: %w", err)
		}
		var items []exam.Item
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil, fmt.Errorf("exam batches: decode: %w", err)
		}
		out[b] = items
	}
	return out, rows.Err()
}

// FinishExtraction stores the merged items and moves the template to review.
// The batches have done their job and are removed.
func (s *ExamStore) FinishExtraction(
	ctx context.Context, userID, id uuid.UUID, items []exam.Item, warnings []string, total float64,
) error {
	it, _ := json.Marshal(items)
	wr, _ := json.Marshal(nonNilStrings(warnings))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		UPDATE exam_templates
		   SET items = $3, warnings = $4, total_points = $5, status = 'review', error = '', updated_at = now()
		 WHERE id = $1 AND user_id = $2`, id, userID, it, wr, total); err != nil {
		return fmt.Errorf("exam template: finish: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM exam_template_batches WHERE template_id = $1 AND user_id = $2`, id, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SaveTemplate stores a reviewed template.
func (s *ExamStore) SaveTemplate(ctx context.Context, t exam.Template) (*exam.Template, error) {
	it, _ := json.Marshal(t.Items)
	wr, _ := json.Marshal(nonNilStrings(t.Warnings))
	return scanTemplate(s.pool.QueryRow(ctx, `
		UPDATE exam_templates
		   SET title = $3, time_limit_minutes = $4, items = $5, warnings = $6, total_points = $7,
		       status = $8, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status IN ('review', 'ready')
		 RETURNING `+templateColumns,
		t.ID, t.UserID, t.Title, t.TimeLimitMinutes, it, wr, t.TotalPoints, t.Status))
}

// FailTemplate records why an extraction stopped.
func (s *ExamStore) FailTemplate(ctx context.Context, userID, id uuid.UUID, message string) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE exam_templates SET status = 'failed', error = left($3, 2000), updated_at = now()
		 WHERE id = $1 AND user_id = $2`, id, userID, message)
	return err
}

// DeleteTemplate removes a template and returns it.
func (s *ExamStore) DeleteTemplate(ctx context.Context, userID, id uuid.UUID) (*exam.Template, error) {
	return scanTemplate(s.pool.QueryRow(ctx,
		`DELETE FROM exam_templates WHERE id = $1 AND user_id = $2 RETURNING `+templateColumns, id, userID))
}

// ── exams ─────────────────────────────────────────────────────────────────

const examColumns = `e.id, e.user_id, e.template_id, e.kb_id, e.title, e.status, e.error, e.blueprint,
	e.requested, e.generated, e.dropped, e.time_limit_minutes, e.started_at, e.submitted_at,
	e.score, e.max_score, e.job_id, e.created_at`

func scanExam(row pgx.Row) (*exam.Exam, error) {
	var (
		e                  exam.Exam
		blueprint, dropped []byte
	)
	err := row.Scan(&e.ID, &e.UserID, &e.TemplateID, &e.KBID, &e.Title, &e.Status, &e.Error, &blueprint,
		&e.Requested, &e.Generated, &dropped, &e.TimeLimitMinutes, &e.StartedAt, &e.SubmittedAt,
		&e.Score, &e.MaxScore, &e.JobID, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, exam.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("exam: scan: %w", err)
	}
	if err := json.Unmarshal(blueprint, &e.Blueprint); err != nil {
		return nil, fmt.Errorf("exam: decode blueprint: %w", err)
	}
	e.Dropped = []exam.Dropped{}
	_ = json.Unmarshal(dropped, &e.Dropped)
	return &e, nil
}

// CreateExam inserts a generating exam. The composite foreign keys refuse a
// template or knowledge base that is not this user's.
func (s *ExamStore) CreateExam(ctx context.Context, e exam.Exam) (*exam.Exam, error) {
	bp, err := json.Marshal(e.Blueprint)
	if err != nil {
		return nil, fmt.Errorf("exam: encode blueprint: %w", err)
	}
	return scanExam(s.pool.QueryRow(ctx, `
		INSERT INTO exams AS e (user_id, template_id, kb_id, title, status, blueprint, requested, time_limit_minutes)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING `+examColumns,
		e.UserID, e.TemplateID, e.KBID, e.Title, e.Status, bp, e.Requested, e.TimeLimitMinutes))
}

// GetExam reads one exam.
func (s *ExamStore) GetExam(ctx context.Context, userID, id uuid.UUID) (*exam.Exam, error) {
	return scanExam(s.pool.QueryRow(ctx,
		`SELECT `+examColumns+` FROM exams e WHERE e.id = $1 AND e.user_id = $2`, id, userID))
}

// ListExams lists exams, newest first, without their blueprints.
func (s *ExamStore) ListExams(ctx context.Context, userID uuid.UUID) ([]exam.Exam, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+examColumns+` FROM exams e
		 WHERE e.user_id = $1 ORDER BY e.created_at DESC, e.id LIMIT 50`, userID)
	if err != nil {
		return nil, fmt.Errorf("exams: %w", err)
	}
	defer rows.Close()
	out := []exam.Exam{}
	for rows.Next() {
		e, err := scanExam(rows)
		if err != nil {
			return nil, err
		}
		e.Blueprint = nil
		out = append(out, *e)
	}
	return out, rows.Err()
}

// SetExamJob records the generation job, for Cancel.
func (s *ExamStore) SetExamJob(ctx context.Context, userID, id, jobID uuid.UUID) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE exams SET job_id = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, id, userID, jobID)
	return err
}

// HasUnit reports whether item ord was generated or dropped already.
func (s *ExamStore) HasUnit(ctx context.Context, userID, examID uuid.UUID, ord int) (bool, error) {
	var done bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM exam_items WHERE exam_id = $1 AND user_id = $2 AND ord = $3)
		    OR EXISTS (SELECT 1 FROM exams WHERE id = $1 AND user_id = $2
		                  AND dropped @> jsonb_build_array(jsonb_build_object('ord', $3::int)))`,
		examID, userID, ord).Scan(&done)
	return done, err
}

// AddGeneratedItem stores the question and the item, and counts it, in one
// transaction: an item without its question, or a question counted twice,
// is a resume that re-bills or an exam that lies about its size.
func (s *ExamStore) AddGeneratedItem(
	ctx context.Context, examID uuid.UUID, ord int, q quiz.Question, points float64, number string,
) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM exam_items WHERE exam_id = e.id AND user_id = e.user_id AND ord = $3)
		  FROM exams e WHERE e.id = $1 AND e.user_id = $2 FOR UPDATE`,
		examID, q.UserID, ord).Scan(&exists); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return exam.ErrNotFound
		}
		return fmt.Errorf("exam item: lock: %w", err)
	}
	if exists {
		return nil
	}
	stored, err := insertQuestion(ctx, tx, q)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO exam_items (user_id, exam_id, ord, question_id, points, template_number)
		VALUES ($1, $2, $3, $4, $5, left($6, 20))`,
		q.UserID, examID, ord, stored.ID, points, number); err != nil {
		return fmt.Errorf("exam item: insert: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE exams SET generated = generated + 1, updated_at = now() WHERE id = $1 AND user_id = $2`,
		examID, q.UserID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AddDropped records an item given up on, once.
func (s *ExamStore) AddDropped(ctx context.Context, userID, examID uuid.UUID, d exam.Dropped) error {
	raw, _ := json.Marshal([]exam.Dropped{d})
	_, err := s.pool.Exec(ctx, `
		UPDATE exams SET dropped = dropped || $3::jsonb, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		   AND NOT dropped @> jsonb_build_array(jsonb_build_object('ord', $4::int))`,
		examID, userID, raw, d.Ord)
	return err
}

// FinishGeneration settles a generating exam: ready with what was generated,
// or failed when nothing was.
func (s *ExamStore) FinishGeneration(ctx context.Context, userID, examID uuid.UUID, failure string) error {
	_, err := s.pool.Exec(ctx, finishGenerationSQL, examID, userID, failure)
	return err
}

// finishGenerationSQL is shared with the gave-up handler: $3 is why the job
// stopped, empty when it ran to the end.
const finishGenerationSQL = `
	UPDATE exams
	   SET status = CASE WHEN generated > 0 THEN 'ready' ELSE 'failed' END,
	       error = left(CASE
	           WHEN generated > 0 AND $3 = '' THEN ''
	           WHEN generated > 0 THEN 'stopped early: ' || $3
	           WHEN $3 <> '' THEN $3
	           ELSE 'no item could be generated' || COALESCE(': ' || (dropped -> 0 ->> 'reason'), '')
	       END, 2000),
	       updated_at = now()
	 WHERE id = $1 AND user_id = $2 AND status = 'generating'`

// Items reads an exam's items in order, each with its question and, once
// marked, its attempt's verdict and judgement.
func (s *ExamStore) Items(ctx context.Context, userID, examID uuid.UUID) ([]exam.ExamItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+qualifiedQuestionColumns+`,
		       i.id, i.ord, i.template_number, i.points, i.answer, i.attempt_id, i.score,
		       a.is_correct, a.judge
		  FROM exam_items i
		  JOIN questions q ON q.id = i.question_id AND q.user_id = i.user_id
		  LEFT JOIN question_attempts a ON a.id = i.attempt_id AND a.user_id = i.user_id
		 WHERE i.exam_id = $1 AND i.user_id = $2
		 ORDER BY i.ord`, examID, userID)
	if err != nil {
		return nil, fmt.Errorf("exam items: %w", err)
	}
	defer rows.Close()
	out := []exam.ExamItem{}
	for rows.Next() {
		var it exam.ExamItem
		q, err := scanQuestion(rows, &it.ID, &it.Ord, &it.Number, &it.Points, &it.Answer, &it.AttemptID,
			&it.Score, &it.AttemptCorrect, &it.Judge)
		if err != nil {
			return nil, err
		}
		it.Question = *q
		out = append(out, it)
	}
	return out, rows.Err()
}

// Start moves a ready exam to in_progress on the server's clock.
func (s *ExamStore) Start(ctx context.Context, userID, examID uuid.UUID, limit *int, now time.Time) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE exams
		   SET status = 'in_progress', started_at = $3,
		       time_limit_minutes = COALESCE($4, time_limit_minutes), updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status = 'ready'`, examID, userID, now, limit)
	if err != nil {
		return false, fmt.Errorf("exam: start: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// SaveAnswers stores answers, all or none. Ownership is settled before
// state: an item that is not this exam's, or an exam that is not this
// user's, is not found — whatever state the exam is in.
func (s *ExamStore) SaveAnswers(ctx context.Context, userID, examID uuid.UUID, answers []exam.Answer, now time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var (
		status    string
		submitted *time.Time
	)
	err = tx.QueryRow(ctx, `SELECT status, submitted_at FROM exams WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		examID, userID).Scan(&status, &submitted)
	if errors.Is(err, pgx.ErrNoRows) {
		return exam.ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("exam answers: lock: %w", err)
	}
	ids := make([]uuid.UUID, 0, len(answers))
	for _, a := range answers {
		ids = append(ids, a.ItemID)
	}
	var owned int
	if err := tx.QueryRow(ctx, `SELECT count(DISTINCT id) FROM exam_items
		 WHERE exam_id = $1 AND user_id = $2 AND id = ANY($3)`, examID, userID, ids).Scan(&owned); err != nil {
		return fmt.Errorf("exam answers: check: %w", err)
	}
	if owned != len(distinct(ids)) {
		return exam.ErrNotFound
	}
	if status != exam.ExamInProgress || submitted != nil {
		return exam.ErrConflict
	}
	for _, a := range answers {
		if _, err := tx.Exec(ctx, `
			UPDATE exam_items SET answer = $4, answered_at = $5
			 WHERE id = $1 AND exam_id = $2 AND user_id = $3`,
			a.ItemID, examID, userID, a.Text, now); err != nil {
			return fmt.Errorf("exam answers: save: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// BeginSubmit sets submitted_at once, on an exam in progress.
func (s *ExamStore) BeginSubmit(ctx context.Context, userID, examID uuid.UUID, now time.Time) (*exam.Exam, error) {
	e, err := scanExam(s.pool.QueryRow(ctx, `
		UPDATE exams AS e SET submitted_at = COALESCE(submitted_at, $3), updated_at = now()
		 WHERE e.id = $1 AND e.user_id = $2 AND e.status IN ('in_progress', 'submitted')
		 RETURNING `+examColumns, examID, userID, now))
	if errors.Is(err, exam.ErrNotFound) {
		if _, gerr := s.GetExam(ctx, userID, examID); gerr == nil {
			return nil, exam.ErrConflict
		}
	}
	return e, err
}

// SaveMark records an item's attempt and score, once.
func (s *ExamStore) SaveMark(ctx context.Context, userID, itemID, attemptID uuid.UUID, score float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE exam_items SET attempt_id = $3, score = $4
		 WHERE id = $1 AND user_id = $2 AND attempt_id IS NULL`, itemID, userID, attemptID, score)
	return err
}

// FinishMarking records the total and closes the exam.
func (s *ExamStore) FinishMarking(ctx context.Context, userID, examID uuid.UUID, score, max float64) error {
	_, err := s.pool.Exec(ctx, `
		UPDATE exams SET status = 'submitted', score = $3, max_score = $4, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`, examID, userID, score, max)
	return err
}

// DeleteExam removes an exam and its items; the questions stay in the bank.
func (s *ExamStore) DeleteExam(ctx context.Context, userID, id uuid.UUID) (*exam.Exam, error) {
	return scanExam(s.pool.QueryRow(ctx,
		`DELETE FROM exams AS e WHERE e.id = $1 AND e.user_id = $2 RETURNING `+examColumns, id, userID))
}

// JobProgress reads a job's checkpoint, scoped to its owner.
func (s *ExamStore) JobProgress(ctx context.Context, userID, jobID uuid.UUID) (jobs.Progress, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT progress FROM jobs WHERE id = $1 AND user_id = $2`,
		jobID, userID).Scan(&raw); err != nil {
		return jobs.Progress{}, err
	}
	return jobs.ProgressOf(&jobs.Job{Progress: raw}), nil
}

// ExamReapHandler settles a template or an exam whose job gave up, in the
// same transaction as the job's final write: without it, a job out of
// attempts leaves its row saying "extracting" or "generating" forever.
func ExamReapHandler() jobs.ReapHandler {
	return func(ctx context.Context, tx pgx.Tx, job jobs.ReapedJob) error {
		if !job.Terminal || (job.Kind != jobs.KindExtractExam && job.Kind != jobs.KindGenerateExam) {
			return nil
		}
		// The payload and the reason are read from the row: Queue.Fail hands
		// the gave-up handler no payload.
		var (
			raw    []byte
			reason string
		)
		_ = tx.QueryRow(ctx, `SELECT payload, last_error FROM jobs WHERE id = $1`, job.ID).Scan(&raw, &reason)
		if len(job.Payload) > 0 {
			raw = job.Payload
		}
		var p struct {
			TemplateID uuid.UUID `json:"template_id"`
			ExamID     uuid.UUID `json:"exam_id"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil
		}
		if reason == "" {
			reason = "the job stopped and was retried as many times as allowed"
		}
		if job.Kind == jobs.KindExtractExam {
			_, err := tx.Exec(ctx, `
				UPDATE exam_templates SET status = 'failed', error = left($3, 2000), updated_at = now()
				 WHERE id = $1 AND user_id = $2 AND status NOT IN ('review', 'ready')`,
				p.TemplateID, job.UserID, reason)
			return err
		}
		_, err := tx.Exec(ctx, finishGenerationSQL, p.ExamID, job.UserID, reason)
		return err
	}
}

func distinct(ids []uuid.UUID) map[uuid.UUID]bool {
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}
