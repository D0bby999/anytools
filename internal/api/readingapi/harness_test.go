package readingapi_test

import (
	"bufio"
	"bytes"
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
	"github.com/D0bby999/anytools/internal/api/notebookapi"
	"github.com/D0bby999/anytools/internal/api/readingapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/capabilities/reading"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/notebook"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const testGatewayToken = "readingapi-test-token"

// harness is one API process over a real database, wired the way
// internal/app/wire.go wires it — the same mux, the same middleware, the same
// orchestrator — with one substitution: the provider is scripted. Everything
// under test here is HTTP behaviour, and a fake at the HTTP layer would be
// testing the fake.
type harness struct {
	pool     *pgxpool.Pool
	server   *httptest.Server
	blobs    blob.Store
	provider *scriptedProvider
	finished chan string

	alice, bob     uuid.UUID
	aliceDoc       uuid.UUID
	bobDoc         uuid.UUID
	pdfBytes       []byte
	knowledgeStore *pg.KnowledgeStore
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	pool := testutil.TestDB(t)
	ctx := context.Background()

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("blob.NewLocal: %v", err)
	}

	kbStore := pg.NewKnowledgeStore(pool)
	chunkStore := pg.NewChunkStore(pool)
	knowledgeSvc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: chunkStore, Blobs: blobs,
		Jobs: unusedQueue{}, Providers: unconfiguredProviders{},
	})
	authorizer := authz.New(kbStore)

	chatStore := pg.NewChatStore(pool)
	turnStore := pg.NewTurnStore(pool)
	notes := notebook.NewService(pg.NewNotebookStore(pool))

	capabilities := runtime.NewCapabilityRegistry()
	capabilities.Register(reading.New(chatStore))

	provider := &scriptedProvider{delay: 250 * time.Millisecond}
	finished := make(chan string, 8)
	buses := runtime.NewBusRegistry()
	orch := runtime.NewOrchestrator(runtime.OrchestratorDeps{
		Turns: turnStore, Events: turnStore, Capabilities: capabilities,
		Tools: runtime.NewToolRegistry(), Providers: fakeResolver{provider: provider},
		Buses:    buses,
		OnFinish: func(_ uuid.UUID, status string) { finished <- status },
	})

	h := &harness{
		pool: pool, blobs: blobs, provider: provider, finished: finished,
		alice: testutil.NewUser(t, pool), bob: testutil.NewUser(t, pool),
		knowledgeStore: kbStore,
	}

	handler := api.BuildMux(api.Deps{
		// chatapi is mounted because the reading pane streams over ITS event
		// endpoint. One stream endpoint in the product; a reading-specific one
		// would be a second place replay and resume could be subtly wrong.
		Chat:         chatapi.NewHandler(chatStore, turnStore, orch, nil),
		Notebook:     notebookapi.NewHandler(notes),
		Users:        stubUsers{live: map[uuid.UUID]bool{h.alice: true, h.bob: true}},
		GatewayToken: testGatewayToken,
		Reading: readingapi.NewHandler(readingapi.Deps{
			Workspaces: reading.NewWorkspaces(pg.NewReadingStore(pool)),
			Notes:      notes,
			Authz:      authorizer,
			Documents:  knowledgeSvc,
			Blobs:      blobs,
			Sessions:   chatStore,
			Orch:       orch,
			Pages: reading.PageLoader{
				Workspaces: reading.NewWorkspaces(pg.NewReadingStore(pool)),
				Parsed:     harnessParsed{docs: knowledgeSvc, blobs: blobs},
			},
			Providers: fakeResolver{provider: provider},
		}),
	})

	h.server = httptest.NewServer(handler)
	t.Cleanup(h.server.Close)

	// A real body, so the file endpoint is serving bytes rather than an empty
	// 200 that would pass an assertion about status alone.
	h.pdfBytes = []byte("%PDF-1.7\n% a seeded document\n%%EOF\n")
	h.aliceDoc = h.seedDocument(t, ctx, h.alice, "Chemistry.pdf", "application/pdf", h.pdfBytes)
	h.bobDoc = h.seedDocument(t, ctx, h.bob, "Bob's book.pdf", "application/pdf", []byte("%PDF-1.7\nbob\n%%EOF\n"))
	return h
}

// seedDocument writes the original bytes to the blob store and inserts the row
// that points at them, which is what an upload leaves behind.
func (h *harness) seedDocument(
	t *testing.T, ctx context.Context, userID uuid.UUID, title, mime string, data []byte,
) uuid.UUID {
	t.Helper()
	kb, err := h.knowledgeStore.CreateKB(ctx, userID, "Reading")
	if err != nil {
		t.Fatalf("CreateKB: %v", err)
	}
	digest, err := h.blobs.PutOriginal(ctx, userID, data)
	if err != nil {
		t.Fatalf("PutOriginal: %v", err)
	}
	doc, err := h.knowledgeStore.CreateDocument(ctx, knowledge.Document{
		UserID: userID, KBID: kb.ID, SourceKind: knowledge.SourceUpload,
		Title: title, MIME: mime, Bytes: int64(len(data)), SHA256: digest, PageCount: 20,
	})
	if err != nil {
		t.Fatalf("CreateDocument: %v", err)
	}
	return doc.ID
}

