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

	"github.com/D0bby999/anytools/internal/capabilities/mastery"
	"github.com/D0bby999/anytools/internal/capabilities/quiz"
	"github.com/D0bby999/anytools/internal/learning"
)

// MasteryStore is the mastery path's persistence.
//
// It shares a package with QuestionStore because the two halves meet inside one
// transaction: `advance` below is called from QuestionStore.RecordAttempt with
// that transaction's handle, and writes the card and the error record beside
// the attempt. Splitting them into two packages would mean exporting a
// transaction across a package boundary, which is how a "transaction" quietly
// becomes three separate ones.
type MasteryStore struct {
	pool  *Pool
	sched *learning.Scheduler
}

// NewMasteryStore builds a MasteryStore over the shared pool.
func NewMasteryStore(pool *Pool) *MasteryStore {
	return &MasteryStore{pool: pool, sched: learning.NewScheduler()}
}

// ── the transactional half: one attempt's effect on the schedule ──────────

type advanceInput struct {
	UserID     uuid.UUID
	KPID       uuid.UUID
	ModuleID   *uuid.UUID
	QuestionID uuid.UUID
	AttemptID  uuid.UUID
	Correct    bool
	Rating     string
	Now        time.Time
}

// advance applies one attempt to a knowledge point's card, inside the caller's
// transaction. The question's mistake is RecordAttempt's (applyMistake), for
// every question, with or without a knowledge point.
//
// The card is read FOR UPDATE and written in the same transaction as the
// attempt. Without the row lock, two answers submitted at once — a double-click
// on the answer button is enough — both read the same card, both compute a next
// state from it, and the second write silently discards the first review. FSRS
// state is a fold over history; a lost fold is a lost review that the learner
// can see no trace of.
func (s *QuestionStore) advance(ctx context.Context, tx pgx.Tx, in advanceInput) (*quiz.Scheduled, error) {
	// Seed a fresh card if this is the point's first review. RETURNING tells us
	// whether THIS transaction created the row, which is what the snapshot
	// below must record: a concurrent first attempt that lost the race sees the
	// winner's committed row, not a fresh one.
	fresh := s.sched.NewCard(in.Now)
	freshJSON, err := json.Marshal(fresh)
	if err != nil {
		return nil, fmt.Errorf("advance: encode new card: %w", err)
	}
	var seeded uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO kp_state (kp_id, user_id, fsrs_card, due_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (kp_id) DO NOTHING
		RETURNING kp_id`,
		in.KPID, in.UserID, freshJSON, fresh.Due).Scan(&seeded)
	created := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("advance: seed card: %w", err)
	}

	var (
		cardJSON []byte
		estimate float64
		status   string
		snap     kpSnapshot
	)
	err = tx.QueryRow(ctx, `
		SELECT fsrs_card, due_at, mastery_estimate, status, reviews, lapses
		  FROM kp_state
		 WHERE kp_id = $1 AND user_id = $2
		 FOR UPDATE`, in.KPID, in.UserID).Scan(
		&cardJSON, &snap.DueAt, &estimate, &status, &snap.Reviews, &snap.Lapses)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, quiz.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("advance: load card: %w", err)
	}
	snap.Fresh = created
	snap.Card, snap.Estimate, snap.Status = cardJSON, estimate, status
	snapJSON, err := json.Marshal(snap)
	if err != nil {
		return nil, fmt.Errorf("advance: encode snapshot: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE question_attempts SET kp_before = $3 WHERE id = $1 AND user_id = $2`,
		in.AttemptID, in.UserID, snapJSON); err != nil {
		return nil, fmt.Errorf("advance: record snapshot: %w", err)
	}

	var card learning.Card
	if len(cardJSON) > 0 {
		if err := json.Unmarshal(cardJSON, &card); err != nil {
			return nil, fmt.Errorf("advance: decode card: %w", err)
		}
	}

	next, err := s.sched.Next(card, in.Now, in.Rating)
	if err != nil {
		return nil, err
	}
	nextJSON, err := json.Marshal(next)
	if err != nil {
		return nil, fmt.Errorf("advance: encode card: %w", err)
	}
	estimate = learning.MasteryEstimate(estimate, in.Correct)

	// A wrong answer REACTIVATES a graduated point. Graduation retires a card;
	// it does not claim the memory is permanent, and a point that has just been
	// missed is by definition not retired.
	nextStatus := status
	if !in.Correct {
		nextStatus = mastery.KPActive
	}

	if _, err := tx.Exec(ctx, `
		UPDATE kp_state
		   SET fsrs_card = $3,
		       due_at = $4,
		       mastery_estimate = $5,
		       status = $6,
		       reviews = reviews + 1,
		       lapses = $7,
		       updated_at = now()
		 WHERE kp_id = $1 AND user_id = $2`,
		in.KPID, in.UserID, nextJSON, next.Due, estimate, nextStatus, int(next.Lapses)); err != nil {
		return nil, fmt.Errorf("advance: write card: %w", err)
	}

	return &quiz.Scheduled{
		KnowledgePointID: in.KPID,
		DueAt:            next.Due,
		MasteryEstimate:  estimate,
		Rating:           in.Rating,
		Lapses:           int(next.Lapses),
	}, nil
}

