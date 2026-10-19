package pg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/body"
)

// BodyStore is the pgx implementation of body.Store and body.CoachStore.
//
// Every statement names user_id, and the composite keys (id, user_id) make
// the week and a workout's routine the owner's at the database too: Alice's
// routine id in Bob's week is a foreign-key violation, reported as
// body.ErrNotFound like any other id that is not his.
type BodyStore struct{ pool *Pool }

// NewBodyStore builds a BodyStore over the shared pool.
func NewBodyStore(pool *Pool) *BodyStore { return &BodyStore{pool: pool} }

const dayFormat = "2006-01-02"

// ── profile ──────────────────────────────────────────────────────────────

// Profile implements body.Store; a learner with no row has the defaults.
func (s *BodyStore) Profile(ctx context.Context, userID uuid.UUID) (body.Profile, error) {
	p := body.DefaultProfile()
	var intake []byte
	err := s.pool.QueryRow(ctx, `SELECT unit, goal_weight::float8, rest_sec, intake FROM body_profiles WHERE user_id = $1`, userID).
		Scan(&p.Unit, &p.GoalWeight, &p.RestSec, &intake)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, fmt.Errorf("body profile: %w", err)
	}
	if len(intake) > 0 {
		var in body.Intake
		if err := json.Unmarshal(intake, &in); err == nil {
			p.Intake = &in
		}
	}
	return p, nil
}

// SaveProfile implements body.Store. The unit is not written here: only
// ConvertUnit changes it, together with the numbers it qualifies.
func (s *BodyStore) SaveProfile(ctx context.Context, userID uuid.UUID, p body.Profile) error {
	var intake []byte
	if p.Intake != nil {
		intake, _ = json.Marshal(p.Intake)
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO body_profiles (user_id, goal_weight, rest_sec, intake) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET goal_weight = $2, rest_sec = $3, intake = $4, updated_at = now()`,
		userID, p.GoalWeight, p.RestSec, intake)
	if err != nil {
		return fmt.Errorf("save body profile: %w", err)
	}
	return nil
}

func conv(v, factor float64) float64 { return math.Round(v*factor*10) / 10 }

// ConvertUnit implements body.Store: every weight the learner has stored, in
// one transaction, so a half-converted log is never visible.
func (s *BodyStore) ConvertUnit(ctx context.Context, userID uuid.UUID, unit string, factor float64) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO body_profiles (user_id, unit) VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET unit = $2,
			    goal_weight = round(body_profiles.goal_weight * $3::numeric, 1), updated_at = now()`,
			userID, unit, factor); err != nil {
			return fmt.Errorf("convert profile: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE body_weights SET weight = round(weight * $2::numeric, 1) WHERE user_id = $1`, userID, factor); err != nil {
			return fmt.Errorf("convert weights: %w", err)
		}
		// Routines: the target weight and the load step.
		routines, err := s.routines(ctx, tx, userID)
		if err != nil {
			return err
		}
		for _, r := range routines {
			for i := range r.Exercises {
				r.Exercises[i].Weight = conv(r.Exercises[i].Weight, factor)
				r.Exercises[i].Inc = conv(r.Exercises[i].Inc, factor)
			}
			raw, _ := json.Marshal(r.Exercises)
			if _, err := tx.Exec(ctx, `UPDATE body_routines SET exercises = $3 WHERE id = $1 AND user_id = $2`, r.ID, userID, raw); err != nil {
				return fmt.Errorf("convert routine: %w", err)
			}
		}
		// Workouts: every set, every target, the advice's numbers and the
		// weigh-in.
		workouts, err := s.queryWorkouts(ctx, tx, `WHERE user_id = $1`, userID)
		if err != nil {
			return err
		}
		for _, w := range workouts {
			for i := range w.Entries {
				e := &w.Entries[i]
				e.Target.Weight, e.Target.Inc = conv(e.Target.Weight, factor), conv(e.Target.Inc, factor)
				for j := range e.Sets {
					e.Sets[j].Weight = conv(e.Sets[j].Weight, factor)
				}
				if e.Advice != nil {
					if e.Advice.Weight != nil {
						v := conv(*e.Advice.Weight, factor)
						e.Advice.Weight = &v
					}
					if e.Target.Mode != body.ModeTime {
						e.Advice.Step = conv(e.Advice.Step, factor)
					}
				}
			}
			raw, _ := json.Marshal(w.Entries)
			if _, err := tx.Exec(ctx, `
				UPDATE body_workouts SET entries = $3, bodyweight = round(bodyweight * $4::numeric, 1)
				 WHERE id = $1 AND user_id = $2`, w.ID, userID, raw, factor); err != nil {
				return fmt.Errorf("convert workout: %w", err)
			}
		}
		return nil
	})
}

