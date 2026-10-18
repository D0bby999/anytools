package oauth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// pending.go — the state a two-step sign-in holds between its steps: the
// device code a Copilot poll needs, or the PKCE verifier a Claude code
// exchange needs.
//
// In memory, because the API runs as exactly one replica (docs/deployment.md)
// and a sign-in that spans a restart simply starts again. Each entry is bound
// to the user who started it: a session id is only a handle, and another
// user presenting it gets ErrPendingNotFound — the same answer as an id that
// never existed, so the store says nothing about other users' sign-ins.

// ErrPendingNotFound is returned for an unknown, expired or foreign session.
var ErrPendingNotFound = errors.New("oauth: that sign-in expired or was not started here — start again")

// UserError is a sign-in failure the user can act on; its text is written to
// be shown to them and carries no upstream body.
type UserError struct{ Msg string }

func (e *UserError) Error() string { return e.Msg }

func userErr(msg string) error { return &UserError{Msg: msg} }

// maxPendingPerUser bounds what one user can park in memory.
const maxPendingPerUser = 4

type pending struct {
	userID     uuid.UUID
	flow       Flow
	deviceCode string // Copilot
	verifier   string // Claude
	state      string // Claude
	expires    time.Time
}

type pendingStore struct {
	mu  sync.Mutex
	m   map[string]pending
	now func() time.Time
}

var sessions = &pendingStore{m: map[string]pending{}, now: time.Now}

// put stores p for ttl and returns its handle. The oldest of a user's entries
// is dropped once they hold maxPendingPerUser.
func (s *pendingStore) put(p pending, ttl time.Duration) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	var oldestID string
	var oldest time.Time
	mine := 0
	for id, e := range s.m {
		if now.After(e.expires) {
			delete(s.m, id)
			continue
		}
		if e.userID == p.userID {
			mine++
			if oldestID == "" || e.expires.Before(oldest) {
				oldestID, oldest = id, e.expires
			}
		}
	}
	if mine >= maxPendingPerUser {
		delete(s.m, oldestID)
	}
	p.expires = now.Add(ttl)
	id := randomToken(24)
	s.m[id] = p
	return id
}

// get returns the entry if it exists, is live, belongs to userID and is for
// flow.
func (s *pendingStore) get(id string, userID uuid.UUID, flow Flow) (pending, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.m[id]
	if !ok || e.userID != userID || e.flow != flow {
		return pending{}, ErrPendingNotFound
	}
	if s.now().After(e.expires) {
		delete(s.m, id)
		return pending{}, ErrPendingNotFound
	}
	return e, nil
}

func (s *pendingStore) drop(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
