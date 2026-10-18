package drive

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// fakes_test.go — in-memory implementations of the three interfaces store.go
// declares, so the service's own logic can be tested without Postgres and
// without the Knowledge Center.
//
// They are deliberately strict where the real store is strict: every read and
// write is scoped by user id, so a test that forgets one fails here rather than
// passing and failing against the database later.

type memStore struct {
	mu     sync.Mutex
	conns  map[uuid.UUID]*Connection
	grants map[uuid.UUID]*Grant
	states map[uuid.UUID]*SyncState

	// failSaveSyncState makes the checkpoint write fail, so a test can prove a
	// failed checkpoint is reported rather than swallowed.
	failSaveSyncState bool
}

func newMemStore() *memStore {
	return &memStore{
		conns:  map[uuid.UUID]*Connection{},
		grants: map[uuid.UUID]*Grant{},
		states: map[uuid.UUID]*SyncState{},
	}
}

func (m *memStore) GetConnection(_ context.Context, userID uuid.UUID) (*Connection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.conns[userID]
	if !ok {
		return nil, ErrNotConnected
	}
	copied := *c
	return &copied, nil
}

func (m *memStore) SaveConnection(_ context.Context, conn Connection) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	conn.NeedsReconnect = false
	conn.LastError = ""
	m.conns[conn.UserID] = &conn
	return nil
}

func (m *memStore) SaveAccessToken(_ context.Context, userID uuid.UUID, access string, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.conns[userID]
	if !ok {
		return ErrNotConnected
	}
	c.AccessToken = access
	exp := expiresAt
	c.ExpiresAt = &exp
	return nil
}

func (m *memStore) MarkNeedsReconnect(_ context.Context, userID uuid.UUID, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.conns[userID]; ok {
		c.NeedsReconnect = true
		c.LastError = reason
		c.AccessToken = ""
		c.ExpiresAt = nil
	}
	return nil
}

func (m *memStore) DeleteConnection(_ context.Context, userID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.conns, userID)
	delete(m.states, userID)
	for id, g := range m.grants {
		if g.UserID == userID {
			delete(m.grants, id)
		}
	}
	return nil
}

func (m *memStore) ListConnectedUsers(context.Context) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []uuid.UUID
	for id, c := range m.conns {
		if !c.NeedsReconnect {
			out = append(out, id)
		}
	}
	return out, nil
}

func (m *memStore) UpsertGrant(_ context.Context, g Grant) (*Grant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, existing := range m.grants {
		if existing.UserID == g.UserID && existing.KBID == g.KBID && existing.FileID == g.FileID {
			existing.Kind = g.Kind
			if g.ParentFileID != "" {
				existing.ParentFileID = g.ParentFileID
			}
			existing.Name, existing.MIME = g.Name, g.MIME
			existing.State, existing.LastError = g.State, g.LastError
			copied := *existing
			return &copied, nil
		}
	}
	g.ID = uuid.New()
	if g.State == "" {
		g.State = GrantActive
	}
	m.grants[g.ID] = &g
	copied := g
	return &copied, nil
}

func (m *memStore) ListGrants(_ context.Context, userID uuid.UUID, kbID *uuid.UUID) ([]Grant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Grant
	for _, g := range m.grants {
		if g.UserID != userID {
			continue
		}
		if kbID != nil && g.KBID != *kbID {
			continue
		}
		out = append(out, *g)
	}
	return out, nil
}

func (m *memStore) ListActiveFileGrants(_ context.Context, userID uuid.UUID) ([]Grant, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Grant
	for _, g := range m.grants {
		if g.UserID == userID && g.Kind == KindFile && g.State == GrantActive {
			out = append(out, *g)
		}
	}
	// ORDER BY file_id, exactly as the real store does. Without it Go's random
	// map order makes the post-410 full pass hit Drive in a different sequence
	// on every run, and a recorded-HTTP test would fail one run in two — which
	// reads as flakiness rather than as the missing guarantee it is.
	sort.Slice(out, func(i, j int) bool { return out[i].FileID < out[j].FileID })
	return out, nil
}

func (m *memStore) SetGrantState(_ context.Context, userID, grantID uuid.UUID, state, lastError string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.grants[grantID]
	if !ok || g.UserID != userID {
		return errors.New("no such grant")
	}
	g.State, g.LastError = state, lastError
	return nil
}

func (m *memStore) RecordGrantSynced(_ context.Context, userID, grantID, documentID uuid.UUID, md5, modifiedTime string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.grants[grantID]
	if !ok || g.UserID != userID {
		return errors.New("no such grant")
	}
	doc := documentID
	g.DocumentID = &doc
	g.MD5, g.ModifiedTime = md5, modifiedTime
	g.State, g.LastError = GrantActive, ""
	return nil
}

func (m *memStore) GetSyncState(_ context.Context, userID uuid.UUID) (*SyncState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if st, ok := m.states[userID]; ok {
		copied := *st
		return &copied, nil
	}
	return &SyncState{UserID: userID}, nil
}

func (m *memStore) SaveSyncState(_ context.Context, st SyncState) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.failSaveSyncState {
		return errors.New("checkpoint write failed")
	}
	m.states[st.UserID] = &st
	return nil
}

// grantFor finds a grant by Drive file id, for assertions.
func (m *memStore) grantFor(fileID string) *Grant {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, g := range m.grants {
		if g.FileID == fileID {
			copied := *g
			return &copied
		}
	}
	return nil
}

// memImporter records what reached the Knowledge Center.
type memImporter struct {
	mu      sync.Mutex
	calls   []ImportRequest
	docByID map[string]uuid.UUID
	err     error
}

func newMemImporter() *memImporter {
	return &memImporter{docByID: map[string]uuid.UUID{}}
}

func (m *memImporter) Import(_ context.Context, req ImportRequest) (uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return uuid.Nil, m.err
	}
	m.calls = append(m.calls, req)
	// Stable per external id, like the real upsert: a re-import is a new
	// version of the SAME document, not a second one.
	id, ok := m.docByID[req.ExternalID]
	if !ok {
		id = uuid.New()
		m.docByID[req.ExternalID] = id
	}
	return id, nil
}

func (m *memImporter) importedIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, len(m.calls))
	for i, c := range m.calls {
		out[i] = c.ExternalID
	}
	return out
}

// allowAll is an Authorizer that says yes. Cross-user refusal is tested against
// the real authorizer and the real store, where it is actually enforced.
type allowAll struct{}

func (allowAll) OwnsKB(context.Context, uuid.UUID, uuid.UUID) error { return nil }

// denyAll proves the service asks BEFORE it does anything.
type denyAll struct{ err error }

func (d denyAll) OwnsKB(context.Context, uuid.UUID, uuid.UUID) error { return d.err }