// ── routines ─────────────────────────────────────────────────────────────

const routineSelect = `SELECT id, user_id, name, prog, why, exercises, position, created_at, updated_at FROM body_routines`

func scanRoutine(row pgx.Row) (*body.Routine, error) {
	var r body.Routine
	var raw []byte
	if err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.Prog, &r.Why, &raw, &r.Position, &r.CreatedAt, &r.UpdatedAt); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &r.Exercises); err != nil {
		return nil, fmt.Errorf("routine %s exercises: %w", r.ID, err)
	}
	if r.Exercises == nil {
		r.Exercises = []body.PlanExercise{}
	}
	return &r, nil
}

// bodyQuerier is the pool or a transaction.
type bodyQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (s *BodyStore) routines(ctx context.Context, q bodyQuerier, userID uuid.UUID) ([]body.Routine, error) {
	rows, err := q.Query(ctx, routineSelect+` WHERE user_id = $1 ORDER BY position, created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("list routines: %w", err)
	}
	defer rows.Close()
	out := []body.Routine{}
	for rows.Next() {
		r, err := scanRoutine(rows)
		if err != nil {
			return nil, fmt.Errorf("scan routine: %w", err)
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// Routines implements body.Store.
func (s *BodyStore) Routines(ctx context.Context, userID uuid.UUID) ([]body.Routine, error) {
	return s.routines(ctx, s.pool, userID)
}

// Routine implements body.Store.
func (s *BodyStore) Routine(ctx context.Context, userID, id uuid.UUID) (*body.Routine, error) {
	r, err := scanRoutine(s.pool.QueryRow(ctx, routineSelect+` WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, body.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get routine: %w", err)
	}
	return r, nil
}

func insertRoutine(ctx context.Context, q bodyQuerier, r body.Routine) (*body.Routine, error) {
	raw, _ := json.Marshal(r.Exercises)
	out, err := scanRoutine(q.QueryRow(ctx, `
		INSERT INTO body_routines (user_id, name, prog, why, exercises, position) VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, user_id, name, prog, why, exercises, position, created_at, updated_at`,
		r.UserID, r.Name, r.Prog, r.Why, raw, r.Position))
	if err != nil {
		return nil, fmt.Errorf("create routine: %w", err)
	}
	return out, nil
}

// CreateRoutine implements body.Store.
func (s *BodyStore) CreateRoutine(ctx context.Context, r body.Routine) (*body.Routine, error) {
	return insertRoutine(ctx, s.pool, r)
}

// UpdateRoutine implements body.Store.
func (s *BodyStore) UpdateRoutine(ctx context.Context, r body.Routine) (*body.Routine, error) {
	raw, _ := json.Marshal(r.Exercises)
	out, err := scanRoutine(s.pool.QueryRow(ctx, `
		UPDATE body_routines SET name = $3, prog = $4, exercises = $5, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, name, prog, why, exercises, position, created_at, updated_at`,
		r.ID, r.UserID, r.Name, r.Prog, raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, body.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("update routine: %w", err)
	}
	return out, nil
}

// DeleteRoutine implements body.Store.
func (s *BodyStore) DeleteRoutine(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM body_routines WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete routine: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return body.ErrNotFound
	}
	return nil
}

