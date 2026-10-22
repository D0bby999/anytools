package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/progress"
)

// ProgressStore is study days, goals and milestones (internal/progress).
type ProgressStore struct{ pool *Pool }

// NewProgressStore builds a ProgressStore.
func NewProgressStore(pool *Pool) *ProgressStore { return &ProgressStore{pool: pool} }

var _ progress.Store = (*ProgressStore)(nil)

// Settings implements progress.Store.
func (s *ProgressStore) Settings(ctx context.Context, user uuid.UUID) (string, progress.Settings, time.Time, time.Time, error) {
	var zone string
	var set progress.Settings
	var counted, refreshed *time.Time
	err := s.pool.QueryRow(ctx, `SELECT timezone, week_goal, rest_days, study_counted_on, study_refreshed_at FROM users WHERE id = $1`, user).
		Scan(&zone, &set.WeekGoal, &set.RestDays, &counted, &refreshed)
	if err != nil {
		return "", progress.Settings{}, time.Time{}, time.Time{}, fmt.Errorf("progress settings: %w", err)
	}
	var c, r time.Time
	if counted != nil {
		c = time.Date(counted.Year(), counted.Month(), counted.Day(), 0, 0, 0, 0, time.UTC)
	}
	if refreshed != nil {
		r = *refreshed
	}
	return zone, set, c, r, nil
}

// SetSettings implements progress.Store.
func (s *ProgressStore) SetSettings(ctx context.Context, user uuid.UUID, set progress.Settings) error {
	if _, err := s.pool.Exec(ctx, `UPDATE users SET week_goal = $2, rest_days = $3 WHERE id = $1`, user, set.WeekGoal, set.RestDays); err != nil {
		return fmt.Errorf("progress set settings: %w", err)
	}
	return nil
}

// studySources are the activity that makes a study day, each as (local day,
// kind) rows from $3 (an instant) and $4 (a local day) on. A new kind of
// study is added here and as a column of study_days.
const studySources = `
	SELECT (created_at AT TIME ZONE $2)::date AS day, 'reviews' AS kind
	  FROM vocab_reviews WHERE user_id = $1 AND created_at >= $3
	UNION ALL
	SELECT (created_at AT TIME ZONE $2)::date, 'questions'
	  FROM question_attempts WHERE user_id = $1 AND created_at >= $3
	UNION ALL
	SELECT (created_at AT TIME ZONE $2)::date, 'explains'
	  FROM explain_back_attempts WHERE user_id = $1 AND created_at >= $3
	UNION ALL
	SELECT day, 'workouts'
	  FROM body_workouts WHERE user_id = $1 AND finished_at IS NOT NULL AND day >= $4
	UNION ALL
	SELECT (created_at AT TIME ZONE $2)::date, 'recordings'
	  FROM worksheet_recordings WHERE user_id = $1 AND created_at >= $3
	UNION ALL
	SELECT (created_at AT TIME ZONE $2)::date, 'highlights'
	  FROM reading_highlights WHERE user_id = $1 AND created_at >= $3
	UNION ALL
	SELECT (created_at AT TIME ZONE $2)::date, 'skill'
	  FROM card_entries WHERE user_id = $1 AND created_at >= $3`

// RefreshDays implements progress.Store. Under a per-learner lock, so two
// tabs reading progress at once do not count twice.
func (s *ProgressStore) RefreshDays(ctx context.Context, user uuid.UUID, zone string, from, today time.Time) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('study-days:' || $1::text, 0))`, user); err != nil {
		return err
	}
	// The instant the first local day begins, a day early so no zone is
	// short of hours; the day filter below trims it.
	since := time.Date(1970, 1, 1, 0, 0, 0, 0, time.UTC)
	if !from.IsZero() {
		since = from.AddDate(0, 0, -1)
	} else {
		from = since
	}
	if _, err := tx.Exec(ctx, `DELETE FROM study_days WHERE user_id = $1 AND day >= $2`, user, from); err != nil {
		return fmt.Errorf("progress refresh: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO study_days (user_id, day, reviews, questions, explains, workouts, recordings, highlights, skill)
		SELECT $1, day,
		       count(*) FILTER (WHERE kind = 'reviews'),
		       count(*) FILTER (WHERE kind = 'questions'),
		       count(*) FILTER (WHERE kind = 'explains'),
		       count(*) FILTER (WHERE kind = 'workouts'),
		       count(*) FILTER (WHERE kind = 'recordings'),
		       count(*) FILTER (WHERE kind = 'highlights'),
		       count(*) FILTER (WHERE kind = 'skill')
		  FROM (`+studySources+`) src
		 WHERE day >= $4 AND day <= $5
		 GROUP BY day`, user, zone, since, from, today); err != nil {
		return fmt.Errorf("progress refresh: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE users SET study_counted_on = $2, study_refreshed_at = now() WHERE id = $1`, user, today); err != nil {
		return fmt.Errorf("progress refresh: %w", err)
	}
	return tx.Commit(ctx)
}

