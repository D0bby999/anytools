package runtime

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// fakeTurnStore is an in-memory TurnStore that enforces the SAME guards the SQL
// does: a claim only from `queued`, a status change only from an allowed
// source status, a heartbeat only on a live turn.
//
// It exists so the turn lifecycle can be tested without a database — but it
// would be worthless if it were more permissive than the real store, because
// then a test could pass on a transition Postgres rejects. The DB-backed twin
// of these assertions lives in internal/store/pg/turns_test.go.
type fakeTurnStore struct {
	mu    sync.Mutex
	turns map[uuid.UUID]*Turn
}

func newFakeTurnStore() *fakeTurnStore {
	return &fakeTurnStore{turns: map[uuid.UUID]*Turn{}}
}

func (s *fakeTurnStore) CreateTurn(_ context.Context, t Turn) (*Turn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t.ID = uuid.New()
	t.Status = StatusQueued
	if t.Capability == "" {
		t.Capability = "chat"
	}
	t.CreatedAt = time.Now()
	t.UpdatedAt = t.CreatedAt
	s.turns[t.ID] = &t
	out := t
	return &out, nil
}

func (s *fakeTurnStore) ClaimTurn(_ context.Context, id uuid.UUID, lease time.Duration) (*Turn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.turns[id]
	if !ok || t.Status != StatusQueued {
		return nil, ErrTurnNotFound
	}
	t.Status = StatusRunning
	t.Attempt++
	exp := time.Now().Add(lease)
	t.LeaseExpires = &exp
	t.HeartbeatAt = &exp
	out := *t
	return &out, nil
}

func (s *fakeTurnStore) Heartbeat(_ context.Context, id uuid.UUID, lease time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.turns[id]
	if !ok || (t.Status != StatusRunning && t.Status != StatusWaitingUser) {
		return ErrTurnNotFound
	}
	exp := time.Now().Add(lease)
	t.LeaseExpires = &exp
	return nil
}

func (s *fakeTurnStore) SetStatus(
	_ context.Context, id uuid.UUID, from []string, to string, upd TurnUpdate,
) (*Turn, error) {
	for _, f := range from {
		if err := CheckTransition(f, to); err != nil {
			return nil, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.turns[id]
	if !ok {
		return nil, nil
	}
	matched := false
	for _, f := range from {
		if t.Status == f {
			matched = true
			break
		}
	}
	if !matched {
		return nil, nil
	}

	t.Status = to
	if upd.FailureCode != "" {
		t.FailureCode = upd.FailureCode
	}
	t.Retryable = upd.Retryable
	if upd.Error != "" {
		t.Error = upd.Error
	}
	if upd.Provider != "" {
		t.Provider = upd.Provider
	}
	if upd.Model != "" {
		t.Model = upd.Model
	}
	if upd.Usage != nil {
		t.Usage = *upd.Usage
	}
	if upd.ClearLease {
		t.LeaseExpires = nil
	}
	if upd.Finished {
		now := time.Now()
		t.FinishedAt = &now
	}
	out := *t
	return &out, nil
}

func (s *fakeTurnStore) GetTurn(_ context.Context, userID, id uuid.UUID) (*Turn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := s.turns[id]
	if !ok || t.UserID != userID {
		return nil, ErrTurnNotFound
	}
	out := *t
	return &out, nil
}

func (s *fakeTurnStore) ExpiredTurns(_ context.Context, limit int) ([]Turn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Turn
	for _, t := range s.turns {
		if t.Status != StatusRunning && t.Status != StatusWaitingUser {
			continue
		}
		if t.LeaseExpires == nil || t.LeaseExpires.After(time.Now()) {
			continue
		}
		out = append(out, *t)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// fakeEventStore records every persisted batch so a test can assert the
// coalescing and ordering rules the sink promises.
type fakeEventStore struct {
	mu        sync.Mutex
	events    []Event
	batches   [][]Event
	fail      error
	attempted int
}

func newFakeEventStore() *fakeEventStore { return &fakeEventStore{} }

func (s *fakeEventStore) AppendEvents(_ context.Context, _, _ uuid.UUID, evs []Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.attempted++
	if s.fail != nil {
		return s.fail
	}
	// Idempotent, like the real store: a replayed batch is not a duplicate.
	seen := map[int64]bool{}
	for _, ev := range s.events {
		seen[ev.Seq] = true
	}
	kept := evs[:0:0]
	for _, ev := range evs {
		if !seen[ev.Seq] {
			kept = append(kept, ev)
		}
	}
	evs = kept
	batch := make([]Event, len(evs))
	copy(batch, evs)
	s.batches = append(s.batches, batch)
	s.events = append(s.events, batch...)
	return nil
}

func (s *fakeEventStore) EventsAfter(_ context.Context, _, _ uuid.UUID, afterSeq int64, _ int) ([]Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Event
	for _, ev := range s.events {
		if ev.Seq > afterSeq {
			out = append(out, ev)
		}
	}
	return out, nil
}

func (s *fakeEventStore) MaxSeq(_ context.Context, _ uuid.UUID) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var max int64
	for _, ev := range s.events {
		if ev.Seq > max {
			max = ev.Seq
		}
	}
	return max, nil
}

func (s *fakeEventStore) setFailure(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fail = err
}

func (s *fakeEventStore) attempts() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.attempted
}

func (s *fakeEventStore) all() []Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Event, len(s.events))
	copy(out, s.events)
	return out
}