// kpSnapshot is a kp_state row as it stood before an attempt advanced it,
// stored on the attempt as `kp_before` so an override can replay from it.
type kpSnapshot struct {
	Fresh    bool            `json:"fresh,omitempty"`
	Card     json.RawMessage `json:"card"`
	DueAt    time.Time       `json:"due_at"`
	Estimate float64         `json:"estimate"`
	Status   string          `json:"status"`
	Reviews  int             `json:"reviews"`
	Lapses   int             `json:"lapses"`
}

// restoreKPState puts a knowledge point back to a snapshot. A fresh snapshot
// means the attempt being corrected created the row, so the row goes; the
// replay seeds it again.
func restoreKPState(ctx context.Context, tx pgx.Tx, userID, kpID uuid.UUID, raw []byte) error {
	var snap kpSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return fmt.Errorf("override: decode snapshot: %w", err)
	}
	if snap.Fresh {
		_, err := tx.Exec(ctx, `DELETE FROM kp_state WHERE kp_id = $1 AND user_id = $2`, kpID, userID)
		if err != nil {
			return fmt.Errorf("override: reset card: %w", err)
		}
		return nil
	}
	if _, err := tx.Exec(ctx, `
		UPDATE kp_state
		   SET fsrs_card = $3, due_at = $4, mastery_estimate = $5, status = $6,
		       reviews = $7, lapses = $8, updated_at = now()
		 WHERE kp_id = $1 AND user_id = $2`,
		kpID, userID, []byte(snap.Card), snap.DueAt, snap.Estimate, snap.Status,
		snap.Reviews, snap.Lapses); err != nil {
		return fmt.Errorf("override: restore card: %w", err)
	}
	return nil
}

// ── paths ─────────────────────────────────────────────────────────────────

const pathColumns = `id, user_id, kb_id, goal, status, created_at, updated_at`

// CreatePath inserts a path.
func (s *MasteryStore) CreatePath(ctx context.Context, p mastery.Path) (*mastery.Path, error) {
	status := p.Status
	if status == "" {
		status = mastery.StatusActive
	}
	row := s.pool.QueryRow(ctx,
		`INSERT INTO mastery_paths (user_id, kb_id, goal, status)
		 VALUES ($1, $2, $3, $4) RETURNING `+pathColumns,
		p.UserID, p.KBID, p.Goal, status)
	return scanPath(row)
}

// GetPath reads one path scoped to its owner.
func (s *MasteryStore) GetPath(ctx context.Context, userID, pathID uuid.UUID) (*mastery.Path, error) {
	row := s.pool.QueryRow(ctx,
		`SELECT `+pathColumns+` FROM mastery_paths WHERE id = $1 AND user_id = $2`,
		pathID, userID)
	return scanPath(row)
}

