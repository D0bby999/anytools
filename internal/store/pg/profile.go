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

	"github.com/D0bby999/anytools/internal/learning/profile"
)

// ProfileStore is the pgx implementation of the learner profile: entries,
// proposals, consolidation runs, and the aggregates consolidation reads.
//
// Every statement names user_id. The ids inside `refs` have no foreign key,
// so they are resolved with the owner's user_id when a proposal is saved AND
// whenever an entry is read back: a mistake graduated and deleted since, or a
// row that was never the owner's, reads back as "no longer exists" with no
// label — never as a link to someone else's row.
type ProfileStore struct{ pool *Pool }

// NewProfileStore builds a ProfileStore over the shared pool.
func NewProfileStore(pool *Pool) *ProfileStore { return &ProfileStore{pool: pool} }

const entrySelect = `
	SELECT e.id, e.user_id, e.section, e.text, e.refs, e.origin, e.status, e.op,
	       e.replaces_id, COALESCE(r.text, ''), e.kb_id, COALESCE(k.name, ''), e.run_id,
	       e.decided_at, e.created_at, e.updated_at
	  FROM profile_entries e
	  LEFT JOIN profile_entries r ON r.id = e.replaces_id AND r.user_id = e.user_id
	  LEFT JOIN knowledge_bases k ON k.id = e.kb_id AND k.user_id = e.user_id`

// scanEntries reads entrySelect rows, returning each entry's stored refs.
func scanEntries(rows pgx.Rows) ([]profile.Entry, [][]profile.Ref, error) {
	defer rows.Close()
	var out []profile.Entry
	var refs [][]profile.Ref
	for rows.Next() {
		var e profile.Entry
		var raw []byte
		if err := rows.Scan(&e.ID, &e.UserID, &e.Section, &e.Text, &raw, &e.Origin, &e.Status, &e.Op,
			&e.ReplacesID, &e.ReplacesText, &e.KBID, &e.KBName, &e.RunID,
			&e.DecidedAt, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, nil, fmt.Errorf("scan profile entry: %w", err)
		}
		var stored []profile.Ref
		if err := json.Unmarshal(raw, &stored); err != nil {
			return nil, nil, fmt.Errorf("profile entry %s refs: %w", e.ID, err)
		}
		out = append(out, e)
		refs = append(refs, stored)
	}
	return out, refs, rows.Err()
}

// ── the learner's side ───────────────────────────────────────────────────

// List implements profile.Store: everything but rejected proposals, oldest
// first within each section, with refs resolved for the owner.
func (s *ProfileStore) List(ctx context.Context, userID uuid.UUID) ([]profile.Entry, error) {
	rows, err := s.pool.Query(ctx, entrySelect+`
	 WHERE e.user_id = $1 AND e.status <> 'rejected'
	 ORDER BY e.created_at, e.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("list profile: %w", err)
	}
	entries, refs, err := scanEntries(rows)
	if err != nil {
		return nil, err
	}
	return entries, s.attachRefs(ctx, s.pool, userID, entries, refs)
}

func (s *ProfileStore) get(ctx context.Context, q pgx.Tx, userID, id uuid.UUID) (*profile.Entry, error) {
	rows, err := q.Query(ctx, entrySelect+` WHERE e.id = $1 AND e.user_id = $2`, id, userID)
	if err != nil {
		return nil, fmt.Errorf("get profile entry: %w", err)
	}
	entries, refs, err := scanEntries(rows)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, profile.ErrNotFound
	}
	if err := s.attachRefs(ctx, q, userID, entries, refs); err != nil {
		return nil, err
	}
	return &entries[0], nil
}

// lockProfile serialises one learner's profile writes on their user row, so
// two requests cannot both take a section's twelfth place.
func lockProfile(ctx context.Context, tx pgx.Tx, userID uuid.UUID) error {
	var one int
	err := tx.QueryRow(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile.ErrNotFound
	}
	return err
}

func sectionFull(ctx context.Context, tx pgx.Tx, userID uuid.UUID, section string, except uuid.UUID) (bool, error) {
	var n int
	err := tx.QueryRow(ctx, `
		SELECT count(*) FROM profile_entries
		 WHERE user_id = $1 AND section = $2 AND status = 'accepted' AND id <> $3`,
		userID, section, except).Scan(&n)
	return n >= profile.MaxPerSection, err
}

// ownsKB resolves a knowledge-base id with the caller's user_id.
func ownsKB(ctx context.Context, tx pgx.Tx, userID, kbID uuid.UUID) error {
	var one int
	err := tx.QueryRow(ctx, `SELECT 1 FROM knowledge_bases WHERE id = $1 AND user_id = $2`, kbID, userID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile.ErrNotFound
	}
	return err
}

func (s *ProfileStore) tx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("profile: begin: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Create implements profile.Store.
func (s *ProfileStore) Create(ctx context.Context, n profile.NewEntry) (*profile.Entry, error) {
	var out *profile.Entry
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := lockProfile(ctx, tx, n.UserID); err != nil {
			return err
		}
		if n.KBID != nil {
			if err := ownsKB(ctx, tx, n.UserID, *n.KBID); err != nil {
				return err
			}
		}
		full, err := sectionFull(ctx, tx, n.UserID, n.Section, uuid.Nil)
		if err != nil {
			return err
		}
		if full {
			return profile.ErrSectionFull
		}
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO profile_entries (user_id, section, text, origin, status, kb_id)
			VALUES ($1, $2, $3, 'learner', 'accepted', $4) RETURNING id`,
			n.UserID, n.Section, n.Text, n.KBID).Scan(&id); err != nil {
			return fmt.Errorf("insert profile entry: %w", err)
		}
		out, err = s.get(ctx, tx, n.UserID, id)
		return err
	})
	return out, err
}

