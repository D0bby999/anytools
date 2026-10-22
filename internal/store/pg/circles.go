package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/D0bby999/anytools/internal/circles"
)

// CircleStore is study circles (internal/circles).
type CircleStore struct{ pool *Pool }

// NewCircleStore builds a CircleStore.
func NewCircleStore(pool *Pool) *CircleStore { return &CircleStore{pool: pool} }

var _ circles.Store = (*CircleStore)(nil)

// circleOwner is the user id of a circle's earliest member, for circle c.
const circleOwner = `(SELECT o.user_id FROM study_circle_members o WHERE o.circle_id = c.id ORDER BY o.joined_at, o.id LIMIT 1)`

// circleSelect reads a circle as member $1 sees it.
const circleSelect = `
	SELECT c.id, c.name, c.invite_code, c.created_at, m.nickname,
	       (SELECT count(*) FROM study_circle_members x WHERE x.circle_id = c.id),
	       ` + circleOwner + ` = $1
	  FROM study_circle_members m JOIN study_circles c ON c.id = m.circle_id
	 WHERE m.user_id = $1`

func scanCircle(row pgx.Row) (circles.Circle, error) {
	var c circles.Circle
	err := row.Scan(&c.ID, &c.Name, &c.InviteCode, &c.CreatedAt, &c.Nickname, &c.Members, &c.Owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, circles.ErrNotFound
	}
	return c, err
}

// List implements circles.Store.
func (s *CircleStore) List(ctx context.Context, user uuid.UUID) ([]circles.Circle, error) {
	rows, err := s.pool.Query(ctx, circleSelect+` ORDER BY m.joined_at`, user)
	if err != nil {
		return nil, fmt.Errorf("circles list: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (circles.Circle, error) { return scanCircle(row) })
}

func circleOf(ctx context.Context, q pgx.Tx, user, circle uuid.UUID) (circles.Circle, error) {
	return scanCircle(q.QueryRow(ctx, circleSelect+` AND c.id = $2`, user, circle))
}

// lockUser serialises one user's joins and creations, so the circle limit holds.
func lockUser(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('circles:' || $1::text, 0))`, user)
	return err
}

func roomForAnother(ctx context.Context, tx pgx.Tx, user uuid.UUID) error {
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM study_circle_members WHERE user_id = $1`, user).Scan(&n); err != nil {
		return err
	}
	if n >= circles.MaxCircles {
		return circles.ErrTooMany
	}
	return nil
}

// Create implements circles.Store.
func (s *CircleStore) Create(ctx context.Context, user uuid.UUID, name, nickname, code string) (circles.Circle, error) {
	var out circles.Circle
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, user); err != nil {
			return err
		}
		if err := roomForAnother(ctx, tx, user); err != nil {
			return err
		}
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO study_circles (name, invite_code) VALUES ($1, $2) RETURNING id`, name, code).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO study_circle_members (circle_id, user_id, nickname) VALUES ($1, $2, $3)`, id, user, nickname); err != nil {
			return err
		}
		var err error
		out, err = circleOf(ctx, tx, user, id)
		return err
	})
	return out, err
}

// Join implements circles.Store.
func (s *CircleStore) Join(ctx context.Context, user uuid.UUID, code, nickname string) (circles.Circle, error) {
	var out circles.Circle
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, user); err != nil {
			return err
		}
		var id uuid.UUID
		// The row lock makes joins to one circle wait for each other, so the
		// member limit holds.
		err := tx.QueryRow(ctx, `SELECT id FROM study_circles WHERE invite_code = $1 FOR UPDATE`, code).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return circles.ErrNotFound
		}
		if err != nil {
			return err
		}
		if out, err = circleOf(ctx, tx, user, id); err == nil {
			return nil // already a member
		} else if !errors.Is(err, circles.ErrNotFound) {
			return err
		}
		if err := roomForAnother(ctx, tx, user); err != nil {
			return err
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM study_circle_members WHERE circle_id = $1`, id).Scan(&n); err != nil {
			return err
		}
		if n >= circles.MaxMembers {
			return circles.ErrFull
		}
		if _, err := tx.Exec(ctx, `INSERT INTO study_circle_members (circle_id, user_id, nickname) VALUES ($1, $2, $3)`, id, user, nickname); err != nil {
			return err
		}
		out, err = circleOf(ctx, tx, user, id)
		return err
	})
	return out, err
}

// Members implements circles.Store.
func (s *CircleStore) Members(ctx context.Context, user, circle uuid.UUID) (circles.Circle, []circles.Member, error) {
	var c circles.Circle
	var members []circles.Member
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		if c, err = circleOf(ctx, tx, user, circle); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			WITH me AS (
				SELECT m.id, (now() AT TIME ZONE u.timezone)::date AS today
				  FROM study_circle_members m JOIN users u ON u.id = m.user_id
				 WHERE m.circle_id = $2 AND m.user_id = $1
			)
			SELECT m.id, m.user_id, m.nickname, m.joined_at,
			       EXISTS (SELECT 1 FROM study_cheers ch, me
			                WHERE ch.from_member = me.id AND ch.to_member = m.id AND ch.day = me.today),
			       (SELECT count(*) FROM study_cheers ch
			         WHERE ch.to_member = m.id AND ch.created_at > now() - interval '1 day')
			  FROM study_circle_members m
			 WHERE m.circle_id = $2
			 ORDER BY m.joined_at, m.id`, user, circle)
		if err != nil {
			return err
		}
		first := true
		members, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (circles.Member, error) {
			var id, member uuid.UUID
			var nickname string
			var joined time.Time
			var cheered bool
			var cheers int
			err := row.Scan(&id, &member, &nickname, &joined, &cheered, &cheers)
			m := circles.NewMember(id, member, nickname, first, member == user, joined, cheered, cheers)
			first = false
			return m, err
		})
		return err
	})
	if err != nil {
		return circles.Circle{}, nil, err
	}
	return c, members, nil
}