// ArchivePath retires a path without deleting its evidence.
//
// Archive rather than delete: phase 10's evidence loop reads mastery_events,
// and a deleted path takes with it the record that someone graduated a module
// in March. "I am done with this" and "this never happened" are different
// statements.
func (s *MasteryStore) ArchivePath(ctx context.Context, userID, pathID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE mastery_paths SET status = 'archived', updated_at = now()
		  WHERE id = $1 AND user_id = $2 AND status <> 'archived'`, pathID, userID)
	if err != nil {
		return fmt.Errorf("archive path: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either it is not this user's, or it was already archived. Both are
		// answered as "not found" for the same reason every other id endpoint
		// in this codebase does.
		return mastery.ErrNotFound
	}
	return nil
}

// ListPaths returns a user's paths with the numbers the list screen shows.
func (s *MasteryStore) ListPaths(ctx context.Context, userID uuid.UUID, now time.Time) ([]mastery.PathSummary, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.user_id, p.kb_id, p.goal, p.status, p.created_at, p.updated_at,
		       COALESCE(kb.name, ''),
		       COALESCE(agg.modules, 0), COALESCE(agg.points, 0),
		       COALESCE(agg.due, 0), COALESCE(agg.mastery, 0), COALESCE(agg.graduated, 0)
		  FROM mastery_paths p
		  LEFT JOIN knowledge_bases kb ON kb.id = p.kb_id AND kb.user_id = p.user_id
		  LEFT JOIN LATERAL (
		      SELECT count(DISTINCT m.id) AS modules,
		             count(kp.id) AS points,
		             count(*) FILTER (
		                 WHERE st.due_at <= $2 AND COALESCE(st.status, 'active') = 'active'
		             ) AS due,
		             AVG(COALESCE(st.mastery_estimate, 0)) AS mastery,
		             count(DISTINCT m.id) FILTER (
		                 WHERE NOT EXISTS (
		                     SELECT 1 FROM knowledge_points kp2
		                       JOIN kp_state st2 ON st2.kp_id = kp2.id AND st2.user_id = kp2.user_id
		                      WHERE kp2.module_id = m.id AND st2.status = 'active'
		                 )
		             ) AS graduated
		        FROM mastery_modules m
		        LEFT JOIN knowledge_points kp ON kp.module_id = m.id AND kp.user_id = m.user_id
		        LEFT JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		       WHERE m.path_id = p.id AND m.user_id = p.user_id
		  ) agg ON true
		 WHERE p.user_id = $1
		 ORDER BY p.created_at DESC, p.id`, userID, now)
	if err != nil {
		return nil, fmt.Errorf("list paths: %w", err)
	}
	defer rows.Close()

	out := []mastery.PathSummary{}
	for rows.Next() {
		var sum mastery.PathSummary
		if err := rows.Scan(
			&sum.Path.ID, &sum.Path.UserID, &sum.Path.KBID, &sum.Path.Goal, &sum.Path.Status,
			&sum.Path.CreatedAt, &sum.Path.UpdatedAt, &sum.KBName,
			&sum.Modules, &sum.Points, &sum.DueCount, &sum.Mastery, &sum.Graduated,
		); err != nil {
			return nil, fmt.Errorf("list paths: scan: %w", err)
		}
		out = append(out, sum)
	}
	return out, rows.Err()
}

// ApproveModules writes the approved plan and seeds one card per knowledge
// point, in one transaction.
//
// It REFUSES a path that already has modules. Re-approving would delete the
// existing modules, and the cascade takes the knowledge points, their cards,
// and the knowledge-point link on every question ever asked about them — the
// learner's whole history against that path, silently, in response to a button
// labelled "approve". Editing an existing plan is a different feature with a
// different migration story; this is the honest refusal in the meantime.
func (s *MasteryStore) ApproveModules(
	ctx context.Context, userID, pathID uuid.UUID, modules []mastery.ProposedModule, now time.Time,
) (*mastery.PathDetail, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("approve modules: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var owner uuid.UUID
	err = tx.QueryRow(ctx,
		`SELECT user_id FROM mastery_paths WHERE id = $1 AND user_id = $2 FOR UPDATE`,
		pathID, userID).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("approve modules: load path: %w", err)
	}

	var existing int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM mastery_modules WHERE path_id = $1 AND user_id = $2`,
		pathID, userID).Scan(&existing); err != nil {
		return nil, fmt.Errorf("approve modules: count: %w", err)
	}
	if existing > 0 {
		return nil, fmt.Errorf("%w: this path is already planned; archive it and start a new one to change the modules",
			mastery.ErrBadRequest)
	}

	fresh := s.sched.NewCard(now)
	freshJSON, err := json.Marshal(fresh)
	if err != nil {
		return nil, fmt.Errorf("approve modules: encode card: %w", err)
	}

	for ord, m := range modules {
		var moduleID uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO mastery_modules (user_id, path_id, ord, name, objective, pass_threshold)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			userID, pathID, ord, m.Name, m.Objective, m.PassThreshold).Scan(&moduleID); err != nil {
			return nil, fmt.Errorf("approve modules: insert module: %w", err)
		}
		for _, kp := range m.KnowledgePoints {
			var kpID uuid.UUID
			if err := tx.QueryRow(ctx, `
				INSERT INTO knowledge_points (user_id, module_id, name, type)
				VALUES ($1, $2, $3, $4) RETURNING id`,
				userID, moduleID, kp.Name, kp.Type).Scan(&kpID); err != nil {
				return nil, fmt.Errorf("approve modules: insert knowledge point: %w", err)
			}
			// Every point starts DUE. A plan whose cards are scheduled for some
			// future date the learner did not choose is a plan they cannot
			// start today, which is the day they approved it.
			if _, err := tx.Exec(ctx, `
				INSERT INTO kp_state (kp_id, user_id, fsrs_card, due_at)
				VALUES ($1, $2, $3, $4)`,
				kpID, userID, freshJSON, fresh.Due); err != nil {
				return nil, fmt.Errorf("approve modules: seed card: %w", err)
			}
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE mastery_paths SET updated_at = now() WHERE id = $1 AND user_id = $2`,
		pathID, userID); err != nil {
		return nil, fmt.Errorf("approve modules: touch path: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("approve modules: commit: %w", err)
	}
	return s.Detail(ctx, userID, pathID, now)
}