// Update implements profile.Store. The edited entry becomes the learner's,
// and pending proposals to change it are withdrawn in the same transaction:
// consolidation never edits a learner entry, not even by a proposal written
// before the learner's edit.
func (s *ProfileStore) Update(ctx context.Context, userID, id uuid.UUID, p profile.EntryPatch) (*profile.Entry, error) {
	var out *profile.Entry
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := lockProfile(ctx, tx, userID); err != nil {
			return err
		}
		var section, status string
		err := tx.QueryRow(ctx, `SELECT section, status FROM profile_entries WHERE id = $1 AND user_id = $2`,
			id, userID).Scan(&section, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return profile.ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("load profile entry: %w", err)
		}
		if status != profile.StatusAccepted {
			return fmt.Errorf("%w: accept or reject a proposal before editing it", profile.ErrConflict)
		}
		if p.Section != nil && *p.Section != section {
			full, err := sectionFull(ctx, tx, userID, *p.Section, id)
			if err != nil {
				return err
			}
			if full {
				return profile.ErrSectionFull
			}
		}
		clearKB, setKB := false, (*uuid.UUID)(nil)
		if p.KBID != nil {
			if *p.KBID == uuid.Nil {
				clearKB = true
			} else {
				if err := ownsKB(ctx, tx, userID, *p.KBID); err != nil {
					return err
				}
				setKB = p.KBID
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE profile_entries
			   SET section = COALESCE($3, section), text = COALESCE($4, text),
			       kb_id = CASE WHEN $5 THEN NULL ELSE COALESCE($6, kb_id) END,
			       origin = 'learner', updated_at = now()
			 WHERE id = $1 AND user_id = $2`,
			id, userID, p.Section, p.Text, clearKB, setKB); err != nil {
			return fmt.Errorf("update profile entry: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM profile_entries WHERE user_id = $1 AND replaces_id = $2 AND status = 'proposed'`,
			userID, id); err != nil {
			return fmt.Errorf("withdraw proposals: %w", err)
		}
		out, err = s.get(ctx, tx, userID, id)
		return err
	})
	return out, err
}

// Delete implements profile.Store. Proposals to change the entry go with it
// (the replaces_id foreign key cascades).
func (s *ProfileStore) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM profile_entries WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete profile entry: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return profile.ErrNotFound
	}
	return nil
}

