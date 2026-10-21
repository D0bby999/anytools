package pg

// card_decks.go stores the learner's general decks and their cards
// (the private design notes, phase 5).

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/learning"
	"github.com/D0bby999/anytools/internal/vocab"
)

var _ vocab.DeckStore = (*VocabStore)(nil)

// CreateDeck implements vocab.DeckStore.
// The count and the insert hold the user's row, so two at once cannot both
// take the last place.
func (s *VocabStore) CreateDeck(ctx context.Context, userID uuid.UUID, d vocab.NewDeck, limit int) (*vocab.Deck, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create deck: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, userID); err != nil {
		return nil, fmt.Errorf("lock user: %w", err)
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM card_decks WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return nil, fmt.Errorf("count decks: %w", err)
	}
	if n >= limit {
		return nil, vocab.ErrLimit
	}
	out := &vocab.Deck{Name: d.Name, Source: d.Source, Licence: d.Licence, SourceURL: d.SourceURL}
	if err := tx.QueryRow(ctx, `
		INSERT INTO card_decks (user_id, name, source, licence, source_url) VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`, userID, d.Name, d.Source, d.Licence, d.SourceURL).Scan(&out.ID, &out.CreatedAt); err != nil {
		return nil, fmt.Errorf("create deck: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create deck: %w", err)
	}
	return out, nil
}

// ListDecks implements vocab.DeckStore, newest first.
func (s *VocabStore) ListDecks(ctx context.Context, userID uuid.UUID, before time.Time, zone string) ([]vocab.Deck, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT d.id, d.name, d.source, d.licence, d.source_url, d.created_at,
		       count(c.id),
		       count(c.id) FILTER (WHERE NOT c.suspended AND c.due_at < $2),
		       count(c.id) FILTER (WHERE c.reps = 0 AND NOT c.suspended),
		       max(c.due_at) FILTER (WHERE c.reps = 0 AND NOT c.suspended)
		  FROM card_decks d
		  LEFT JOIN vocab_cards c ON c.deck_id = d.id AND c.user_id = d.user_id AND c.kind = 'card'
		 WHERE d.user_id = $1
		 GROUP BY d.id
		 ORDER BY d.created_at DESC, d.id`, userID, before)
	if err != nil {
		return nil, fmt.Errorf("list decks: %w", err)
	}
	defer rows.Close()
	out := []vocab.Deck{}
	for rows.Next() {
		var (
			d    vocab.Deck
			last *time.Time
		)
		if err := rows.Scan(&d.ID, &d.Name, &d.Source, &d.Licence, &d.SourceURL, &d.CreatedAt,
			&d.Cards, &d.Due, &d.New, &last); err != nil {
			return nil, err
		}
		if last != nil {
			d.LastNew = learning.LocalDay(*last, zone).String()
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDeck implements vocab.DeckStore; the cards and their reviews go by cascade.
func (s *VocabStore) DeleteDeck(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM card_decks WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return fmt.Errorf("delete deck: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return vocab.ErrNotFound
	}
	return nil
}

// AddDeckCards implements vocab.DeckStore: the batch in one transaction under
// the user's row lock, so two batches cannot pace into the same days. New
// cards come up PerDay a day from FirstDay, or from the last day earlier deck
// imports still fill; a front the deck already has is a duplicate.
func (s *VocabStore) AddDeckCards(ctx context.Context, b vocab.DeckBatch) (*vocab.ImportResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("add deck cards: %w", err)
	}
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck
	if _, err := tx.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, b.UserID); err != nil {
		return nil, fmt.Errorf("lock user: %w", err)
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM card_decks WHERE id = $1 AND user_id = $2)`,
		b.DeckID, b.UserID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("find deck: %w", err)
	}
	if !exists {
		return nil, vocab.ErrNotFound
	}

	var total int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vocab_cards WHERE user_id = $1 AND kind = 'card'`, b.UserID).Scan(&total); err != nil {
		return nil, fmt.Errorf("count deck cards: %w", err)
	}

	day, used := b.FirstDay, 0
	var (
		last  *time.Time
		count int
	)
	if err := tx.QueryRow(ctx, `
		WITH pending AS (
		  SELECT due_at FROM vocab_cards
		   WHERE user_id = $1 AND kind = 'card' AND reps = 0 AND NOT suspended)
		SELECT max(due_at), count(*) FILTER (WHERE due_at = (SELECT max(due_at) FROM pending)) FROM pending`,
		b.UserID).Scan(&last, &count); err != nil {
		return nil, fmt.Errorf("read deck pace: %w", err)
	}
	if last != nil {
		if d := learning.LocalDay(*last, b.Zone); !d.Before(b.FirstDay) {
			day, used = d, count
		}
	}

	res := &vocab.ImportResult{}
	for _, c := range b.Cards {
		var (
			dup   bool
			src   string
			image []byte
		)
		if c.Image != nil {
			src = c.Image.Src
			if image, err = json.Marshal(c.Image); err != nil {
				return nil, err
			}
		}
		// A card is its front and its picture: every flag card asks the same question.
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM vocab_cards
			                WHERE deck_id = $1 AND user_id = $2 AND front = $3 AND COALESCE(image->>'src', '') = $4)`,
			b.DeckID, b.UserID, c.Front, src).Scan(&dup); err != nil {
			return nil, fmt.Errorf("find duplicate card: %w", err)
		}
		if dup {
			res.Duplicates++
			continue
		}
		if total+res.Created >= b.Limit {
			res.OverLimit++
			continue
		}
		if used >= b.PerDay {
			day, used = vocab.AddDays(day, 1), 0
		}
		used++
		card := b.NewCard
		card.Due = learning.StartOf(day, b.Zone).UTC()
		raw, err := json.Marshal(card)
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO vocab_cards (user_id, kind, deck_id, front, back, image, fsrs_card, due_at, created_at, updated_at)
			VALUES ($1, 'card', $2, $3, $4, $5, $6, $7, $8, $8)`,
			// A microsecond apart, so a day's cards come up in the deck's order.
			b.UserID, b.DeckID, c.Front, c.Back, image, raw, card.Due, b.Now.Add(time.Duration(res.Created)*time.Microsecond)); err != nil {
			return nil, fmt.Errorf("add deck card: %w", err)
		}
		if res.Created == 0 {
			res.FirstDay = day.String()
		}
		res.Created++
		res.LastDay = day.String()
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("add deck cards: %w", err)
	}
	return res, nil
}
