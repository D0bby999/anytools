package pg

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/learning/loop"
)

// learning_loop_cards.go holds skill evidence cards and their entries
// (1789840000_skill_cards). The rules — what may be written when, and what is
// withheld — are the service's (loop/cards.go); this file keeps them atomic:
// each write locks its card row, so two tabs cannot both save the baseline or
// both close the card.

const cardColumns = `id, user_id, state_id, chain_id, kind, title, setup, status, baseline_at,
	retest_due_on, closed_at, reflection, created_at, updated_at`

// CreateCard inserts the card's chain and the card, in one transaction. The
// chain's composite foreign key to the state is what refuses a state that is
// not the caller's.
func (s *LoopStore) CreateCard(ctx context.Context, c loop.SkillCard) (*loop.SkillCard, error) {
	if c.Setup == nil {
		c.Setup = map[string]string{} // `null` is not an object
	}
	setup, err := json.Marshal(c.Setup)
	if err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create card: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	var chainID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO evidence_chains (user_id, state_id, question) VALUES ($1, $2, $3) RETURNING id`,
		c.UserID, c.StateID, c.Title).Scan(&chainID); err != nil {
		return nil, notFoundOr(err, "create card chain")
	}
	card, err := scanCard(tx.QueryRow(ctx, `
		INSERT INTO skill_cards (user_id, state_id, chain_id, kind, title, setup)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING `+cardColumns,
		c.UserID, c.StateID, chainID, c.Kind, c.Title, setup))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create card: %w", err)
	}
	return card, nil
}

// ListCards returns a state's cards, newest first.
func (s *LoopStore) ListCards(ctx context.Context, userID, stateID uuid.UUID) ([]loop.SkillCard, error) {
	return listRows(ctx, s.pool, scanCard, `
		SELECT `+cardColumns+` FROM skill_cards
		 WHERE state_id = $1 AND user_id = $2 ORDER BY created_at DESC`, stateID, userID)
}

// GetCard reads one card scoped to its owner.
func (s *LoopStore) GetCard(ctx context.Context, userID, id uuid.UUID) (*loop.SkillCard, error) {
	return scanCard(s.pool.QueryRow(ctx,
		`SELECT `+cardColumns+` FROM skill_cards WHERE id = $1 AND user_id = $2`, id, userID))
}

// ListCardEntries reads a card's entries, oldest first, links resolved.
func (s *LoopStore) ListCardEntries(ctx context.Context, userID, cardID uuid.UUID) ([]loop.CardEntry, error) {
	entries, err := listRows(ctx, s.pool, scanCardEntry, `
		SELECT id, user_id, card_id, timepoint, body, prompt_level, links, created_at
		  FROM card_entries WHERE card_id = $1 AND user_id = $2 ORDER BY created_at, id`, cardID, userID)
	if err != nil {
		return nil, err
	}
	return entries, s.resolveCardLinks(ctx, userID, entries)
}

// AddCardEntry writes an entry under the card's row lock. See loop.Store.
func (s *LoopStore) AddCardEntry(
	ctx context.Context, userID, cardID uuid.UUID, e loop.CardEntry,
	decide func(loop.SkillCard) (*loop.CardChange, error),
) (*loop.SkillCard, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("add card entry: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	card, err := scanCard(tx.QueryRow(ctx,
		`SELECT `+cardColumns+` FROM skill_cards WHERE id = $1 AND user_id = $2 FOR UPDATE`, cardID, userID))
	if err != nil {
		return nil, err
	}
	change, err := decide(*card)
	if err != nil {
		return nil, err
	}
	// Every link is the caller's, or the entry is refused exactly as a
	// nonexistent id would be.
	owns, err := ownsCardLinks(ctx, tx, userID, e.Links)
	if err != nil {
		return nil, err
	}
	if !owns {
		return nil, loop.ErrNotFound
	}
	links, err := json.Marshal(e.Links)
	if err != nil {
		return nil, err
	}
	var entryID uuid.UUID
	if err := tx.QueryRow(ctx, `
		INSERT INTO card_entries (user_id, card_id, timepoint, body, prompt_level, links)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		userID, cardID, e.Timepoint, e.Body, e.PromptLevel, links).Scan(&entryID); err != nil {
		return nil, notFoundOr(err, "insert card entry")
	}
	updated, err := applyCardChange(ctx, tx, userID, cardID, change)
	if err != nil {
		return nil, err
	}
	// The entry is evidence on the card's chain at its own timepoint
	// (loop/cards.go, "Decision").
	if _, err := tx.Exec(ctx, `
		INSERT INTO evidence_refs (user_id, chain_id, timepoint, kind, ref_id, status, suggested_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		userID, card.ChainID, e.Timepoint, loop.KindCardEntry, entryID,
		loop.StatusAccepted, loop.SuggestedByUser); err != nil {
		return nil, notFoundOr(err, "attach card entry")
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("add card entry: %w", err)
	}
	return updated, nil
}

// CloseCard applies the reflection under the card's row lock.
func (s *LoopStore) CloseCard(
	ctx context.Context, userID, id uuid.UUID, decide func(loop.SkillCard) (*loop.CardChange, error),
) (*loop.SkillCard, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("close card: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	card, err := scanCard(tx.QueryRow(ctx,
		`SELECT `+cardColumns+` FROM skill_cards WHERE id = $1 AND user_id = $2 FOR UPDATE`, id, userID))
	if err != nil {
		return nil, err
	}
	change, err := decide(*card)
	if err != nil {
		return nil, err
	}
	updated, err := applyCardChange(ctx, tx, userID, id, change)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("close card: %w", err)
	}
	return updated, nil
}

func applyCardChange(ctx context.Context, tx pgx.Tx, userID, id uuid.UUID, ch *loop.CardChange) (*loop.SkillCard, error) {
	var reflection []byte
	if ch.Reflection != nil {
		var err error
		if reflection, err = json.Marshal(ch.Reflection); err != nil {
			return nil, err
		}
	}
	return scanCard(tx.QueryRow(ctx, `
		UPDATE skill_cards
		   SET status = $3,
		       baseline_at = COALESCE($4, baseline_at),
		       retest_due_on = COALESCE(NULLIF($5, '')::date, retest_due_on),
		       closed_at = COALESCE($6, closed_at),
		       reflection = COALESCE($7::jsonb, reflection),
		       updated_at = now()
		 WHERE id = $1 AND user_id = $2
		RETURNING `+cardColumns, id, userID, ch.Status, ch.BaselineAt, ch.RetestDueOn, ch.ClosedAt, reflection))
}

// RetestsDue lists pending retests due on or before today — a calendar date
// the service worked out in the learner's zone, never CURRENT_DATE.
func (s *LoopStore) RetestsDue(ctx context.Context, userID uuid.UUID, today string) ([]loop.RetestDue, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, state_id, kind, title, to_char(retest_due_on, 'YYYY-MM-DD')
		  FROM skill_cards
		 WHERE user_id = $1 AND status = 'retest_due' AND retest_due_on <= $2::date
		 ORDER BY retest_due_on, created_at`, userID, today)
	if err != nil {
		return nil, fmt.Errorf("retests due: %w", err)
	}
	defer rows.Close()
	out := []loop.RetestDue{}
	for rows.Next() {
		var r loop.RetestDue
		if err := rows.Scan(&r.CardID, &r.StateID, &r.Kind, &r.Title, &r.RetestDueOn); err != nil {
			return nil, fmt.Errorf("retests due: scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CardEntryTimepoint is the timepoint an entry was written at.
func (s *LoopStore) CardEntryTimepoint(ctx context.Context, userID, id uuid.UUID) (string, error) {
	var tp string
	if err := s.pool.QueryRow(ctx,
		`SELECT timepoint FROM card_entries WHERE id = $1 AND user_id = $2`, id, userID).Scan(&tp); err != nil {
		return "", notFoundOr(err, "card entry timepoint")
	}
	return tp, nil
}

// ─────────────────────────────────────────────────────────────────── links

// cardLinkTargets reads each link kind's targets, always with the owner's id.
// Columns: id, label, path.
var cardLinkTargets = map[string]string{
	loop.LinkNote: `
		SELECT n.id, COALESCE(NULLIF(btrim(n.title), ''), left(n.body_md, 120)), '/notebooks/' || n.notebook_id
		  FROM notes n WHERE n.user_id = $1 AND n.id = ANY($2)`,
	loop.LinkDocument: `
		SELECT d.id, d.title, '/documents/' || d.id
		  FROM documents d WHERE d.user_id = $1 AND d.id = ANY($2)`,
	loop.LinkQuizAttempt: `
		SELECT a.id, left(q.prompt, 120), '/quiz/bank'
		  FROM question_attempts a
		  JOIN questions q ON q.id = a.question_id AND q.user_id = a.user_id
		 WHERE a.user_id = $1 AND a.id = ANY($2)`,
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type linkTarget struct{ label, path string }

// readLinkTargets resolves links by kind with the owner's id. A link that is
// not in the result is gone or was never theirs; the two look the same.
func readLinkTargets(ctx context.Context, q querier, userID uuid.UUID, links []loop.CardLink) (map[string]linkTarget, error) {
	byKind := map[string][]uuid.UUID{}
	for _, l := range links {
		byKind[l.Kind] = append(byKind[l.Kind], l.ID)
	}
	found := map[string]linkTarget{}
	for kind, ids := range byKind {
		sql, ok := cardLinkTargets[kind]
		if !ok {
			continue
		}
		rows, err := q.Query(ctx, sql, userID, ids)
		if err != nil {
			return nil, fmt.Errorf("card links (%s): %w", kind, err)
		}
		for rows.Next() {
			var id uuid.UUID
			var t linkTarget
			if err := rows.Scan(&id, &t.label, &t.path); err != nil {
				rows.Close()
				return nil, fmt.Errorf("card links (%s): scan: %w", kind, err)
			}
			found[kind+":"+id.String()] = t
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return found, nil
}

// ownsCardLinks is the save-side check: every link names a row of the caller's.
func ownsCardLinks(ctx context.Context, q querier, userID uuid.UUID, links []loop.CardLink) (bool, error) {
	if len(links) == 0 {
		return true, nil
	}
	found, err := readLinkTargets(ctx, q, userID, links)
	if err != nil {
		return false, err
	}
	for _, l := range links {
		if _, ok := found[l.Kind+":"+l.ID.String()]; !ok {
			return false, nil
		}
	}
	return true, nil
}

// resolveCardLinks is the render-side check: labels and paths come from the
// owner's rows only, and a link that resolves to nothing is marked missing
// with no label — whatever id was stored.
func (s *LoopStore) resolveCardLinks(ctx context.Context, userID uuid.UUID, entries []loop.CardEntry) error {
	var all []loop.CardLink
	for _, e := range entries {
		all = append(all, e.Links...)
	}
	if len(all) == 0 {
		return nil
	}
	found, err := readLinkTargets(ctx, s.pool, userID, all)
	if err != nil {
		return err
	}
	for i := range entries {
		for j := range entries[i].Links {
			l := &entries[i].Links[j]
			t, ok := found[l.Kind+":"+l.ID.String()]
			if !ok {
				l.Label, l.Path, l.Missing = "", "", true
				continue
			}
			l.Label, l.Path = t.label, t.path
			if l.Kind == loop.LinkDocument && l.Page > 0 {
				l.Path += "?page=" + strconv.Itoa(l.Page)
			}
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────── scans

func scanCard(row pgx.Row) (*loop.SkillCard, error) {
	var c loop.SkillCard
	var setup, reflection []byte
	var due *time.Time
	if err := row.Scan(&c.ID, &c.UserID, &c.StateID, &c.ChainID, &c.Kind, &c.Title, &setup, &c.Status,
		&c.BaselineAt, &due, &c.ClosedAt, &reflection, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, notFoundOr(err, "scan skill card")
	}
	if due != nil {
		c.RetestDueOn = due.Format(time.DateOnly)
	}
	if err := jsonInto(setup, &c.Setup); err != nil {
		return nil, err
	}
	if c.Setup == nil {
		c.Setup = map[string]string{}
	}
	return &c, jsonInto(reflection, &c.Reflection)
}

func scanCardEntry(row pgx.Row) (*loop.CardEntry, error) {
	var e loop.CardEntry
	var links []byte
	if err := row.Scan(&e.ID, &e.UserID, &e.CardID, &e.Timepoint, &e.Body, &e.PromptLevel, &links, &e.CreatedAt); err != nil {
		return nil, notFoundOr(err, "scan card entry")
	}
	if err := jsonInto(links, &e.Links); err != nil {
		return nil, err
	}
	if e.Links == nil {
		e.Links = []loop.CardLink{}
	}
	return &e, nil
}
