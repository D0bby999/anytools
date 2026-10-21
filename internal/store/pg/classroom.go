package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/connectors/classroom"
)

// ClassroomStore is classroom_links (learning-tool-connections phase 6).
type ClassroomStore struct{ pool *Pool }

// NewClassroomStore returns a ClassroomStore.
func NewClassroomStore(pool *Pool) *ClassroomStore { return &ClassroomStore{pool: pool} }

const classroomColumns = `user_id, course_id, course_name, kb_id, seen, new_count, checked_at, last_error`

func scanClassroom(row pgx.Row) (*classroom.Link, error) {
	var l classroom.Link
	err := row.Scan(&l.UserID, &l.CourseID, &l.CourseName, &l.KBID, &l.Seen, &l.NewCount, &l.CheckedAt, &l.LastError)
	return &l, err
}

// GetLink returns a linked class or classroom.ErrNotLinked.
func (s *ClassroomStore) GetLink(ctx context.Context, userID uuid.UUID, courseID string) (*classroom.Link, error) {
	l, err := scanClassroom(s.pool.QueryRow(ctx, `SELECT `+classroomColumns+` FROM classroom_links WHERE user_id = $1 AND course_id = $2`, userID, courseID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, classroom.ErrNotLinked
	}
	if err != nil {
		return nil, fmt.Errorf("pg: read classroom link: %w", err)
	}
	return l, nil
}

// ListLinks lists a learner's linked classes.
func (s *ClassroomStore) ListLinks(ctx context.Context, userID uuid.UUID) ([]classroom.Link, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+classroomColumns+` FROM classroom_links WHERE user_id = $1 ORDER BY course_name`, userID)
	if err != nil {
		return nil, fmt.Errorf("pg: list classroom links: %w", err)
	}
	defer rows.Close()
	var out []classroom.Link
	for rows.Next() {
		l, err := scanClassroom(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// SaveLink creates or updates a linked class.
func (s *ClassroomStore) SaveLink(ctx context.Context, l classroom.Link) error {
	if l.Seen == nil {
		l.Seen = []string{}
	}
	msg := l.LastError
	if r := []rune(msg); len(r) > 2000 {
		msg = string(r[:2000])
	}
	name := l.CourseName
	if r := []rune(name); len(r) > 500 {
		name = string(r[:500])
	}
	_, err := s.pool.Exec(ctx, `
        INSERT INTO classroom_links (user_id, course_id, course_name, kb_id, seen, new_count, checked_at, last_error)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, course_id) DO UPDATE SET
            course_name = EXCLUDED.course_name, kb_id = EXCLUDED.kb_id, seen = EXCLUDED.seen,
            new_count = EXCLUDED.new_count, checked_at = EXCLUDED.checked_at, last_error = EXCLUDED.last_error`,
		l.UserID, l.CourseID, name, l.KBID, l.Seen, l.NewCount, l.CheckedAt, msg)
	if err != nil {
		return fmt.Errorf("pg: save classroom link: %w", err)
	}
	return nil
}

// ListLinkedUsers lists learners with a linked class and a working grant.
func (s *ClassroomStore) ListLinkedUsers(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT DISTINCT c.user_id FROM classroom_links c
          JOIN drive_connections d ON d.user_id = c.user_id AND NOT d.needs_reconnect`)
	if err != nil {
		return nil, fmt.Errorf("pg: list classroom users: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
