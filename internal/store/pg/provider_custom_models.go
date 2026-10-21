package pg

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/store"
)

// ListCustomModels returns a connection's hand-added models, oldest first.
// An empty list for a connection that is not the caller's, like any other.
func (s *ProviderConnectionStore) ListCustomModels(ctx context.Context, userID, connectionID uuid.UUID) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT model FROM provider_custom_models
		WHERE user_id = $1 AND connection_id = $2
		ORDER BY created_at, model`, userID, connectionID)
	if err != nil {
		return nil, fmt.Errorf("list custom models: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return nil, fmt.Errorf("list custom models: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AddCustomModel stores one model id on the caller's own connection. The
// insert reads the connection by (user, id), so another user's id adds
// nothing and answers ErrConnectionNotFound.
func (s *ProviderConnectionStore) AddCustomModel(ctx context.Context, userID, connectionID uuid.UUID, model string) error {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO provider_custom_models (connection_id, user_id, model)
		SELECT id, user_id, $3 FROM provider_connections WHERE user_id = $1 AND id = $2
		ON CONFLICT (connection_id, model) DO NOTHING`, userID, connectionID, model)
	if err != nil {
		return fmt.Errorf("add custom model: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// Either a repeat (fine) or not the caller's connection (not found).
		var mine bool
		if err := s.pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM provider_connections WHERE user_id = $1 AND id = $2)`,
			userID, connectionID).Scan(&mine); err != nil {
			return fmt.Errorf("add custom model: %w", err)
		}
		if !mine {
			return store.ErrConnectionNotFound
		}
	}
	return nil
}

// DeleteCustomModel removes one hand-added model; a missing one is not found.
func (s *ProviderConnectionStore) DeleteCustomModel(ctx context.Context, userID, connectionID uuid.UUID, model string) error {
	tag, err := s.pool.Exec(ctx, `
		DELETE FROM provider_custom_models WHERE user_id = $1 AND connection_id = $2 AND model = $3`,
		userID, connectionID, model)
	if err != nil {
		return fmt.Errorf("delete custom model: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return store.ErrConnectionNotFound
	}
	return nil
}

var _ store.CustomModelStore = (*ProviderConnectionStore)(nil)