// Detail returns the whole path: modules, knowledge points, and each point's
// schedule.
func (s *MasteryStore) Detail(ctx context.Context, userID, pathID uuid.UUID, now time.Time) (*mastery.PathDetail, error) {
	path, err := s.GetPath(ctx, userID, pathID)
	if err != nil {
		return nil, err
	}
	detail := &mastery.PathDetail{Path: *path, Modules: []mastery.ModuleView{}}

	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(name, '') FROM knowledge_bases WHERE id = $1 AND user_id = $2`,
		path.KBID, userID).Scan(&detail.KBName); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("path detail: kb name: %w", err)
	}

	rows, err := s.pool.Query(ctx, `
		SELECT m.id, m.user_id, m.path_id, m.ord, m.name, m.objective, m.pass_threshold,
		       kp.id, kp.module_id, kp.name, kp.type,
		       COALESCE(st.due_at, $3), COALESCE(st.mastery_estimate, 0),
		       COALESCE(st.status, 'active'), COALESCE(st.reviews, 0), COALESCE(st.lapses, 0)
		  FROM mastery_modules m
		  LEFT JOIN knowledge_points kp ON kp.module_id = m.id AND kp.user_id = m.user_id
		  LEFT JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		 WHERE m.user_id = $1 AND m.path_id = $2
		 ORDER BY m.ord, kp.name, kp.id`, userID, pathID, now)
	if err != nil {
		return nil, fmt.Errorf("path detail: %w", err)
	}
	defer rows.Close()

	byModule := map[uuid.UUID]int{}
	var allEstimates []float64
	for rows.Next() {
		var (
			m     mastery.Module
			kpID  *uuid.UUID
			kpMod *uuid.UUID
			name  *string
			kind  *string
			state mastery.KPState
		)
		if err := rows.Scan(&m.ID, &m.UserID, &m.PathID, &m.Ord, &m.Name, &m.Objective, &m.PassThreshold,
			&kpID, &kpMod, &name, &kind,
			&state.DueAt, &state.MasteryEstimate, &state.Status, &state.Reviews, &state.Lapses); err != nil {
			return nil, fmt.Errorf("path detail: scan: %w", err)
		}

		idx, seen := byModule[m.ID]
		if !seen {
			detail.Modules = append(detail.Modules, mastery.ModuleView{
				Module: m, KnowledgePoints: []mastery.KPView{},
			})
			idx = len(detail.Modules) - 1
			byModule[m.ID] = idx
		}
		if kpID == nil {
			continue
		}

		view := mastery.KPView{
			KnowledgePoint: mastery.KnowledgePoint{
				ID: *kpID, UserID: userID, ModuleID: *kpMod,
				Name: derefString(name), Type: derefString(kind),
			},
			State: state,
			Due:   state.Status == mastery.KPActive && !state.DueAt.After(now),
		}
		detail.Modules[idx].KnowledgePoints = append(detail.Modules[idx].KnowledgePoints, view)
		if view.Due {
			detail.Modules[idx].DueCount++
			detail.DueCount++
		}
		allEstimates = append(allEstimates, state.MasteryEstimate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range detail.Modules {
		estimates := make([]float64, 0, len(detail.Modules[i].KnowledgePoints))
		active := 0
		for _, kp := range detail.Modules[i].KnowledgePoints {
			estimates = append(estimates, kp.State.MasteryEstimate)
			if kp.State.Status == mastery.KPActive {
				active++
			}
		}
		detail.Modules[i].Mastery = learning.ModuleMastery(estimates)
		// A module is SHOWN as graduated when nothing in it is still active —
		// which is what Graduate() writes. The mastery number is displayed
		// beside it rather than recomputed into the flag, so a module that was
		// graduated and then lapsed reads as "graduated, and one point is back",
		// not as a flag silently flipping under the learner.
		detail.Modules[i].Graduated = len(detail.Modules[i].KnowledgePoints) > 0 && active == 0
	}
	detail.Mastery = learning.ModuleMastery(allEstimates)
	return detail, nil
}

// Candidates returns the path's active knowledge points, with the numbers
// learning.Rank orders by.
func (s *MasteryStore) Candidates(ctx context.Context, userID, pathID uuid.UUID) ([]learning.Candidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kp.id, kp.name, kp.type,
		       m.id, m.name, m.ord,
		       AVG(COALESCE(st.mastery_estimate, 0)) OVER (PARTITION BY m.id) AS module_mastery,
		       COALESCE(st.mastery_estimate, 0), st.due_at
		  FROM knowledge_points kp
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		  JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		 WHERE kp.user_id = $1 AND m.path_id = $2 AND st.status = 'active'`, userID, pathID)
	if err != nil {
		return nil, fmt.Errorf("mastery candidates: %w", err)
	}
	defer rows.Close()

	out := []learning.Candidate{}
	for rows.Next() {
		var c learning.Candidate
		if err := rows.Scan(&c.KPID, &c.KPName, &c.Type, &c.ModuleID, &c.ModuleName, &c.ModuleOrd,
			&c.ModuleMastery, &c.MasteryEstimate, &c.DueAt); err != nil {
			return nil, fmt.Errorf("mastery candidates: scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// KnowledgePoint reads one point and the module it belongs to.
func (s *MasteryStore) KnowledgePoint(ctx context.Context, userID, kpID uuid.UUID) (*mastery.KnowledgePoint, *mastery.Module, error) {
	var (
		kp mastery.KnowledgePoint
		m  mastery.Module
	)
	err := s.pool.QueryRow(ctx, `
		SELECT kp.id, kp.user_id, kp.module_id, kp.name, kp.type,
		       m.id, m.user_id, m.path_id, m.ord, m.name, m.objective, m.pass_threshold
		  FROM knowledge_points kp
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		 WHERE kp.id = $1 AND kp.user_id = $2`, kpID, userID).
		Scan(&kp.ID, &kp.UserID, &kp.ModuleID, &kp.Name, &kp.Type,
			&m.ID, &m.UserID, &m.PathID, &m.Ord, &m.Name, &m.Objective, &m.PassThreshold)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("knowledge point: %w", err)
	}
	return &kp, &m, nil
}

// UnansweredQuestion returns a banked question for this knowledge point that
// the learner has never attempted.
func (s *MasteryStore) UnansweredQuestion(ctx context.Context, userID, kpID uuid.UUID) (*quiz.Question, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT `+questionColumns+`
		  FROM questions q
		 WHERE q.user_id = $1 AND q.knowledge_point_id = $2
		   AND NOT EXISTS (
		       SELECT 1 FROM question_attempts a
		        WHERE a.question_id = q.id AND a.user_id = q.user_id
		   )
		 ORDER BY q.created_at, q.id
		 LIMIT 1`, userID, kpID)
	return scanQuestion(row)
}

// dueFrom is the due set across every ACTIVE path: $1 the user, $2 now. Due
// and ReviewCandidates both read it, so the list on Home and the cross-path
// session can never disagree about what is waiting.
const dueFrom = `
		  FROM kp_state st
		  JOIN knowledge_points kp ON kp.id = st.kp_id AND kp.user_id = st.user_id
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		  JOIN mastery_paths p ON p.id = m.path_id AND p.user_id = m.user_id
		 WHERE st.user_id = $1 AND st.status = 'active'
		   AND st.due_at <= $2 AND p.status = 'active'
		 ORDER BY st.due_at, kp.id
		 LIMIT $3`

// Due lists what is waiting across every ACTIVE path, computed on read.
func (s *MasteryStore) Due(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]mastery.DueItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kp.id, kp.name, kp.type, m.id, m.name, p.id, p.goal, st.due_at`+dueFrom, userID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("mastery due: %w", err)
	}
	defer rows.Close()

	out := []mastery.DueItem{}
	for rows.Next() {
		var d mastery.DueItem
		if err := rows.Scan(&d.KPID, &d.KPName, &d.Type, &d.ModuleID, &d.ModuleName,
			&d.PathID, &d.PathGoal, &d.DueAt); err != nil {
			return nil, fmt.Errorf("mastery due: scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ReviewCandidates is Due with the module columns learning.Rank needs, for
// the cross-path review. Unlike Candidates it is due-only and bounded: a
// learner with a thousand points in one path must not make every review step
// read all of them (red team AS-11).
func (s *MasteryStore) ReviewCandidates(ctx context.Context, userID uuid.UUID, now time.Time, limit int) ([]mastery.ReviewCandidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT kp.id, kp.name, kp.type, m.id, m.name, m.ord,
		       (SELECT AVG(COALESCE(ms.mastery_estimate, 0))
		          FROM knowledge_points mk
		          JOIN kp_state ms ON ms.kp_id = mk.id AND ms.user_id = mk.user_id
		         WHERE mk.module_id = m.id AND mk.user_id = m.user_id AND ms.status = 'active'),
		       COALESCE(st.mastery_estimate, 0), st.due_at, p.id, p.goal`+dueFrom, userID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("mastery review candidates: %w", err)
	}
	defer rows.Close()

	out := []mastery.ReviewCandidate{}
	for rows.Next() {
		var c mastery.ReviewCandidate
		if err := rows.Scan(&c.KPID, &c.KPName, &c.Type, &c.ModuleID, &c.ModuleName, &c.ModuleOrd,
			&c.ModuleMastery, &c.MasteryEstimate, &c.DueAt, &c.PathID, &c.PathGoal); err != nil {
			return nil, fmt.Errorf("mastery review candidates: scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// LastAttemptedPoint is the knowledge point of the learner's most recent
// mastery question attempt, across every path. ok is false when they have
// never answered one.
//
// The cross-path review reads its "previous point" here rather than from the
// client, so the alternation survives a reload or a second tab.
func (s *MasteryStore) LastAttemptedPoint(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	var kpID uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT knowledge_point_id
		  FROM question_attempts
		 WHERE user_id = $1 AND knowledge_point_id IS NOT NULL
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1`, userID).Scan(&kpID)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("last attempted point: %w", err)
	}
	return kpID, true, nil
}

// DueDigests is the nightly job's query: every user with something due now.
//
// It is the ONE method in this file that is not user-scoped, because a digest
// is by definition across users. It is also why the job that calls it is
// advisory-locked: two processes running this at 03:00 would each send every
// user the same summary.
func (s *MasteryStore) DueDigests(ctx context.Context, now time.Time) ([]mastery.DueDigest, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT st.user_id,
		       count(*) FILTER (WHERE st.due_at <= $1) AS due,
		       count(DISTINCT p.id) FILTER (WHERE st.due_at <= $1) AS paths,
		       min(st.due_at) FILTER (WHERE st.due_at > $1) AS next_due
		  FROM kp_state st
		  JOIN knowledge_points kp ON kp.id = st.kp_id AND kp.user_id = st.user_id
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		  JOIN mastery_paths p ON p.id = m.path_id AND p.user_id = m.user_id
		 WHERE st.status = 'active' AND p.status = 'active'
		 GROUP BY st.user_id
		HAVING count(*) FILTER (WHERE st.due_at <= $1) > 0
		 ORDER BY st.user_id`, now)
	if err != nil {
		return nil, fmt.Errorf("due digests: %w", err)
	}
	defer rows.Close()

	out := []mastery.DueDigest{}
	for rows.Next() {
		var d mastery.DueDigest
		if err := rows.Scan(&d.UserID, &d.Due, &d.Paths, &d.NextDue); err != nil {
			return nil, fmt.Errorf("due digests: scan: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Graduate retires every module that has crossed its bar.
//
// Idempotent by construction: a module whose points are all `graduated` has no
// active points, and the query requires at least one. Calling it after every
// attempt therefore costs one query and writes nothing until something changes.
func (s *MasteryStore) Graduate(ctx context.Context, userID, pathID uuid.UUID, now time.Time) ([]mastery.GraduatedModule, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("graduate: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT m.id, m.name, stats.mastery
		  FROM mastery_modules m
		  JOIN LATERAL (
		      SELECT AVG(COALESCE(st.mastery_estimate, 0)) AS mastery,
		             count(*) FILTER (WHERE st.status = 'active') AS active,
		             count(*) FILTER (WHERE st.status = 'active' AND st.due_at <= $3) AS due,
		             count(*) FILTER (WHERE kp.type IN ('concept', 'design')
		                                AND st.explain_passed_at IS NULL) AS unexplained
		        FROM knowledge_points kp
		        JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = kp.user_id
		       WHERE kp.module_id = m.id AND kp.user_id = m.user_id
		  ) stats ON true
		  JOIN mastery_paths p ON p.id = m.path_id AND p.user_id = m.user_id
		 WHERE m.user_id = $1 AND m.path_id = $2
		   AND stats.active > 0
		   AND stats.due = 0
		   AND stats.mastery >= m.pass_threshold
		   -- Learning-depth phase 2: on a gated path every concept and design
		   -- point needs a passed explain-back. Older paths are not gated.
		   AND (NOT p.explain_gate OR stats.unexplained = 0)
		 ORDER BY m.ord
		 FOR UPDATE OF m`, userID, pathID, now)
	if err != nil {
		return nil, fmt.Errorf("graduate: %w", err)
	}

	var graduated []mastery.GraduatedModule
	for rows.Next() {
		var g mastery.GraduatedModule
		if err := rows.Scan(&g.ModuleID, &g.Name, &g.Mastery); err != nil {
			rows.Close()
			return nil, fmt.Errorf("graduate: scan: %w", err)
		}
		graduated = append(graduated, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, g := range graduated {
		if _, err := tx.Exec(ctx, `
			UPDATE kp_state
			   SET status = 'graduated', updated_at = now()
			  FROM knowledge_points kp
			 WHERE kp_state.kp_id = kp.id
			   AND kp_state.user_id = $1
			   AND kp.module_id = $2
			   AND kp_state.status = 'active'`, userID, g.ModuleID); err != nil {
			return nil, fmt.Errorf("graduate: retire cards: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("graduate: commit: %w", err)
	}
	return graduated, nil
}

// AppendEvent writes one append-only event and returns its revision.
//
// The revision is computed from the table under the unique constraint rather
// than from a counter, and a collision is RETRIED rather than surfaced. Two
// attempts finishing at once on one path is ordinary, and the correct outcome
// is two events with adjacent revisions — not a 500 for the second learner
// action that happened to be concurrent with the first.
func (s *MasteryStore) AppendEvent(
	ctx context.Context, userID, pathID uuid.UUID, eventType string, payload any,
) (int64, error) {
	blob, err := json.Marshal(payload)
	if err != nil {
		return 0, fmt.Errorf("append event: encode payload: %w", err)
	}
	if payload == nil {
		blob = []byte(`{}`)
	}

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var revision int64
		err := s.pool.QueryRow(ctx, `
			INSERT INTO mastery_events (user_id, path_id, revision, type, payload)
			SELECT $1, $2, COALESCE(max(e.revision), 0) + 1, $3, $4::jsonb
			  FROM mastery_events e WHERE e.path_id = $2
			RETURNING revision`, userID, pathID, eventType, blob).Scan(&revision)
		if err == nil {
			return revision, nil
		}
		lastErr = err
		if !isUniqueViolation(err, constraintMasteryEventRevision) {
			break
		}
	}
	return 0, fmt.Errorf("append event: %w", lastErr)
}

// constraintMasteryEventRevision is the unique index AppendEvent races against.
// Named rather than matched by SQLSTATE alone, so a different unique violation
// inside the same statement is not silently retried three times and then
// reported as a revision collision.
const constraintMasteryEventRevision = "mastery_events_path_revision_unique"

// OpenErrors lists a path's unresolved mistakes.
func (s *MasteryStore) OpenErrors(ctx context.Context, userID, pathID uuid.UUID, limit int) ([]mastery.ErrorRecordView, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT e.id, e.question_id, q.prompt, COALESCE(kp.name, ''),
		       e.error_type, e.self_attribution, e.ai_confirmation,
		       jsonb_array_length(e.retry_history), e.status, e.updated_at
		  FROM error_records e
		  JOIN questions q ON q.id = e.question_id AND q.user_id = e.user_id
		  JOIN mastery_modules m ON m.id = e.module_id AND m.user_id = e.user_id
		  LEFT JOIN knowledge_points kp ON kp.id = e.kp_id AND kp.user_id = e.user_id
		 WHERE e.user_id = $1 AND m.path_id = $2 AND e.status <> 'graduated'
		 ORDER BY e.updated_at DESC, e.id
		 LIMIT $3`, userID, pathID, limit)
	if err != nil {
		return nil, fmt.Errorf("open errors: %w", err)
	}
	defer rows.Close()

	out := []mastery.ErrorRecordView{}
	for rows.Next() {
		var v mastery.ErrorRecordView
		if err := rows.Scan(&v.ID, &v.QuestionID, &v.Prompt, &v.KPName,
			&v.ErrorType, &v.SelfAttribution, &v.AIConfirmation,
			&v.Retries, &v.Status, &v.UpdatedAt); err != nil {
			return nil, fmt.Errorf("open errors: scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// ── scanning ──────────────────────────────────────────────────────────────

func scanPath(row pgx.Row) (*mastery.Path, error) {
	var p mastery.Path
	err := row.Scan(&p.ID, &p.UserID, &p.KBID, &p.Goal, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, mastery.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("scan path: %w", err)
	}
	return &p, nil
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Outline summarises a knowledge base's structure for the path proposal.
//
// Titles plus distinct heading paths, not chunk text. A proposal needs to know
// what the material COVERS, and the cheapest honest answer to that is its own
// table of contents: sending twelve retrieved passages instead would plan a
// path around whichever twelve passages a vector search happened to return for
// a query nobody wrote.
func (s *MasteryStore) Outline(ctx context.Context, userID, kbID uuid.UUID, limit int) (string, error) {
	if limit <= 0 || limit > 200 {
		limit = 60
	}

	var b strings.Builder
	docs, err := s.pool.Query(ctx, `
		SELECT title, page_count, status
		  FROM documents
		 WHERE user_id = $1 AND kb_id = $2
		 ORDER BY created_at
		 LIMIT 50`, userID, kbID)
	if err != nil {
		return "", fmt.Errorf("kb outline: documents: %w", err)
	}
	defer docs.Close()

	count := 0
	b.WriteString("Documents:\n")
	for docs.Next() {
		var (
			title  string
			pages  int
			status string
		)
		if err := docs.Scan(&title, &pages, &status); err != nil {
			return "", fmt.Errorf("kb outline: scan document: %w", err)
		}
		// Only documents that are actually indexed. A queued or failed upload
		// is material the learner cannot be quizzed on yet, and planning a
		// module around it produces a module that generates nothing.
		if status != "ready" {
			continue
		}
		count++
		fmt.Fprintf(&b, "- %s (%d pages)\n", title, pages)
	}
	if err := docs.Err(); err != nil {
		return "", err
	}
	if count == 0 {
		return "", nil
	}

	headings, err := s.pool.Query(ctx, `
		SELECT DISTINCT heading_path
		  FROM chunks
		 WHERE user_id = $1 AND kb_id = $2 AND heading_path <> ''
		 ORDER BY heading_path
		 LIMIT $3`, userID, kbID, limit)
	if err != nil {
		return "", fmt.Errorf("kb outline: headings: %w", err)
	}
	defer headings.Close()

	wrote := false
	for headings.Next() {
		var path string
		if err := headings.Scan(&path); err != nil {
			return "", fmt.Errorf("kb outline: scan heading: %w", err)
		}
		if !wrote {
			b.WriteString("\nSections:\n")
			wrote = true
		}
		fmt.Fprintf(&b, "- %s\n", path)
	}
	return b.String(), headings.Err()
}
