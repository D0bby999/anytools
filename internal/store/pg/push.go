package pg

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/crypto"
	"github.com/D0bby999/anytools/internal/push"
)

// PushStore is the review reminders' persistence (internal/push).
type PushStore struct {
	pool   *Pool
	encKey string
}

// NewPushStore builds a PushStore. The VAPID private key is encrypted under
// encKey.
func NewPushStore(pool *Pool, encKey string) *PushStore {
	return &PushStore{pool: pool, encKey: encKey}
}

var _ push.Store = (*PushStore)(nil)

// VAPIDKeys implements push.Store.
func (s *PushStore) VAPIDKeys(ctx context.Context) (push.Keys, bool, error) {
	var public, enc string
	err := s.pool.QueryRow(ctx, `SELECT public_key, private_key_enc FROM push_vapid WHERE id = 1`).Scan(&public, &enc)
	if errors.Is(err, pgx.ErrNoRows) {
		return push.Keys{}, false, nil
	}
	if err != nil {
		return push.Keys{}, false, fmt.Errorf("vapid keys: %w", err)
	}
	private, err := crypto.Decrypt(enc, s.encKey)
	if err != nil {
		return push.Keys{}, false, fmt.Errorf("vapid keys: decrypt: %w", err)
	}
	return push.Keys{Public: public, Private: private}, true, nil
}

// SaveVAPIDKeys implements push.Store.
func (s *PushStore) SaveVAPIDKeys(ctx context.Context, keys push.Keys) (push.Keys, error) {
	enc, err := encryptOrFail(keys.Private, s.encKey, "push_vapid.private_key_enc")
	if err != nil {
		return push.Keys{}, err
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO push_vapid (id, public_key, private_key_enc) VALUES (1, $1, $2)
		ON CONFLICT (id) DO NOTHING`, keys.Public, enc); err != nil {
		return push.Keys{}, fmt.Errorf("save vapid keys: %w", err)
	}
	stored, _, err := s.VAPIDKeys(ctx)
	return stored, err
}

// Subscribe implements push.Store. A browser that signed in as someone else
// re-subscribes, and its row moves to the new account.
func (s *PushStore) Subscribe(ctx context.Context, userID uuid.UUID, sub push.Subscription) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
		ON CONFLICT (endpoint) DO UPDATE
		   SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
		userID, sub.Endpoint, sub.P256dh, sub.Auth)
	if err != nil {
		return fmt.Errorf("push subscribe: %w", err)
	}
	return nil
}

// Unsubscribe implements push.Store.
func (s *PushStore) Unsubscribe(ctx context.Context, userID uuid.UUID, endpoint string) error {
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`, userID, endpoint); err != nil {
		return fmt.Errorf("push unsubscribe: %w", err)
	}
	return nil
}

// Subscriptions implements push.Store.
func (s *PushStore) Subscriptions(ctx context.Context, userID uuid.UUID) ([]push.Subscription, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT endpoint, p256dh, auth FROM push_subscriptions
		 WHERE user_id = $1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, fmt.Errorf("push subscriptions: %w", err)
	}
	return scanSubscriptions(rows)
}

// Forget implements push.Store. Not user-scoped: the push service, not a
// learner, said the endpoint is gone.
func (s *PushStore) Forget(ctx context.Context, endpoint string) error {
	if _, err := s.pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint); err != nil {
		return fmt.Errorf("push forget: %w", err)
	}
	return nil
}

// Settings implements push.Store.
func (s *PushStore) Settings(ctx context.Context, userID uuid.UUID) (int, string, string, error) {
	var hour int
	var tz, language string
	err := s.pool.QueryRow(ctx, `SELECT reminder_hour, timezone, language FROM users WHERE id = $1`, userID).Scan(&hour, &tz, &language)
	if err != nil {
		return 0, "", "", fmt.Errorf("push settings: %w", err)
	}
	return hour, tz, language, nil
}

// SetHour implements push.Store.
func (s *PushStore) SetHour(ctx context.Context, userID uuid.UUID, hour int) error {
	if _, err := s.pool.Exec(ctx, `UPDATE users SET reminder_hour = $2 WHERE id = $1`, userID, hour); err != nil {
		return fmt.Errorf("push set hour: %w", err)
	}
	return nil
}

// ClaimReminder implements push.Store. The UPDATE is the claim: its WHERE is
// every condition, so two ticks racing for the same day update one row once.
func (s *PushStore) ClaimReminder(ctx context.Context, userID uuid.UUID, now time.Time, window int) ([]push.Subscription, string, bool, error) {
	var language string
	err := s.pool.QueryRow(ctx, `
		UPDATE users u
		   SET reminder_sent_on = ($2::timestamptz AT TIME ZONE u.timezone)::date
		 WHERE u.id = $1
		   AND (24 + extract(hour FROM $2::timestamptz AT TIME ZONE u.timezone)::int - u.reminder_hour) % 24 < $3
		   AND u.reminder_sent_on IS DISTINCT FROM ($2::timestamptz AT TIME ZONE u.timezone)::date
		   AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = u.id)
		RETURNING u.language`,
		userID, now, window).Scan(&language)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, fmt.Errorf("claim reminder: %w", err)
	}
	subs, err := s.Subscriptions(ctx, userID)
	if err != nil {
		return nil, "", false, err
	}
	return subs, language, true, nil
}

func scanSubscriptions(rows pgx.Rows) ([]push.Subscription, error) {
	defer rows.Close()
	out := []push.Subscription{}
	for rows.Next() {
		var sub push.Subscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			return nil, fmt.Errorf("push subscriptions: scan: %w", err)
		}
		out = append(out, sub)
	}
	return out, rows.Err()
}
