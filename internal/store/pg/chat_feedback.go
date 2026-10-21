package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ErrNotAnAnswer is returned when a rating names a message that is not one of
// the learner's assistant answers (another user's, a question, or none).
var ErrNotAnAnswer = errors.New("only an answer in your own conversation can be rated")

// FeedbackCategories are the reasons a Dislike may give, mirrored by the web
// client's dialog. A Like takes none.
var FeedbackCategories = []string{"wrong_info", "ignored_material", "unclear", "too_long", "tool_failed", "other"}

// ChatFeedback is one learner's rating of one answer.
type ChatFeedback struct {
	MessageID uuid.UUID
	Rating    string // "good" or "bad"
	Category  string
	Comment   string
	Provider  string
	Model     string
	UpdatedAt time.Time
}

// PutFeedback records or replaces the learner's rating of an answer. The
// provider and model that answered are read from the stored message
// (attachments.served), so a client cannot attribute a rating to a model.
func (s *ChatStore) PutFeedback(
	ctx context.Context, userID, messageID uuid.UUID, rating, category, comment string,
) (*ChatFeedback, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO chat_feedback (user_id, session_id, message_id, rating, category, comment, provider, model)
		SELECT m.user_id, m.session_id, m.id, $3, NULLIF($4, ''), NULLIF($5, ''),
		       COALESCE(m.attachments #>> '{served,provider}', ''),
		       COALESCE(m.attachments #>> '{served,model}', '')
		  FROM chat_messages m
		 WHERE m.id = $2 AND m.user_id = $1 AND m.role = 'assistant'
		ON CONFLICT (user_id, message_id) DO UPDATE
		   SET rating = EXCLUDED.rating, category = EXCLUDED.category, comment = EXCLUDED.comment,
		       updated_at = now()
		RETURNING message_id, rating, COALESCE(category, ''), COALESCE(comment, ''), provider, model, updated_at`,
		userID, messageID, rating, category, comment)
	var f ChatFeedback
	if err := row.Scan(&f.MessageID, &f.Rating, &f.Category, &f.Comment, &f.Provider, &f.Model, &f.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotAnAnswer
		}
		return nil, fmt.Errorf("put chat feedback: %w", err)
	}
	return &f, nil
}

// DeleteFeedback retracts the learner's rating of an answer. An answer of
// theirs with no rating is not an error: the end state is the same. Anything
// that is not one of their answers is ErrNotAnAnswer, as for PutFeedback.
func (s *ChatStore) DeleteFeedback(ctx context.Context, userID, messageID uuid.UUID) error {
	var owned int
	err := s.pool.QueryRow(ctx, `
		WITH owned AS (
			SELECT id FROM chat_messages WHERE id = $2 AND user_id = $1 AND role = 'assistant'
		), gone AS (
			DELETE FROM chat_feedback f USING owned WHERE f.user_id = $1 AND f.message_id = owned.id
		)
		SELECT count(*) FROM owned`, userID, messageID).Scan(&owned)
	if err != nil {
		return fmt.Errorf("delete chat feedback: %w", err)
	}
	if owned == 0 {
		return ErrNotAnAnswer
	}
	return nil
}

// ListFeedback returns the learner's ratings in one conversation.
func (s *ChatStore) ListFeedback(ctx context.Context, userID, sessionID uuid.UUID) ([]ChatFeedback, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT message_id, rating, COALESCE(category, ''), COALESCE(comment, ''), provider, model, updated_at
		  FROM chat_feedback
		 WHERE user_id = $1 AND session_id = $2`, userID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("list chat feedback: %w", err)
	}
	defer rows.Close()
	out := []ChatFeedback{}
	for rows.Next() {
		var f ChatFeedback
		if err := rows.Scan(&f.MessageID, &f.Rating, &f.Category, &f.Comment, &f.Provider, &f.Model, &f.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan chat feedback: %w", err)
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// RunningSessions returns which of the learner's conversations have a turn
// that has not ended (queued, running, or waiting on the learner).
func (s *ChatStore) RunningSessions(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]bool, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT session_id FROM turns
		 WHERE user_id = $1 AND status IN ('queued', 'running', 'waiting_user')`, userID)
	if err != nil {
		return nil, fmt.Errorf("running chat sessions: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan running session: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}
