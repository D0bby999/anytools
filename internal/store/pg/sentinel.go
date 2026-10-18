package pg

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/D0bby999/anytools/internal/crypto"
)

// sentinelPlaintext is the known value encrypted into app_sentinel. It is not a
// secret — its only job is to be recognizable after a round trip.
const sentinelPlaintext = "longplay-encryption-key-sentinel-v1"

// ErrEncryptionKeyMismatch means app_sentinel exists but does not decrypt under
// the configured key: the process was started with a DIFFERENT key than the one
// the data was written with.
//
// Without this check, booting with the wrong key succeeds. The failure then
// surfaces much later as individually unreadable BYOK credentials — by which
// point new rows have been written under the wrong key and the two generations
// are interleaved in one column. Failing at boot keeps that from ever starting.
var ErrEncryptionKeyMismatch = errors.New("pg: ANYTOOLS_ENCRYPTION_KEY does not match the key this database was written with")

// SentinelStore owns the boot-time encryption-key smoke test.
type SentinelStore struct {
	pool   *Pool
	encKey string
}

// NewSentinelStore builds a SentinelStore.
func NewSentinelStore(pool *Pool, encKey string) *SentinelStore {
	return &SentinelStore{pool: pool, encKey: encKey}
}

// Verify decrypts the stored sentinel under the configured key, seeding it on a
// first run. Returns ErrEncryptionKeyMismatch when the row exists but does not
// decrypt, which is the wrong-key case.
func (s *SentinelStore) Verify(ctx context.Context) error {
	var ciphertext string
	err := s.pool.QueryRow(ctx, `SELECT ciphertext FROM app_sentinel WHERE id = 1`).Scan(&ciphertext)

	if errors.Is(err, pgx.ErrNoRows) {
		return s.seed(ctx)
	}
	if err != nil {
		return fmt.Errorf("read sentinel: %w", err)
	}

	plaintext, decErr := crypto.Decrypt(ciphertext, s.encKey)
	if decErr != nil || plaintext != sentinelPlaintext {
		return ErrEncryptionKeyMismatch
	}
	return nil
}

func (s *SentinelStore) seed(ctx context.Context) error {
	ciphertext, err := encryptOrFail(sentinelPlaintext, s.encKey, "app_sentinel.ciphertext")
	if err != nil {
		return err
	}
	// ON CONFLICT DO NOTHING: two processes racing on a fresh database must not
	// let the loser overwrite the winner's sentinel with a different nonce.
	if _, err := s.pool.Exec(ctx,
		`INSERT INTO app_sentinel (id, ciphertext) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
		ciphertext,
	); err != nil {
		return fmt.Errorf("seed sentinel: %w", err)
	}
	// Re-verify: if we lost the race, the stored row is the winner's and must
	// still decrypt under our key or the keys genuinely differ.
	var stored string
	if err := s.pool.QueryRow(ctx, `SELECT ciphertext FROM app_sentinel WHERE id = 1`).Scan(&stored); err != nil {
		return fmt.Errorf("read sentinel after seed: %w", err)
	}
	plaintext, decErr := crypto.Decrypt(stored, s.encKey)
	if decErr != nil || plaintext != sentinelPlaintext {
		return ErrEncryptionKeyMismatch
	}
	return nil
}