func (s *BodyStore) week(ctx context.Context, q bodyQuerier, userID uuid.UUID) (body.Week, error) {
	var w body.Week
	rows, err := q.Query(ctx, `SELECT weekday, routine_id FROM body_week WHERE user_id = $1`, userID)
	if err != nil {
		return w, fmt.Errorf("week: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d int
		var id uuid.UUID
		if err := rows.Scan(&d, &id); err != nil {
			return w, fmt.Errorf("scan week: %w", err)
		}
		w[d] = &id
	}
	return w, rows.Err()
}

// Week implements body.Store.
func (s *BodyStore) Week(ctx context.Context, userID uuid.UUID) (body.Week, error) {
	return s.week(ctx, s.pool, userID)
}

// SetWeek implements body.Store. Each routine id is resolved with the
// caller's user_id inside the transaction (and again by the composite key).
func (s *BodyStore) SetWeek(ctx context.Context, userID uuid.UUID, w body.Week) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		for _, id := range w {
			if id == nil {
				continue
			}
			var ok bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM body_routines WHERE id = $1 AND user_id = $2)`, *id, userID).Scan(&ok); err != nil {
				return fmt.Errorf("check routine: %w", err)
			}
			if !ok {
				return body.ErrNotFound
			}
		}
		return writeWeek(ctx, tx, userID, w)
	})
}

func writeWeek(ctx context.Context, tx pgx.Tx, userID uuid.UUID, w body.Week) error {
	if _, err := tx.Exec(ctx, `DELETE FROM body_week WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear week: %w", err)
	}
	for d, id := range w {
		if id == nil {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO body_week (user_id, weekday, routine_id) VALUES ($1, $2, $3)`, userID, d, *id); err != nil {
			return fmt.Errorf("set week: %w", err)
		}
	}
	return nil
}

// ── workouts ─────────────────────────────────────────────────────────────

const workoutSelect = `SELECT id, user_id, routine_id, routine_name, day, started_at, finished_at, bodyweight::float8, entries, note FROM body_workouts `

func scanWorkout(row pgx.Row) (*body.Workout, error) {
	var w body.Workout
	var day time.Time
	var raw []byte
	if err := row.Scan(&w.ID, &w.UserID, &w.RoutineID, &w.RoutineName, &day, &w.StartedAt, &w.FinishedAt, &w.Bodyweight, &raw, &w.Note); err != nil {
		return nil, err
	}
	w.Day = day.Format(dayFormat)
	if err := json.Unmarshal(raw, &w.Entries); err != nil {
		return nil, fmt.Errorf("workout %s entries: %w", w.ID, err)
	}
	if w.Entries == nil {
		w.Entries = []body.Entry{}
	}
	return &w, nil
}

func (s *BodyStore) queryWorkouts(ctx context.Context, q bodyQuerier, where string, args ...any) ([]body.Workout, error) {
	rows, err := q.Query(ctx, workoutSelect+where, args...)
	if err != nil {
		return nil, fmt.Errorf("list workouts: %w", err)
	}
	defer rows.Close()
	out := []body.Workout{}
	for rows.Next() {
		w, err := scanWorkout(rows)
		if err != nil {
			return nil, fmt.Errorf("scan workout: %w", err)
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

// OpenWorkout implements body.Store.
func (s *BodyStore) OpenWorkout(ctx context.Context, userID uuid.UUID) (*body.Workout, error) {
	w, err := scanWorkout(s.pool.QueryRow(ctx, workoutSelect+`WHERE user_id = $1 AND finished_at IS NULL`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open workout: %w", err)
	}
	return w, nil
}

// CreateWorkout implements body.Store. A second start while one is open
// meets the partial unique index and returns the open one.
func (s *BodyStore) CreateWorkout(ctx context.Context, w body.Workout) (*body.Workout, bool, error) {
	raw, _ := json.Marshal(w.Entries)
	out, err := scanWorkout(s.pool.QueryRow(ctx, `
		INSERT INTO body_workouts (user_id, routine_id, routine_name, day, started_at, bodyweight, entries)
		VALUES ($1, $2, $3, $4::date, $5, $6, $7)
		ON CONFLICT (user_id) WHERE finished_at IS NULL DO NOTHING
		RETURNING id, user_id, routine_id, routine_name, day, started_at, finished_at, bodyweight::float8, entries, note`,
		w.UserID, w.RoutineID, w.RoutineName, w.Day, w.StartedAt, w.Bodyweight, raw))
	if errors.Is(err, pgx.ErrNoRows) {
		open, err := s.OpenWorkout(ctx, w.UserID)
		return open, false, err
	}
	if err != nil {
		if isForeignKeyViolation(err) {
			return nil, false, body.ErrNotFound
		}
		return nil, false, fmt.Errorf("create workout: %w", err)
	}
	return out, true, nil
}

// Workout implements body.Store.
func (s *BodyStore) Workout(ctx context.Context, userID, id uuid.UUID) (*body.Workout, error) {
	w, err := scanWorkout(s.pool.QueryRow(ctx, workoutSelect+`WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, body.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get workout: %w", err)
	}
	return w, nil
}

