package pg

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/store"
)

// ConnectionLockStore is a Postgres advisory lock keyed on a connection id.
//
// The property the whole design rests on: a Postgres advisory lock is
// SESSION-scoped. The acquiring connection must therefore be PINNED for the
// lock's lifetime and the unlock must run on that same connection — acquiring
// from a pool and releasing on a different pooled connection unlocks a session
// that never held the lock and leaks the real one.
//
// Why a lock at all, measured rather than assumed (reports/spike-providers.md,
// "Concurrency"): five simultaneous callers refreshing one OAuth connection
// with NO lock produced 1 accepted refresh and 4 `invalid_grant` rejections,
// with all five callers left holding a dead token. With this lock: exactly one
// refresh, zero rejections.
type ConnectionLockStore struct {
	pool  *pgxpool.Pool
	mu    sync.Mutex
	conns map[int64]*pgxpool.Conn // the pinned connection per held key
}

func NewConnectionLockStore(pool *pgxpool.Pool) *ConnectionLockStore {
	return &ConnectionLockStore{pool: pool, conns: make(map[int64]*pgxpool.Conn)}
}

var _ store.OAuthConnectionLocker = (*ConnectionLockStore)(nil)

// connectionLockKey folds the first 8 bytes of the connection uuid into the
// int64 an advisory lock takes, XORed with a namespace seed so this lock domain
// cannot collide with any other advisory lock in the same database (the user
// sign-in lock in users.go is keyed on an email hash and would otherwise share
// the space).
func connectionLockKey(connectionID uuid.UUID) int64 {
	var key int64
	for i := 0; i < 8; i++ {
		key = (key << 8) | int64(connectionID[i])
	}
	const nsPrefix int64 = 0x4F41555448434F4E // "OAUTHCON"
	return key ^ nsPrefix
}

// TryAcquireConnectionLock is non-blocking: (false, nil) means another session
// holds it right now, and the caller should serve the token already in hand
// rather than queue behind a network round trip.
func (s *ConnectionLockStore) TryAcquireConnectionLock(ctx context.Context, connectionID uuid.UUID) (bool, error) {
	key := connectionLockKey(connectionID)
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("connection lock conn: %w", err)
	}
	var locked bool
	if scanErr := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", key).Scan(&locked); scanErr != nil {
		conn.Release()
		return false, fmt.Errorf("connection lock query: %w", scanErr)
	}
	if !locked {
		conn.Release()
		return false, nil
	}
	s.mu.Lock()
	s.conns[key] = conn
	s.mu.Unlock()
	return true, nil
}

// ReleaseConnectionLock unlocks on the SAME pinned connection, then returns it
// to the pool. Safe to call when the lock was never acquired.
func (s *ConnectionLockStore) ReleaseConnectionLock(_ context.Context, connectionID uuid.UUID) error {
	key := connectionLockKey(connectionID)
	s.mu.Lock()
	conn := s.conns[key]
	delete(s.conns, key)
	s.mu.Unlock()
	if conn == nil {
		return nil
	}
	// Deliberately context.Background(): the release must happen even when the
	// caller's context was cancelled mid-refresh, or the lock survives until
	// the session is reaped and every later refresh for that connection takes
	// the "someone else holds it" branch forever.
	_, err := conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", key)
	conn.Release()
	if err != nil {
		return fmt.Errorf("connection advisory unlock: %w", err)
	}
	return nil
}