// do issues an authenticated request, exactly as the BFF would.
func (h *harness) do(t *testing.T, userID uuid.UUID, method, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", userID.String())
	req.Header.Set("Content-Type", "application/json")

	res, err := h.server.Client().Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
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

func status(t *testing.T, res *http.Response) int {
	t.Helper()
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

func (h *harness) await(t *testing.T) string {
	t.Helper()
	select {
	case s := <-h.finished:
		return s
	case <-time.After(10 * time.Second):
		t.Fatal("turn never reached a terminal status")
		return ""
	}
}

// openWorkspace is the call every test starts with.
func (h *harness) openWorkspace(t *testing.T, userID, docID uuid.UUID) reading.Workspace {
	t.Helper()
	res := h.do(t, userID, http.MethodPost, "/v1/reading/workspaces",
		map[string]any{"document_id": docID.String()})
	return decode[reading.Workspace](t, res, http.StatusOK)
}

// ---- SSE client -------------------------------------------------------------

type frame struct {
	Event string
	Data  runtime.Event
}

// readStream opens the turn's event stream and returns frames until it ends.
func (h *harness) readStream(t *testing.T, userID uuid.UUID, turnID string) []frame {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, h.server.URL+"/v1/turns/"+turnID+"/events", nil)
	if err != nil {
		t.Fatalf("build stream request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testGatewayToken)
	req.Header.Set("X-AnyTools-User-Id", userID.String())
	req.Header.Set("Accept", "text/event-stream")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	res, err := h.server.Client().Do(req.WithContext(ctx))
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("stream status %d (body %s)", res.StatusCode, body)
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
				if runtime.IsTerminal(cur.Data.Type) {
					return frames
				}
			}
			cur = frame{}
		case strings.HasPrefix(line, ":"):
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

// answerOf returns the `result` event's content.
func answerOf(frames []frame) string {
	for _, f := range frames {
		if f.Data.Type == runtime.EvResult {
			return f.Data.Content
		}
	}
	return ""
}

// ---- fakes ------------------------------------------------------------------

// scriptedProvider streams a canned answer word by word.
//
// `delay` is not decoration. Without it the turn finishes before the test's
// POST has even returned, so the stream attaches to a turn that is already over
// and is served from the PERSISTED log — which the event sink has not
// necessarily flushed yet, because the flush happens after the terminal row is
// written. The test then asserts "nothing streamed" about a system that streams
// perfectly well (measured: one synthesized `done` frame at seq 1 and nothing
// else). A delay wider than the round trip puts the LIVE path under test, which
// is the path a real provider takes.
type scriptedProvider struct {
	mu       sync.Mutex
	answer   string
	delay    time.Duration
	requests []runtime.ChatRequest
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
	p.requests = append(p.requests, req)
	answer := p.answer
	delay := p.delay
	p.mu.Unlock()

	if delay > 0 {
		select {
		case <-time.After(delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	if answer == "" {
		answer = "Equilibrium means the system opposes the change imposed on it."
	}
	for _, word := range strings.SplitAfter(answer, " ") {
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
	return &runtime.ChatResponse{Content: answer, FinishReason: "stop"}, nil
}

func (p *scriptedProvider) sent() []runtime.ChatRequest {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]runtime.ChatRequest, len(p.requests))
	copy(out, p.requests)
	return out
}

// harnessParsed is internal/app's parsedMarkdown: the document row read with
// the caller's user_id, then the parse it records.
type harnessParsed struct {
	docs  *knowledge.Service
	blobs blob.Store
}

func (p harnessParsed) ParsedMarkdown(ctx context.Context, userID, docID uuid.UUID) (string, error) {
	doc, err := p.docs.GetDocument(ctx, userID, docID)
	if err != nil {
		return "", err
	}
	if doc.ParsedMarkdownPath == "" {
		return "", reading.ErrNoText
	}
	return p.blobs.GetParsed(ctx, doc.ParsedMarkdownPath)
}

// seedParse stores a parse for a document, as the ingest job leaves it.
func (h *harness) seedParse(t *testing.T, userID, docID uuid.UUID, markdown string) {
	t.Helper()
	ctx := context.Background()
	path, err := h.blobs.PutParsed(ctx, userID, docID, 1, markdown)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.pool.Exec(ctx,
		`UPDATE documents SET parsed_markdown_path = $1 WHERE id = $2 AND user_id = $3`,
		path, docID, userID); err != nil {
		t.Fatal(err)
	}
}

type fakeResolver struct{ provider runtime.ChatProvider }

func (r fakeResolver) ChatFor(_ context.Context, _ uuid.UUID, fn string) (runtime.ChatProvider, error) {
	if fn != reading.Name {
		return nil, runtime.ErrNoProvider
	}
	return r.provider, nil
}

// unusedQueue stands in for the job queue. Nothing in these tests enqueues, and
// a nil would panic rather than say so.
type unusedQueue struct{}

func (unusedQueue) Enqueue(context.Context, uuid.UUID, string, any, int) (uuid.UUID, error) {
	return uuid.Nil, errUnusedQueue
}

type constError string

func (e constError) Error() string { return string(e) }

const errUnusedQueue = constError("readingapi tests do not enqueue jobs")

type unconfiguredProviders struct{}

func (unconfiguredProviders) ParserChain(context.Context, knowledge.UserID) ([]knowledge.Parser, error) {
	return nil, nil
}

func (unconfiguredProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	return nil, errUnusedQueue
}

type stubUsers struct{ live map[uuid.UUID]bool }

func (s stubUsers) UserExists(_ context.Context, id uuid.UUID) (bool, error) {
	return s.live[id], nil
}

func (s stubUsers) GetUser(_ context.Context, id uuid.UUID) (*store.User, error) {
	if !s.live[id] {
		return nil, store.ErrUserNotFound
	}
	return &store.User{ID: id, Email: id.String() + "@example.test", DisplayName: "Stub"}, nil
}

func (s stubUsers) UpsertIdentity(_ context.Context, c store.IdentityClaims, _ uuid.UUID) (*store.User, error) {
	return &store.User{Email: c.Email, DisplayName: c.DisplayName}, nil
}
