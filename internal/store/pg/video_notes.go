package pg

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/capabilities/videonotes"
)

// VideoNotesStore holds videos' study notes (migration 1789880000). Every
// statement names the caller's user_id, and the composite foreign key to
// documents (id, user_id) refuses notes on another user's video even if a
// caller forgot to check.
type VideoNotesStore struct{ pool *Pool }

// NewVideoNotesStore builds the store.
func NewVideoNotesStore(pool *Pool) *VideoNotesStore { return &VideoNotesStore{pool: pool} }

// Save writes notes, replacing the video's notes in the same language.
func (s *VideoNotesStore) Save(ctx context.Context, userID uuid.UUID, n videonotes.Notes) (*videonotes.Notes, error) {
	sections, err := json.Marshal(n.Sections)
	if err != nil {
		return nil, err
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO video_notes (user_id, document_id, language, transcript_sha256, sections, from_chapters, model, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id, document_id, language) DO UPDATE SET
			transcript_sha256 = EXCLUDED.transcript_sha256, sections = EXCLUDED.sections,
			from_chapters = EXCLUDED.from_chapters, model = EXCLUDED.model, created_at = EXCLUDED.created_at
		RETURNING id`,
		userID, n.DocumentID, n.Language, n.TranscriptSHA256, sections, n.FromChapters, n.Model, n.CreatedAt).Scan(&n.ID)
	if err != nil {
		return nil, fmt.Errorf("save video notes: %w", err)
	}
	return &n, nil
}

// List reads a video's notes, newest first.
func (s *VideoNotesStore) List(ctx context.Context, userID, documentID uuid.UUID) ([]videonotes.Notes, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, document_id, language, transcript_sha256, sections, from_chapters, model, created_at
		  FROM video_notes WHERE user_id = $1 AND document_id = $2
		 ORDER BY created_at DESC`, userID, documentID)
	if err != nil {
		return nil, fmt.Errorf("list video notes: %w", err)
	}
	defer rows.Close()
	out := []videonotes.Notes{}
	for rows.Next() {
		var n videonotes.Notes
		var raw []byte
		if err := rows.Scan(&n.ID, &n.DocumentID, &n.Language, &n.TranscriptSHA256, &raw, &n.FromChapters, &n.Model, &n.CreatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &n.Sections); err != nil {
			return nil, fmt.Errorf("video notes %s: %w", n.ID, err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