// proposalFor loads a proposal for accept or reject, locked.
func proposalFor(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID) (op, section, status string, replaces *uuid.UUID, err error) {
	err = tx.QueryRow(ctx, `
		SELECT op, section, status, replaces_id FROM profile_entries
		 WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID).Scan(&op, &section, &status, &replaces)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", nil, profile.ErrNotFound
	}
	if err != nil {
		return "", "", "", nil, fmt.Errorf("load proposal: %w", err)
	}
	if status != profile.StatusProposed {
		return "", "", "", nil, fmt.Errorf("%w: that entry is not a proposal", profile.ErrConflict)
	}
	return op, section, status, replaces, nil
}

// Accept implements profile.Store.
//
//   - add: the proposal becomes an accepted entry, if its section has room;
//   - update: the target takes the proposal's text, refs and knowledge base,
//     and the proposal is deleted;
//   - remove: the target is deleted, and the proposal with it.
//
// A target the learner has made their own since is not changed: the
// proposal is withdrawn and the answer is ErrConflict.
func (s *ProfileStore) Accept(ctx context.Context, userID, id uuid.UUID, now time.Time) (*profile.Entry, error) {
	var out *profile.Entry
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if err := lockProfile(ctx, tx, userID); err != nil {
			return err
		}
		op, section, _, replaces, err := proposalFor(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		if op == profile.OpAdd {
			full, err := sectionFull(ctx, tx, userID, section, id)
			if err != nil {
				return err
			}
			if full {
				return profile.ErrSectionFull
			}
			if _, err := tx.Exec(ctx, `
				UPDATE profile_entries SET status = 'accepted', decided_at = $3, updated_at = $3
				 WHERE id = $1 AND user_id = $2`, id, userID, now); err != nil {
				return fmt.Errorf("accept proposal: %w", err)
			}
			out, err = s.get(ctx, tx, userID, id)
			return err
		}

		var origin string
		if err := tx.QueryRow(ctx, `SELECT origin FROM profile_entries WHERE id = $1 AND user_id = $2 FOR UPDATE`,
			*replaces, userID).Scan(&origin); err != nil {
			return fmt.Errorf("load proposal target: %w", err)
		}
		if origin != profile.OriginConsolidated {
			if _, err := tx.Exec(ctx, `DELETE FROM profile_entries WHERE id = $1 AND user_id = $2`, id, userID); err != nil {
				return err
			}
			// Commit the withdrawal; the caller still hears the conflict.
			if err := tx.Commit(ctx); err != nil {
				return err
			}
			return fmt.Errorf("%w: that entry is now yours, so the proposal was withdrawn", profile.ErrConflict)
		}
		shown, err := s.get(ctx, tx, userID, id)
		if err != nil {
			return err
		}
		if op == profile.OpRemove {
			if _, err := tx.Exec(ctx, `DELETE FROM profile_entries WHERE id = $1 AND user_id = $2`, *replaces, userID); err != nil {
				return fmt.Errorf("remove profile entry: %w", err)
			}
			shown.Status, shown.DecidedAt = profile.StatusAccepted, &now
			out = shown
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE profile_entries t
			   SET text = p.text, refs = p.refs, kb_id = p.kb_id, run_id = p.run_id,
			       decided_at = $4, updated_at = $4
			  FROM profile_entries p
			 WHERE t.id = $1 AND t.user_id = $2 AND p.id = $3 AND p.user_id = $2`,
			*replaces, userID, id, now); err != nil {
			return fmt.Errorf("apply update: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM profile_entries WHERE id = $1 AND user_id = $2`, id, userID); err != nil {
			return fmt.Errorf("drop applied proposal: %w", err)
		}
		out, err = s.get(ctx, tx, userID, *replaces)
		return err
	})
	return out, err
}