// SaveWorkout implements body.Store.
func (s *BodyStore) SaveWorkout(ctx context.Context, w body.Workout) (*body.Workout, error) {
	raw, _ := json.Marshal(w.Entries)
	out, err := scanWorkout(s.pool.QueryRow(ctx, `
		UPDATE body_workouts SET entries = $3, bodyweight = $4, note = $5, updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING id, user_id, routine_id, routine_name, day, started_at, finished_at, bodyweight::float8, entries, note`,
		w.ID, w.UserID, raw, w.Bodyweight, w.Note))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, body.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("save workout: %w", err)
	}
	return out, nil
}

// FinishWorkout implements body.Store.
func (s *BodyStore) FinishWorkout(ctx context.Context, userID, id uuid.UUID, at time.Time) (*body.Workout, error) {
	out, err := scanWorkout(s.pool.QueryRow(ctx, `
		UPDATE body_workouts SET finished_at = $3, updated_at = now()
		 WHERE id = $1 AND user_id = $2 AND finished_at IS NULL
		RETURNING id, user_id, routine_id, routine_name, day, started_at, finished_at, bodyweight::float8, entries, note`,
		id, userID, at))
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := s.Workout(ctx, userID, id); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("%w: this workout is already finished", body.ErrConflict)
	}
	if err != nil {
		return nil, fmt.Errorf("finish workout: %w", err)
	}
	return out, nil
}

// DeleteWorkout implements body.Store.
func (s *BodyStore) DeleteWorkout(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM body_workouts WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete workout: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return body.ErrNotFound
	}
	return nil
}

// Workouts implements body.Store: the latest `limit` finished workouts on or
// after `from`, returned oldest first.
func (s *BodyStore) Workouts(ctx context.Context, userID uuid.UUID, from string, limit int) ([]body.Workout, error) {
	list, err := s.queryWorkouts(ctx, s.pool, `
		WHERE user_id = $1 AND finished_at IS NOT NULL AND day >= $2::date
		ORDER BY day DESC, started_at DESC LIMIT $3`, userID, from, limit)
	if err != nil {
		return nil, err
	}
	for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
		list[i], list[j] = list[j], list[i]
	}
	return list, nil
}

// ── body weight ──────────────────────────────────────────────────────────

// Weights implements body.Store, oldest first.
func (s *BodyStore) Weights(ctx context.Context, userID uuid.UUID, from string) ([]body.Weight, error) {
	rows, err := s.pool.Query(ctx, `SELECT day, weight::float8 FROM body_weights WHERE user_id = $1 AND day >= $2::date ORDER BY day`, userID, from)
	if err != nil {
		return nil, fmt.Errorf("list weights: %w", err)
	}
	defer rows.Close()
	out := []body.Weight{}
	for rows.Next() {
		var d time.Time
		var w body.Weight
		if err := rows.Scan(&d, &w.Weight); err != nil {
			return nil, fmt.Errorf("scan weight: %w", err)
		}
		w.Day = d.Format(dayFormat)
		out = append(out, w)
	}
	return out, rows.Err()
}

// SetWeight implements body.Store.
func (s *BodyStore) SetWeight(ctx context.Context, userID uuid.UUID, w body.Weight) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO body_weights (user_id, day, weight) VALUES ($1, $2::date, $3)
		ON CONFLICT (user_id, day) DO UPDATE SET weight = $3`, userID, w.Day, w.Weight)
	if err != nil {
		return fmt.Errorf("set weight: %w", err)
	}
	return nil
}

// DeleteWeight implements body.Store.
func (s *BodyStore) DeleteWeight(ctx context.Context, userID uuid.UUID, day string) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM body_weights WHERE user_id = $1 AND day = $2::date`, userID, day)
	if err != nil {
		return fmt.Errorf("delete weight: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return body.ErrNotFound
	}
	return nil
}