func (s *fakeEventStore) batchCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.batches)
}

// fakeCapability runs whatever a test hands it.
type fakeCapability struct {
	name string
	run  func(ctx context.Context, tc *TurnContext) error
}

func (c fakeCapability) Name() string { return c.name }

func (c fakeCapability) Run(ctx context.Context, tc *TurnContext) error { return c.run(ctx, tc) }

// fakeProvider scripts a sequence of responses, one per round.
type fakeProvider struct {
	name      string
	model     string
	responses []*ChatResponse
	// stream, when set for a response index, is emitted as chunks before that
	// response is returned.
	streams map[int][]string
	err     error

	mu       sync.Mutex
	round    int
	requests []ChatRequest
}

func (p *fakeProvider) Name() string         { return p.name }
func (p *fakeProvider) DefaultModel() string { return p.model }

func (p *fakeProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	return p.ChatStream(ctx, req, func(StreamChunk) {})
}

func (p *fakeProvider) ChatStream(_ context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error) {
	p.mu.Lock()
	round := p.round
	p.round++
	p.requests = append(p.requests, req)
	p.mu.Unlock()

	if p.err != nil {
		return nil, p.err
	}
	for _, chunk := range p.streams[round] {
		onChunk(StreamChunk{Content: chunk})
	}
	if round >= len(p.responses) {
		return nil, errors.New("fakeProvider: no scripted response for round")
	}
	return p.responses[round], nil
}

func (p *fakeProvider) sentRequests() []ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]ChatRequest, len(p.requests))
	copy(out, p.requests)
	return out
}

type fakeResolver struct {
	provider ChatProvider
	err      error
}

func (r fakeResolver) ChatFor(context.Context, uuid.UUID, string) (ChatProvider, error) {
	if r.err != nil {
		return nil, r.err
	}
	return r.provider, nil
}

// fakeTool is a scriptable Tool.
type fakeTool struct {
	name    string
	network bool
	run     func(ctx context.Context, args map[string]any, in ToolInput) (ToolResult, error)
}

func (t fakeTool) Name() string       { return t.name }
func (t fakeTool) NeedsNetwork() bool { return t.network }

func (t fakeTool) Definition() ToolDefinition {
	return ToolDefinition{Type: "function", Function: ToolFunctionSchema{
		Name: t.name, Description: t.name,
		Parameters: map[string]any{"type": "object", "properties": map[string]any{}},
	}}
}

func (t fakeTool) Execute(ctx context.Context, args map[string]any, in ToolInput) (ToolResult, error) {
	return t.run(ctx, args, in)
}