// Reject implements profile.Store. The row is kept, as `rejected`, for
// RejectCooldown so the same statement is not proposed again.
func (s *ProfileStore) Reject(ctx context.Context, userID, id uuid.UUID, now time.Time) (*profile.Entry, error) {
	var out *profile.Entry
	err := s.tx(ctx, func(tx pgx.Tx) error {
		if _, _, _, _, err := proposalFor(ctx, tx, userID, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE profile_entries SET status = 'rejected', decided_at = $3, updated_at = $3
			 WHERE id = $1 AND user_id = $2`, id, userID, now); err != nil {
			return fmt.Errorf("reject proposal: %w", err)
		}
		var err error
		out, err = s.get(ctx, tx, userID, id)
		return err
	})
	return out, err
}

// Clear implements profile.Store.
func (s *ProfileStore) Clear(ctx context.Context, userID uuid.UUID) (int, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM profile_entries WHERE user_id = $1`, userID)
	if err != nil {
		return 0, fmt.Errorf("clear profile: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// Consolidation implements profile.Store.
func (s *ProfileStore) Consolidation(ctx context.Context, userID uuid.UUID) (bool, error) {
	var on bool
	err := s.pool.QueryRow(ctx, `SELECT profile_consolidation FROM users WHERE id = $1`, userID).Scan(&on)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, profile.ErrNotFound
	}
	return on, err
}

// SetConsolidation implements profile.Store.
func (s *ProfileStore) SetConsolidation(ctx context.Context, userID uuid.UUID, on bool) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE users SET profile_consolidation = $2, updated_at = now() WHERE id = $1`, userID, on)
	if err != nil {
		return fmt.Errorf("set profile consolidation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return profile.ErrNotFound
	}
	return nil
}

const runSelect = `SELECT id, user_id, started_at, finished_at, status, ops, error, model FROM profile_runs`

func scanRuns(rows pgx.Rows) ([]profile.Run, error) {
	defer rows.Close()
	var out []profile.Run
	for rows.Next() {
		var r profile.Run
		var ops []byte
		if err := rows.Scan(&r.ID, &r.UserID, &r.StartedAt, &r.FinishedAt, &r.Status, &ops, &r.Error, &r.Model); err != nil {
			return nil, fmt.Errorf("scan profile run: %w", err)
		}
		if err := json.Unmarshal(ops, &r.Ops); err != nil {
			return nil, fmt.Errorf("profile run %s ops: %w", r.ID, err)
		}
		if r.Ops == nil {
			r.Ops = []profile.RunOp{}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Runs implements profile.Store.
func (s *ProfileStore) Runs(ctx context.Context, userID uuid.UUID, limit int) ([]profile.Run, error) {
	rows, err := s.pool.Query(ctx, runSelect+` WHERE user_id = $1 ORDER BY started_at DESC, id LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list profile runs: %w", err)
	}
	return scanRuns(rows)
}

// Run implements profile.Store.
func (s *ProfileStore) Run(ctx context.Context, userID, id uuid.UUID) (*profile.Run, error) {
	rows, err := s.pool.Query(ctx, runSelect+` WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return nil, fmt.Errorf("get profile run: %w", err)
	}
	runs, err := scanRuns(rows)
	if err != nil {
		return nil, err
	}
	if len(runs) == 0 {
		return nil, profile.ErrNotFound
	}
	return &runs[0], nil
}

// PromptEntries implements profile.PromptStore: ACCEPTED entries only — the
// learner's own and the consolidated ones they accepted. A proposal is not
// read into any prompt until it is accepted, and a rejected one never is.
func (s *ProfileStore) PromptEntries(ctx context.Context, userID uuid.UUID, sections []string, kbIDs []uuid.UUID) ([]profile.Entry, error) {
	if kbIDs == nil {
		kbIDs = []uuid.UUID{}
	}
	rows, err := s.pool.Query(ctx, entrySelect+`
	 WHERE e.user_id = $1 AND e.status = 'accepted' AND e.section = ANY($2)
	   AND (e.kb_id IS NULL OR e.kb_id = ANY($3))
	 ORDER BY e.created_at, e.id`, userID, sections, kbIDs)
	if err != nil {
		return nil, fmt.Errorf("profile prompt entries: %w", err)
	}
	entries, _, err := scanEntries(rows)
	return entries, err
}

// ── refs ─────────────────────────────────────────────────────────────────

// refLookups is, per ref kind, the query that resolves ids of that kind for
// ONE owner: id, label, and the parent id a link needs.
var refLookups = map[string]string{
	profile.RefMistake: `
		SELECT e.id, left(q.prompt, 120), q.kb_id FROM error_records e
		  JOIN questions q ON q.id = e.question_id AND q.user_id = e.user_id
		 WHERE e.user_id = $1 AND e.id = ANY($2)`,
	profile.RefKnowledgePoint: `
		SELECT kp.id, kp.name, m.path_id FROM knowledge_points kp
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = kp.user_id
		 WHERE kp.user_id = $1 AND kp.id = ANY($2)`,
	profile.RefKnowledgeBase: `
		SELECT id, name, NULL::uuid FROM knowledge_bases WHERE user_id = $1 AND id = ANY($2)`,
	profile.RefVocabCard: `
		SELECT c.id, n.term, n.id FROM vocab_cards c
		  JOIN vocab_notes n ON n.id = c.note_id AND n.user_id = c.user_id
		 WHERE c.user_id = $1 AND c.id = ANY($2)`,
	profile.RefSkillCard: `
		SELECT id, title, NULL::uuid FROM skill_cards WHERE user_id = $1 AND id = ANY($2)`,
}

type refHit struct {
	label  string
	parent *uuid.UUID
}

// resolveRefs looks every ref up with the owner's user_id, one query per kind.
func resolveRefs(ctx context.Context, q profileQueryRunner, userID uuid.UUID, refs []profile.Ref) (map[profile.Ref]refHit, error) {
	byKind := map[string][]uuid.UUID{}
	for _, r := range refs {
		byKind[r.Kind] = append(byKind[r.Kind], r.ID)
	}
	out := map[profile.Ref]refHit{}
	for kind, ids := range byKind {
		sql, ok := refLookups[kind]
		if !ok {
			continue
		}
		rows, err := q.Query(ctx, sql, userID, ids)
		if err != nil {
			return nil, fmt.Errorf("resolve %s refs: %w", kind, err)
		}
		for rows.Next() {
			var id uuid.UUID
			var h refHit
			if err := rows.Scan(&id, &h.label, &h.parent); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan %s ref: %w", kind, err)
			}
			out[profile.Ref{Kind: kind, ID: id}] = h
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// profileQueryRunner is what resolveRefs needs from a pool or a transaction.
type profileQueryRunner interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// attachRefs sets each entry's RefViews from its stored refs.
func (s *ProfileStore) attachRefs(ctx context.Context, q profileQueryRunner, userID uuid.UUID, entries []profile.Entry, stored [][]profile.Ref) error {
	var all []profile.Ref
	for _, refs := range stored {
		all = append(all, refs...)
	}
	hits, err := resolveRefs(ctx, q, userID, all)
	if err != nil {
		return err
	}
	for i := range entries {
		views := make([]profile.RefView, 0, len(stored[i]))
		for _, r := range stored[i] {
			v := profile.RefView{Kind: r.Kind, ID: r.ID}
			if h, ok := hits[r]; ok {
				v.Exists, v.Label, v.ParentID = true, h.label, h.parent
			}
			views = append(views, v)
		}
		entries[i].Refs = views
	}
	return nil
}

// ── the consolidation's side ─────────────────────────────────────────────

// OptedIn implements profile.ConsolidationStore. It spans users; the job
// holds the advisory lock while it runs.
func (s *ProfileStore) OptedIn(ctx context.Context) ([]profile.Learner, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.timezone,
		       (SELECT max(started_at) FROM profile_runs r WHERE r.user_id = u.id),
		       (SELECT max(started_at) FROM profile_runs r WHERE r.user_id = u.id AND r.status = 'succeeded')
		  FROM users u
		 WHERE u.profile_consolidation AND u.deleted_at IS NULL
		 ORDER BY u.id`)
	if err != nil {
		return nil, fmt.Errorf("profile: opted-in learners: %w", err)
	}
	defer rows.Close()
	var out []profile.Learner
	for rows.Next() {
		var l profile.Learner
		if err := rows.Scan(&l.UserID, &l.Zone, &l.LastStarted, &l.LastSucceeded); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// HasActivity implements profile.ConsolidationStore.
func (s *ProfileStore) HasActivity(ctx context.Context, userID uuid.UUID, since time.Time) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM question_attempts WHERE user_id = $1 AND created_at >= $2)
		    OR EXISTS (SELECT 1 FROM explain_back_attempts WHERE user_id = $1 AND created_at >= $2 AND verdict <> 'pending')
		    OR EXISTS (SELECT 1 FROM vocab_reviews WHERE user_id = $1 AND created_at >= $2)
		    OR EXISTS (SELECT 1 FROM card_entries WHERE user_id = $1 AND created_at >= $2)
		    OR EXISTS (SELECT 1 FROM mastery_events WHERE user_id = $1 AND created_at >= $2)`,
		userID, since).Scan(&active)
	if err != nil {
		return false, fmt.Errorf("profile: activity: %w", err)
	}
	return active, nil
}

// SignalRows implements profile.ConsolidationStore. Every column here is an
// id, a count, a rate, an enum or a name; not one reads explain-back gaps,
// misconceptions, feedback, explanations, answers, question text, terms or
// card text (signals.go).
func (s *ProfileStore) SignalRows(ctx context.Context, userID uuid.UUID, since time.Time) (profile.SignalRows, error) {
	var out profile.SignalRows

	rows, err := s.pool.Query(ctx, `
		WITH kps AS (
		    SELECT knowledge_point_id AS kp_id FROM question_attempts
		     WHERE user_id = $1 AND created_at >= $2 AND knowledge_point_id IS NOT NULL
		    UNION
		    SELECT kp_id FROM error_records
		     WHERE user_id = $1 AND kp_id IS NOT NULL AND (updated_at >= $2 OR status <> 'graduated')
		    UNION
		    SELECT kp_id FROM explain_back_attempts WHERE user_id = $1 AND created_at >= $2
		)
		SELECT kp.id, p.kb_id, p.id, kp.name,
		       COALESCE((SELECT jsonb_object_agg(t.error_type, t.n) FROM (
		           SELECT e.error_type, count(*) AS n FROM error_records e
		            WHERE e.user_id = $1 AND e.kp_id = kp.id AND (e.created_at >= $2 OR e.status <> 'graduated')
		            GROUP BY e.error_type) t), '{}'::jsonb),
		       (SELECT count(*) FROM error_records e WHERE e.user_id = $1 AND e.kp_id = kp.id AND e.status <> 'graduated'),
		       (SELECT e.id FROM error_records e WHERE e.user_id = $1 AND e.kp_id = kp.id AND e.status <> 'graduated'
		         ORDER BY e.updated_at DESC, e.id LIMIT 1),
		       (SELECT count(*) FROM question_attempts a WHERE a.user_id = $1 AND a.knowledge_point_id = kp.id AND a.created_at >= $2),
		       (SELECT count(*) FROM question_attempts a WHERE a.user_id = $1 AND a.knowledge_point_id = kp.id AND a.created_at >= $2 AND a.is_correct),
		       COALESCE(st.mastery_estimate, 0), COALESCE(st.status = 'graduated', false),
		       (SELECT count(*) FROM explain_back_attempts b WHERE b.user_id = $1 AND b.kp_id = kp.id AND b.created_at >= $2
		           AND b.verdict IN ('passed', 'failed') AND COALESCE(b.override_passed, b.verdict = 'passed')),
		       (SELECT count(*) FROM explain_back_attempts b WHERE b.user_id = $1 AND b.kp_id = kp.id AND b.created_at >= $2
		           AND b.verdict IN ('passed', 'failed') AND NOT COALESCE(b.override_passed, b.verdict = 'passed'))
		  FROM kps
		  JOIN knowledge_points kp ON kp.id = kps.kp_id AND kp.user_id = $1
		  JOIN mastery_modules m ON m.id = kp.module_id AND m.user_id = $1
		  JOIN mastery_paths p ON p.id = m.path_id AND p.user_id = $1
		  LEFT JOIN kp_state st ON st.kp_id = kp.id AND st.user_id = $1`, userID, since)
	if err != nil {
		return out, fmt.Errorf("profile signals: points: %w", err)
	}
	for rows.Next() {
		var p profile.PointRow
		var errs []byte
		var mistake *uuid.UUID
		if err := rows.Scan(&p.KnowledgePointID, &p.KnowledgeBaseID, &p.PathID, &p.Name, &errs,
			&p.OpenMistakes, &mistake, &p.Attempts, &p.Correct, &p.Mastery, &p.Graduated,
			&p.ExplainPassed, &p.ExplainFailed); err != nil {
			rows.Close()
			return out, fmt.Errorf("profile signals: scan point: %w", err)
		}
		if err := json.Unmarshal(errs, &p.Errors); err != nil {
			rows.Close()
			return out, err
		}
		if mistake != nil {
			p.MistakeID = *mistake
		}
		out.Points = append(out.Points, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	sortPoints(out.Points)

	rows, err = s.pool.Query(ctx, `
		SELECT q.kb_id, k.name, count(*), count(*) FILTER (WHERE a.is_correct),
		       (SELECT count(*) FROM error_records e
		          JOIN questions q2 ON q2.id = e.question_id AND q2.user_id = e.user_id
		         WHERE e.user_id = $1 AND e.status <> 'graduated' AND q2.kb_id = q.kb_id)
		  FROM question_attempts a
		  JOIN questions q ON q.id = a.question_id AND q.user_id = $1
		  JOIN knowledge_bases k ON k.id = q.kb_id AND k.user_id = $1
		 WHERE a.user_id = $1 AND a.created_at >= $2
		 GROUP BY q.kb_id, k.name
		 ORDER BY count(*) DESC, q.kb_id`, userID, since)
	if err != nil {
		return out, fmt.Errorf("profile signals: bases: %w", err)
	}
	for rows.Next() {
		var b profile.BaseRow
		if err := rows.Scan(&b.KnowledgeBaseID, &b.Name, &b.Attempts, &b.Correct, &b.OpenMistakes); err != nil {
			rows.Close()
			return out, err
		}
		out.Bases = append(out.Bases, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT n.lang, count(DISTINCT c.id), count(*), count(*) FILTER (WHERE r.rating = 'again'),
		       (SELECT c2.id FROM vocab_cards c2
		          JOIN vocab_notes n2 ON n2.id = c2.note_id AND n2.user_id = c2.user_id
		         WHERE c2.user_id = $1 AND n2.lang = n.lang
		         ORDER BY c2.lapses DESC, c2.updated_at DESC, c2.id LIMIT 1)
		  FROM vocab_reviews r
		  JOIN vocab_cards c ON c.id = r.card_id AND c.user_id = $1
		  JOIN vocab_notes n ON n.id = c.note_id AND n.user_id = $1
		 WHERE r.user_id = $1 AND r.created_at >= $2
		 GROUP BY n.lang
		 ORDER BY count(*) DESC, n.lang`, userID, since)
	if err != nil {
		return out, fmt.Errorf("profile signals: vocabulary: %w", err)
	}
	for rows.Next() {
		var v profile.VocabRow
		if err := rows.Scan(&v.Lang, &v.Cards, &v.Reviews, &v.Lapses, &v.CardID); err != nil {
			rows.Close()
			return out, err
		}
		out.Vocab = append(out.Vocab, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT c.id, c.kind, c.status,
		       (SELECT count(*) FROM card_entries e WHERE e.card_id = c.id AND e.user_id = $1),
		       EXISTS (SELECT 1 FROM card_entries e WHERE e.card_id = c.id AND e.user_id = $1 AND e.timepoint = 'delayed')
		  FROM skill_cards c
		 WHERE c.user_id = $1 AND c.updated_at >= $2
		 ORDER BY c.updated_at DESC, c.id`, userID, since)
	if err != nil {
		return out, fmt.Errorf("profile signals: cards: %w", err)
	}
	for rows.Next() {
		var c profile.CardRow
		if err := rows.Scan(&c.SkillCardID, &c.Kind, &c.Status, &c.Entries, &c.RetestDone); err != nil {
			rows.Close()
			return out, err
		}
		out.Cards = append(out.Cards, c)
	}
	rows.Close()
	return out, rows.Err()
}

// sortPoints puts the points with the most to say first: open mistakes, then
// answers, then the id for a stable order.
func sortPoints(points []profile.PointRow) {
	weight := func(p profile.PointRow) int { return p.OpenMistakes*3 + p.Attempts + p.ExplainFailed*2 }
	for i := 1; i < len(points); i++ {
		for j := i; j > 0; j-- {
			a, b := points[j-1], points[j]
			if weight(a) > weight(b) || weight(a) == weight(b) && a.KnowledgePointID.String() < b.KnowledgePointID.String() {
				break
			}
			points[j-1], points[j] = b, a
		}
	}
}

// Current implements profile.ConsolidationStore.
func (s *ProfileStore) Current(ctx context.Context, userID uuid.UUID, now time.Time) (*profile.Current, error) {
	cur := &profile.Current{ConsolidatedRefs: map[uuid.UUID][]profile.Ref{},
		Accepted: map[string]int{}, Texts: map[string][]string{}}

	rows, err := s.pool.Query(ctx, entrySelect+`
	 WHERE e.user_id = $1 AND e.status = 'accepted'
	 ORDER BY e.created_at, e.id`, userID)
	if err != nil {
		return nil, fmt.Errorf("profile: current: %w", err)
	}
	entries, refs, err := scanEntries(rows)
	if err != nil {
		return nil, err
	}
	for i, e := range entries {
		cur.Accepted[e.Section]++
		cur.Texts[e.Section] = append(cur.Texts[e.Section], profile.FoldText(e.Text))
		if e.Origin == profile.OriginConsolidated {
			cur.Consolidated = append(cur.Consolidated, e)
			cur.ConsolidatedRefs[e.ID] = refs[i]
		}
	}

	rows, err = s.pool.Query(ctx, `
		SELECT section, text, refs, decided_at FROM profile_entries
		 WHERE user_id = $1 AND status = 'rejected' AND decided_at >= $2`,
		userID, now.Add(-profile.RejectCooldown))
	if err != nil {
		return nil, fmt.Errorf("profile: rejected: %w", err)
	}
	for rows.Next() {
		var r profile.Rejected
		var raw []byte
		if err := rows.Scan(&r.Section, &r.Text, &raw, &r.DecidedAt); err != nil {
			rows.Close()
			return nil, err
		}
		_ = json.Unmarshal(raw, &r.Refs)
		cur.Rejected = append(cur.Rejected, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = s.pool.Query(ctx, `SELECT goal FROM learning_states WHERE user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("profile: goals: %w", err)
	}
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			rows.Close()
			return nil, err
		}
		cur.Goals = append(cur.Goals, g)
	}
	rows.Close()
	return cur, rows.Err()
}