// Days implements progress.Store.
func (s *ProgressStore) Days(ctx context.Context, user uuid.UUID) ([]progress.StudyDay, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT day, reviews, questions, explains, workouts, recordings, highlights, skill
		  FROM study_days WHERE user_id = $1 ORDER BY day`, user)
	if err != nil {
		return nil, fmt.Errorf("progress days: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (progress.StudyDay, error) {
		var d progress.StudyDay
		c := &d.Counts
		err := row.Scan(&d.Day, &c.Reviews, &c.Questions, &c.Explains, &c.Workouts, &c.Recordings, &c.Highlights, &c.Skill)
		d.Day = time.Date(d.Day.Year(), d.Day.Month(), d.Day.Day(), 0, 0, 0, 0, time.UTC)
		return d, err
	})
}

// Outcomes implements progress.Store.
func (s *ProgressStore) Outcomes(ctx context.Context, user uuid.UUID, since time.Time) (progress.Outcomes, error) {
	var o progress.Outcomes
	var reviewsRight, reviews, questionsRight, questions int
	err := s.pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*) FILTER (WHERE (fsrs_card->>'Stability')::float8 >= $3)
		     FROM vocab_cards WHERE user_id = $1 AND NOT suspended AND reps > 0),
		  (SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND NOT suspended AND reps > 0),
		  (SELECT count(*) FROM kp_state WHERE user_id = $1 AND status = 'graduated'),
		  (SELECT count(*) FROM explain_back_attempts WHERE user_id = $1 AND passed),
		  (SELECT count(*) FILTER (WHERE rating <> 'again') FROM vocab_reviews WHERE user_id = $1 AND created_at >= $2),
		  (SELECT count(*) FROM vocab_reviews WHERE user_id = $1 AND created_at >= $2),
		  (SELECT count(*) FILTER (WHERE is_correct) FROM question_attempts WHERE user_id = $1 AND created_at >= $2),
		  (SELECT count(*) FROM question_attempts WHERE user_id = $1 AND created_at >= $2)`,
		user, since, float64(progress.LongTermDays)).
		Scan(&o.LongTerm, &o.Learning, &o.Mastered, &o.ExplainsPassed, &reviewsRight, &reviews, &questionsRight, &questions)
	if err != nil {
		return o, fmt.Errorf("progress outcomes: %w", err)
	}
	o.Right, o.Answered = reviewsRight+questionsRight, reviews+questions
	return o, nil
}

// Reach implements progress.Store.
func (s *ProgressStore) Reach(ctx context.Context, user uuid.UUID, reached map[string]time.Time) (map[string]time.Time, error) {
	if len(reached) > 0 {
		keys, days := make([]string, 0, len(reached)), make([]time.Time, 0, len(reached))
		for k, d := range reached {
			keys, days = append(keys, k), append(days, d)
		}
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO progress_milestones (user_id, key, reached_on)
			SELECT $1, k, d FROM unnest($2::text[], $3::date[]) AS m(k, d)
			ON CONFLICT (user_id, key) DO NOTHING`, user, keys, days); err != nil {
			return nil, fmt.Errorf("progress reach: %w", err)
		}
	}
	rows, err := s.pool.Query(ctx, `SELECT key, reached_on FROM progress_milestones WHERE user_id = $1`, user)
	if err != nil {
		return nil, fmt.Errorf("progress milestones: %w", err)
	}
	out := map[string]time.Time{}
	for rows.Next() {
		var k string
		var d time.Time
		if err := rows.Scan(&k, &d); err != nil {
			rows.Close()
			return nil, err
		}
		out[k] = d
	}
	if err := rows.Err(); err != nil {
		return nil, errors.Join(errors.New("progress milestones"), err)
	}
	return out, nil
}