// ── coach proposals ──────────────────────────────────────────────────────

const proposalSelect = `
	SELECT p.id, p.user_id, p.kind, p.status, p.intake, p.request, p.plan, p.changes, p.notes, p.nochange,
	       p.reading, p.created_at, p.decided_at,
	       p.status = 'accepted' AND p.previous IS NOT NULL AND NOT EXISTS (
	           SELECT 1 FROM body_proposals q
	            WHERE q.user_id = p.user_id AND q.status = 'accepted' AND q.plan IS NOT NULL
	              AND q.decided_at > p.decided_at)
	  FROM body_proposals p`

func scanProposal(row pgx.Row) (*body.Proposal, error) {
	var p body.Proposal
	var intake, plan, changes, notes []byte
	if err := row.Scan(&p.ID, &p.UserID, &p.Kind, &p.Status, &intake, &p.Request, &plan, &changes, &notes,
		&p.NoChange, &p.Reading, &p.CreatedAt, &p.DecidedAt, &p.CanRevert); err != nil {
		return nil, err
	}
	if len(intake) > 0 {
		p.Intake = new(body.Intake)
		if err := json.Unmarshal(intake, p.Intake); err != nil {
			return nil, fmt.Errorf("proposal %s intake: %w", p.ID, err)
		}
	}
	if len(plan) > 0 {
		p.Plan = new(body.CoachPlan)
		if err := json.Unmarshal(plan, p.Plan); err != nil {
			return nil, fmt.Errorf("proposal %s plan: %w", p.ID, err)
		}
	}
	if err := json.Unmarshal(changes, &p.Changes); err != nil {
		return nil, fmt.Errorf("proposal %s changes: %w", p.ID, err)
	}
	if err := json.Unmarshal(notes, &p.Notes); err != nil {
		return nil, fmt.Errorf("proposal %s notes: %w", p.ID, err)
	}
	return &p, nil
}

func jsonOrNil(v any, isNil bool) []byte {
	if isNil {
		return nil
	}
	b, _ := json.Marshal(v)
	return b
}

// CreateProposal implements body.CoachStore.
func (s *BodyStore) CreateProposal(ctx context.Context, p body.Proposal) (*body.Proposal, error) {
	if p.Changes == nil {
		p.Changes = []body.Change{}
	}
	if p.Notes == nil {
		p.Notes = []string{}
	}
	changes, _ := json.Marshal(p.Changes)
	notes, _ := json.Marshal(p.Notes)
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO body_proposals (user_id, kind, status, intake, request, plan, changes, notes, nochange, reading)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		p.UserID, p.Kind, p.Status, jsonOrNil(p.Intake, p.Intake == nil), p.Request, jsonOrNil(p.Plan, p.Plan == nil),
		changes, notes, p.NoChange, p.Reading).Scan(&id)
	if err != nil {
		return nil, fmt.Errorf("create proposal: %w", err)
	}
	return s.Proposal(ctx, p.UserID, id)
}