// asOwner checks the caller is in the circle, then that they own it.
func asOwner(ctx context.Context, tx pgx.Tx, user, circle uuid.UUID) error {
	c, err := circleOf(ctx, tx, user, circle)
	if err != nil {
		return err
	}
	if !c.Owner {
		return circles.ErrNotOwner
	}
	return nil
}

// Update implements circles.Store.
func (s *CircleStore) Update(ctx context.Context, user, circle uuid.UUID, name, nickname *string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if name != nil {
			if err := asOwner(ctx, tx, user, circle); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE study_circles SET name = $2 WHERE id = $1`, circle, *name); err != nil {
				return err
			}
		}
		if nickname != nil {
			tag, err := tx.Exec(ctx, `UPDATE study_circle_members SET nickname = $3 WHERE circle_id = $2 AND user_id = $1`, user, circle, *nickname)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return circles.ErrNotFound
			}
		}
		return nil
	})
}

// SetCode implements circles.Store.
func (s *CircleStore) SetCode(ctx context.Context, user, circle uuid.UUID, code string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := asOwner(ctx, tx, user, circle); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE study_circles SET invite_code = $2 WHERE id = $1`, circle, code)
		return err
	})
}

// Leave implements circles.Store. The last member out takes the circle with
// them (the study_circles_drop_empty trigger).
func (s *CircleStore) Leave(ctx context.Context, user, circle uuid.UUID) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		// The circle's row lock orders a leave against a join.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM study_circles WHERE id = $1 FOR UPDATE`, circle); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM study_circle_members WHERE circle_id = $2 AND user_id = $1`, user, circle)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return circles.ErrNotFound
		}
		return nil
	})
}

// Remove implements circles.Store.
func (s *CircleStore) Remove(ctx context.Context, user, circle, member uuid.UUID, code string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		if err := asOwner(ctx, tx, user, circle); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM study_circle_members WHERE id = $2 AND circle_id = $1 AND user_id <> $3`, circle, member, user)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return circles.ErrNotFound
		}
		_, err = tx.Exec(ctx, `UPDATE study_circles SET invite_code = $2 WHERE id = $1`, circle, code)
		return err
	})
}

// Cheer implements circles.Store.
func (s *CircleStore) Cheer(ctx context.Context, user, circle, member uuid.UUID) (bool, error) {
	var me uuid.UUID
	var today time.Time
	err := s.pool.QueryRow(ctx, `
		SELECT m.id, (now() AT TIME ZONE u.timezone)::date
		  FROM study_circle_members m JOIN users u ON u.id = m.user_id
		 WHERE m.circle_id = $2 AND m.user_id = $1`, user, circle).Scan(&me, &today)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, circles.ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("circles cheer: %w", err)
	}
	if me == member {
		return false, fmt.Errorf("%w: you cannot cheer yourself", circles.ErrInvalid)
	}
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO study_cheers (from_member, to_member, day)
		SELECT $1, t.id, $4 FROM study_circle_members t WHERE t.id = $2 AND t.circle_id = $3
		ON CONFLICT DO NOTHING`, me, member, circle, today)
	if err != nil {
		return false, fmt.Errorf("circles cheer: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return true, nil
	}
	// Nothing inserted: cheered already today, or not a member here.
	var here bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM study_circle_members WHERE id = $1 AND circle_id = $2)`, member, circle).Scan(&here); err != nil {
		return false, fmt.Errorf("circles cheer: %w", err)
	}
	if !here {
		return false, circles.ErrNotFound
	}
	return false, nil
}

// Cheers implements circles.Store.
func (s *CircleStore) Cheers(ctx context.Context, user uuid.UUID, since time.Time) ([]circles.Cheer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT f.nickname, c.id, c.name, ch.created_at
		  FROM study_cheers ch
		  JOIN study_circle_members t ON t.id = ch.to_member AND t.user_id = $1
		  JOIN study_circle_members f ON f.id = ch.from_member
		  JOIN study_circles c ON c.id = t.circle_id
		 WHERE ch.created_at >= $2
		 ORDER BY ch.created_at DESC
		 LIMIT 20`, user, since)
	if err != nil {
		return nil, fmt.Errorf("circles cheers: %w", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (circles.Cheer, error) {
		var c circles.Cheer
		err := row.Scan(&c.From, &c.CircleID, &c.Circle, &c.At)
		return c, err
	})
}

// nameTaken turns the nickname index's violation into circles.ErrNameTaken.
func nameTaken(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "study_circle_members_nickname" {
		return circles.ErrNameTaken
	}
	return err
}

func (s *CircleStore) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return nameTaken(err)
	}
	return tx.Commit(ctx)
}
