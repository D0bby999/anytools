package pg

// vocab_languages.go stores the languages a learner studies
// (plans/261020-1535-beyond-english-learning-areas, phase 1).

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/vocab"
)

var _ vocab.LanguageStore = (*VocabStore)(nil)

// StudiedLanguages implements vocab.LanguageStore: an empty list until the
// learner first chose.
func (s *VocabStore) StudiedLanguages(ctx context.Context, userID uuid.UUID) (vocab.Studied, error) {
	out := vocab.Studied{Languages: []string{}}
	err := s.pool.QueryRow(ctx,
		`SELECT studied, current FROM vocab_languages WHERE user_id = $1`, userID).
		Scan(&out.Languages, &out.Current)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return vocab.Studied{}, fmt.Errorf("studied languages: %w", err)
	}
	return out, nil
}

// SetStudiedLanguages implements vocab.LanguageStore.
func (s *VocabStore) SetStudiedLanguages(ctx context.Context, userID uuid.UUID, st vocab.Studied) error {
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO vocab_languages (user_id, studied, current) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		   SET studied = EXCLUDED.studied, current = EXCLUDED.current, updated_at = now()`,
		userID, st.Languages, st.Current); err != nil {
		return fmt.Errorf("set studied languages: %w", err)
	}
	return nil
}

// SavedLanguages implements vocab.LanguageStore, most words first.
func (s *VocabStore) SavedLanguages(ctx context.Context, userID uuid.UUID, before time.Time) ([]vocab.LangCount, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT n.lang, count(*),
		       COALESCE(sum((SELECT count(*) FROM vocab_cards c
		                      WHERE c.note_id = n.id AND c.user_id = n.user_id
		                        AND NOT c.suspended AND c.due_at < $2)), 0)
		  FROM vocab_notes n
		 WHERE n.user_id = $1
		 GROUP BY n.lang
		 ORDER BY count(*) DESC, n.lang`, userID, before)
	if err != nil {
		return nil, fmt.Errorf("saved languages: %w", err)
	}
	defer rows.Close()
	out := []vocab.LangCount{}
	for rows.Next() {
		var c vocab.LangCount
		if err := rows.Scan(&c.Lang, &c.Words, &c.Due); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