// Proposal implements body.CoachStore.
func (s *BodyStore) Proposal(ctx context.Context, userID, id uuid.UUID) (*body.Proposal, error) {
	p, err := scanProposal(s.pool.QueryRow(ctx, proposalSelect+` WHERE p.id = $1 AND p.user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, body.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get proposal: %w", err)
	}
	return p, nil
}

// Proposals implements body.CoachStore, newest first. Replaced drafts are
// left out: the revision that replaced them is the one to read.
func (s *BodyStore) Proposals(ctx context.Context, userID uuid.UUID, limit int) ([]body.Proposal, error) {
	rows, err := s.pool.Query(ctx, proposalSelect+`
		WHERE p.user_id = $1 AND p.status <> 'replaced' ORDER BY p.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list proposals: %w", err)
	}
	defer rows.Close()
	out := []body.Proposal{}
	for rows.Next() {
		p, err := scanProposal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan proposal: %w", err)
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// SetProposalStatus implements body.CoachStore.
func (s *BodyStore) SetProposalStatus(ctx context.Context, userID, id uuid.UUID, from []string, to string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE body_proposals SET status = $3, decided_at = now()
		 WHERE id = $1 AND user_id = $2 AND status = ANY($4)`, id, userID, to, from)
	if err != nil {
		return false, fmt.Errorf("set proposal status: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// replacePlan swaps the learner's routines and week for a plan's, inside tx.
func replacePlan(ctx context.Context, tx pgx.Tx, userID uuid.UUID, plan body.CoachPlan) error {
	if _, err := tx.Exec(ctx, `DELETE FROM body_routines WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear routines: %w", err)
	}
	routines, index := body.PlanRoutines(userID, plan)
	ids := make([]uuid.UUID, len(routines))
	for i, r := range routines {
		created, err := insertRoutine(ctx, tx, r)
		if err != nil {
			return err
		}
		ids[i] = created.ID
	}
	var week body.Week
	for d, i := range index {
		if i >= 0 {
			week[d] = &ids[i]
		}
	}
	return writeWeek(ctx, tx, userID, week)
}

// lockPlan serialises every accept and revert of one learner's plan.
func lockPlan(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "body-plan:"+userID.String()); err != nil {
		return fmt.Errorf("lock plan: %w", err)
	}
	return nil
}

// lockProposal reads a proposal's status and stored plan under a row lock.
func lockProposal(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID, column string) (string, []byte, error) {
	var status string
	var raw []byte
	err := tx.QueryRow(ctx, `SELECT status, `+column+` FROM body_proposals WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).Scan(&status, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, body.ErrNotFound
	}
	if err != nil {
		return "", nil, fmt.Errorf("lock proposal: %w", err)
	}
	return status, raw, nil
}

// AcceptProposal implements body.CoachStore.
func (s *BodyStore) AcceptProposal(ctx context.Context, userID, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockPlan(ctx, tx, userID); err != nil {
			return err
		}
		status, raw, err := lockProposal(ctx, tx, userID, id, "plan")
		if err != nil {
			return err
		}
		if status != body.StatusProposed || len(raw) == 0 {
			return fmt.Errorf("%w: this proposal was already decided", body.ErrConflict)
		}
		var plan body.CoachPlan
		if err := json.Unmarshal(raw, &plan); err != nil {
			return fmt.Errorf("proposal plan: %w", err)
		}
		routines, err := s.routines(ctx, tx, userID)
		if err != nil {
			return err
		}
		week, err := s.week(ctx, tx, userID)
		if err != nil {
			return err
		}
		previous, _ := json.Marshal(body.SnapshotPlan(routines, week))
		if err := replacePlan(ctx, tx, userID, plan); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE body_proposals SET status = 'accepted', decided_at = clock_timestamp(), previous = $3
			 WHERE id = $1 AND user_id = $2`, id, userID, previous)
		return err
	})
}

// RevertProposal implements body.CoachStore.
func (s *BodyStore) RevertProposal(ctx context.Context, userID, id uuid.UUID) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := lockPlan(ctx, tx, userID); err != nil {
			return err
		}
		status, raw, err := lockProposal(ctx, tx, userID, id, "previous")
		if err != nil {
			return err
		}
		if status != body.StatusAccepted || len(raw) == 0 {
			return fmt.Errorf("%w: only an accepted plan change can be undone", body.ErrConflict)
		}
		var later bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM body_proposals q, body_proposals p
			                WHERE p.id = $1 AND q.user_id = $2 AND q.status = 'accepted' AND q.plan IS NOT NULL
			                  AND q.decided_at > p.decided_at)`, id, userID).Scan(&later); err != nil {
			return fmt.Errorf("check later: %w", err)
		}
		if later {
			return fmt.Errorf("%w: a later change was accepted since; undo that one first", body.ErrConflict)
		}
		var plan body.CoachPlan
		if err := json.Unmarshal(raw, &plan); err != nil {
			return fmt.Errorf("proposal previous: %w", err)
		}
		if err := replacePlan(ctx, tx, userID, plan); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE body_proposals SET status = 'reverted', decided_at = clock_timestamp() WHERE id = $1 AND user_id = $2`, id, userID)
		return err
	})
}
