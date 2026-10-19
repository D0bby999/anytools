package chatapi_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/chatapi"
	"github.com/D0bby999/anytools/internal/capabilities/chat"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
	"github.com/D0bby999/anytools/internal/tools"
)

const testGatewayToken = "chatapi-test-token"

// process is one API "process": its own bus registry and orchestrator over a
// shared database. Two of them is how the kill-and-restart test works — the
// second process has never seen the first one's in-memory state, which is
// exactly the situation after a restart.
type process struct {
	server   *httptest.Server
	orch     *runtime.Orchestrator
	recovery *runtime.Recovery
	turns    *pg.TurnStore
	chat     *pg.ChatStore
	provider *scriptedProvider
	finished chan string
}

type harness struct {
	pool   *pgxpool.Pool
	userID uuid.UUID
	kbID   uuid.UUID
	authz  *fakeAuthz
	docID  uuid.UUID
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	pool := testutil.TestDB(t)

	var userID uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name, email_verified_at)
		 VALUES ($1, 'Chat API Test', now()) RETURNING id`,
		"chatapi-"+uuid.NewString()+"@example.test").Scan(&userID)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})

	h := &harness{pool: pool, userID: userID, kbID: uuid.New(), docID: uuid.New(), authz: newFakeAuthz()}
	h.authz.kbs[h.kbID] = userID
	h.authz.docs[h.docID] = userID
	return h
}

// start builds a process. The scripted provider is per-process so a restart can
// be given a different script.
func (h *harness) start(t *testing.T, provider *scriptedProvider) *process {
	t.Helper()

	chatStore := pg.NewChatStore(h.pool)
	turnStore := pg.NewTurnStore(h.pool)

	retriever := &fakeRetriever{chunks: []tools.Chunk{{
		ID: "chunk-1", DocumentID: h.docID.String(), DocumentTitle: "Chapter 3",
		Page: 14, Text: "Hybrid retrieval merges a lexical arm and a vector arm with RRF.",
	}}}

	registry := runtime.NewToolRegistry()
	registry.Register(
		tools.NewRAGSearch(retriever, h.authz),
		tools.NewReadSource(&fakeReader{}, h.authz),
		tools.NewAskUser(),
	)

	caps := runtime.NewCapabilityRegistry()
	caps.Register(chat.New(chatStore))

	finished := make(chan string, 8)
	buses := runtime.NewBusRegistry()
	orch := runtime.NewOrchestrator(runtime.OrchestratorDeps{
		Turns: turnStore, Events: turnStore, Capabilities: caps, Tools: registry,
		Providers: fakeResolver{provider: provider}, Buses: buses,
		OnFinish: func(_ uuid.UUID, status string) { finished <- status },
	})

	handler := api.BuildMux(api.Deps{
		Chat:         chatapi.NewHandler(chatStore, turnStore, orch, h.authz).WithOwnVersion(pg.NewUserStore(h.pool)).WithChatConnections(chatStore),
		Users:        stubUsers{live: h.userID},
		GatewayToken: testGatewayToken,
	})

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return &process{
		server: server, orch: orch, turns: turnStore, chat: chatStore,
		provider: provider, finished: finished,
		recovery: runtime.NewRecovery(turnStore, turnStore, buses),
	}
}

func (p *process) await(t *testing.T) string {
	t.Helper()
	select {
	case status := <-p.finished:
		return status
	case <-time.After(10 * time.Second):
		t.Fatal("turn never reached a terminal status")
		return ""
	}
}

// do issues an authenticated request, exactly as the BFF would.
func (h *harness) do(t *testing.T, p *process, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = strings.NewReader(string(b))
	}
	req, err := http.NewRequest(method, p.server.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", h.userID.String())
	req.Header.Set("Content-Type", "application/json")

	res, err := p.server.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func decode[T any](t *testing.T, res *http.Response, wantStatus int) T {
	t.Helper()
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != wantStatus {
		t.Fatalf("status %d, want %d (body %s)", res.StatusCode, wantStatus, body)
	}
	var out T
	if len(body) > 0 {
		if err := json.Unmarshal(body, &out); err != nil {
			t.Fatalf("decode %s: %v", body, err)
		}
	}
	return out
}

// createSession and createTurn are the two calls every test starts with.
func (h *harness) createSession(t *testing.T, p *process) string {
	t.Helper()
	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions", map[string]any{
		"title": "Test", "kb_ids": []string{h.kbID.String()}, "model_hint": "",
	})
	out := decode[map[string]any](t, res, http.StatusCreated)
	return out["id"].(string)
}

func (h *harness) createTurn(t *testing.T, p *process, sessionID, message string) string {
	t.Helper()
	res := h.do(t, p, http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": message})
	out := decode[map[string]any](t, res, http.StatusAccepted)
	return out["turn_id"].(string)
}

// ---- SSE client -------------------------------------------------------------

// frame is one parsed SSE frame.
type frame struct {
	ID    int64
	Event string
	Data  runtime.Event
}

// readStream opens the event stream and returns frames until it ends, the
// deadline passes, or stopAfter frames have been read (0 = no limit).
//
// It is a real HTTP client against a real server, not a recorder: the
// properties under test — flushing, ordering, resume — only exist on a live
// connection.
func (h *harness) readStream(
	t *testing.T, p *process, turnID string, afterSeq int64, lastEventID string, stopAfter int,
) []frame {
	t.Helper()

	url := p.server.URL + "/v1/turns/" + turnID + "/events"
	if afterSeq > 0 {
		url += "?after_seq=" + itoa(afterSeq)
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatalf("build stream request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", h.userID.String())
	req.Header.Set("Accept", "text/event-stream")
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	res, err := p.server.Client().Do(req.WithContext(ctx))
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("stream status %d (body %s)", res.StatusCode, body)
	}
	if ct := res.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("stream content-type = %q", ct)
	}

	var frames []frame
	var cur frame
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if cur.Event != "" {
				frames = append(frames, cur)
				if stopAfter > 0 && len(frames) >= stopAfter {
					return frames
				}
				if runtime.IsTerminal(cur.Data.Type) {
					return frames
				}
			}
			cur = frame{}
		case strings.HasPrefix(line, ":"):
			// comment: the open marker or a keepalive
		case strings.HasPrefix(line, "id: "):
			cur.ID = parseInt(strings.TrimPrefix(line, "id: "))
		case strings.HasPrefix(line, "event: "):
			cur.Event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &cur.Data); err != nil {
				t.Fatalf("decode frame data: %v", err)
			}
		}
	}
	return frames
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func parseInt(s string) int64 {
	var n int64
	for _, c := range strings.TrimSpace(s) {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

// ---- fakes ------------------------------------------------------------------

// scriptedProvider returns a fixed sequence of responses, one per round, and
// streams the content of each as chunks so the test exercises the real
// delta path rather than a single blob.
type scriptedProvider struct {
	mu        sync.Mutex
	round     int
	responses []*runtime.ChatResponse
	// delay is applied before each response, so a test can open a stream while
	// the turn is still producing.
	delay time.Duration
	// hold, when non-nil, blocks the given round until it is closed.
	hold      map[int]chan struct{}
	requests  []runtime.ChatRequest
	streamAll bool
}

func (p *scriptedProvider) Name() string         { return "scripted" }
func (p *scriptedProvider) DefaultModel() string { return "scripted-1" }

func (p *scriptedProvider) Chat(ctx context.Context, req runtime.ChatRequest) (*runtime.ChatResponse, error) {
	return p.ChatStream(ctx, req, func(runtime.StreamChunk) {})
}

func (p *scriptedProvider) ChatStream(
	ctx context.Context, req runtime.ChatRequest, onChunk func(runtime.StreamChunk),
) (*runtime.ChatResponse, error) {
	p.mu.Lock()
	round := p.round
	p.round++
	p.requests = append(p.requests, req)
	hold := p.hold[round]
	p.mu.Unlock()

	if hold != nil {
		select {
		case <-hold:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if p.delay > 0 {
		select {
		case <-time.After(p.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if round >= len(p.responses) {
		return nil, errNoScript
	}
	resp := p.responses[round]

	// Stream the answer word by word, as a real provider does.
	if resp.Content != "" && len(resp.ToolCalls) == 0 {
		for _, word := range strings.SplitAfter(resp.Content, " ") {
			if word == "" {
				continue
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			default:
			}
			onChunk(runtime.StreamChunk{Content: word})
		}
	}
	return resp, nil
}

func (p *scriptedProvider) sentRequests() []runtime.ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]runtime.ChatRequest, len(p.requests))
	copy(out, p.requests)
	return out
}

type scriptError string

func (e scriptError) Error() string { return string(e) }

const errNoScript = scriptError("scripted provider ran out of responses")

type fakeResolver struct{ provider runtime.ChatProvider }

func (r fakeResolver) ChatFor(context.Context, uuid.UUID, string) (runtime.ChatProvider, error) {
	return r.provider, nil
}

type fakeAuthz struct {
	kbs  map[uuid.UUID]uuid.UUID
	docs map[uuid.UUID]uuid.UUID
}

func newFakeAuthz() *fakeAuthz {
	return &fakeAuthz{kbs: map[uuid.UUID]uuid.UUID{}, docs: map[uuid.UUID]uuid.UUID{}}
}

func (a *fakeAuthz) OwnsKB(_ context.Context, userID, kbID uuid.UUID) (bool, error) {
	owner, ok := a.kbs[kbID]
	return ok && owner == userID, nil
}

func (a *fakeAuthz) OwnsDocument(_ context.Context, userID, docID uuid.UUID) (bool, error) {
	owner, ok := a.docs[docID]
	return ok && owner == userID, nil
}

type fakeRetriever struct {
	mu     sync.Mutex
	calls  int
	chunks []tools.Chunk
}

func (r *fakeRetriever) Search(_ context.Context, _ uuid.UUID, _ []uuid.UUID, _ string, _ int) ([]tools.Chunk, error) {
	r.mu.Lock()
	r.calls++
	r.mu.Unlock()
	return r.chunks, nil
}

type fakeReader struct{}

func (fakeReader) ReadPage(context.Context, uuid.UUID, uuid.UUID, int) (tools.Page, error) {
	return tools.Page{}, tools.ErrNotFound
}

// stubUsers is the identity lookup RequireUser consults.
type stubUsers struct{ live uuid.UUID }

func (s stubUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) {
	return id == s.live, nil
}

func (s stubUsers) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) {
	if id != s.live {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: s.live, Email: "stub@example.test", DisplayName: "Stub"}, nil
}

func (s stubUsers) UpsertIdentity(_ context.Context, c store.IdentityClaims, _ uuid.UUID) (*store.User, error) {
	return &store.User{ID: s.live, Email: c.Email, DisplayName: c.DisplayName}, nil
}