// StartRun implements profile.ConsolidationStore.
func (s *ProfileStore) StartRun(ctx context.Context, userID uuid.UUID, now time.Time) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `
		INSERT INTO profile_runs (user_id, started_at) VALUES ($1, $2) RETURNING id`, userID, now).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("profile: start run: %w", err)
	}
	return id, nil
}

// keepRuns is how many runs a learner's history keeps.
const keepRuns = 60

// FinishRun implements profile.ConsolidationStore.
//
// On success, in one transaction: the learner's earlier unreviewed proposals
// are withdrawn (tonight's run saw everything they did and more); each new
// proposal's refs are resolved AGAIN with the owner's id before it is stored,
// and a target that is no longer a consolidated, accepted entry is skipped;
// rejections past the cooldown are forgotten; old runs are pruned.
func (s *ProfileStore) FinishRun(ctx context.Context, userID, runID uuid.UUID, res profile.RunResult, now time.Time) error {
	return s.tx(ctx, func(tx pgx.Tx) error {
		ops := res.Ops
		if res.Status == profile.RunSucceeded {
			if err := lockProfile(ctx, tx, userID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM profile_entries WHERE user_id = $1 AND status = 'proposed'`, userID); err != nil {
				return fmt.Errorf("withdraw proposals: %w", err)
			}
			var err error
			ops, err = s.storeProposals(ctx, tx, userID, runID, res.Proposals, ops, now)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				DELETE FROM profile_entries WHERE user_id = $1 AND status = 'rejected' AND decided_at < $2`,
				userID, now.Add(-profile.RejectCooldown)); err != nil {
				return fmt.Errorf("forget old rejections: %w", err)
			}
		}
		if ops == nil {
			ops = []profile.RunOp{}
		}
		raw, _ := json.Marshal(ops)
		errText := res.Error
		if len(errText) > 2000 {
			errText = errText[:2000]
		}
		if _, err := tx.Exec(ctx, `
			UPDATE profile_runs SET finished_at = $3, status = $4, ops = $5, error = $6, model = $7
			 WHERE id = $1 AND user_id = $2`,
			runID, userID, now, res.Status, raw, errText, res.Model); err != nil {
			return fmt.Errorf("finish run: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			DELETE FROM profile_runs WHERE user_id = $1 AND id NOT IN (
			    SELECT id FROM profile_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2)`,
			userID, keepRuns); err != nil {
			return fmt.Errorf("prune runs: %w", err)
		}
		return nil
	})
}

// storeProposals inserts the run's proposals and returns the run log with any
// proposal that could not be stored marked dropped.
func (s *ProfileStore) storeProposals(ctx context.Context, tx pgx.Tx, userID, runID uuid.UUID,
	props []profile.Proposal, ops []profile.RunOp, now time.Time) ([]profile.RunOp, error) {
	var all []profile.Ref
	for _, p := range props {
		all = append(all, p.Refs...)
	}
	hits, err := resolveRefs(ctx, tx, userID, all)
	if err != nil {
		return nil, err
	}
	out := append([]profile.RunOp(nil), ops...)
	markDropped := func(p profile.Proposal, reason string) {
		for i := range out {
			if out[i].Status == profile.StatusProposed && out[i].Op == p.Op && out[i].Text == p.Text {
				out[i].Status, out[i].Reason = "dropped", reason
				return
			}
		}
	}
	for _, p := range props {
		refs := make([]profile.Ref, 0, len(p.Refs))
		for _, r := range p.Refs {
			if _, ok := hits[r]; ok {
				refs = append(refs, r)
			}
		}
		if p.Op != profile.OpRemove && len(refs) == 0 {
			markDropped(p, "its evidence no longer exists")
			continue
		}
		if p.ReplacesID != nil {
			var ok bool
			if err := tx.QueryRow(ctx, `
				SELECT EXISTS (SELECT 1 FROM profile_entries WHERE id = $1 AND user_id = $2
				                  AND origin = 'consolidated' AND status = 'accepted')`,
				*p.ReplacesID, userID).Scan(&ok); err != nil {
				return nil, err
			}
			if !ok {
				markDropped(p, "the entry it changes is gone or is now the learner's")
				continue
			}
		}
		if p.KBID != nil {
			if err := ownsKB(ctx, tx, userID, *p.KBID); errors.Is(err, profile.ErrNotFound) {
				p.KBID = nil
			} else if err != nil {
				return nil, err
			}
		}
		raw, _ := json.Marshal(refs)
		if _, err := tx.Exec(ctx, `
			INSERT INTO profile_entries (user_id, section, text, refs, origin, status, op, replaces_id, kb_id, run_id, created_at, updated_at)
			VALUES ($1, $2, $3, $4, 'consolidated', 'proposed', $5, $6, $7, $8, $9, $9)`,
			userID, p.Section, strings.TrimSpace(p.Text), raw, p.Op, p.ReplacesID, p.KBID, runID, now); err != nil {
			return nil, fmt.Errorf("store proposal: %w", err)
		}
	}
	return out, nil
}
