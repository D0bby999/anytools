package kbapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// ─────────────────────────────────────────────────────────────── the harness

type env struct {
	t         *testing.T
	pool      *pgxpool.Pool
	handler   http.Handler
	svc       *knowledge.Service
	worker    *jobs.Worker
	providers *replayProviders
	alice     uuid.UUID
	bob       uuid.UUID
}

const gatewayToken = "test-gateway-token"

// newEnv wires the REAL stack — real stores, real queue, real blob directory,
// real mux with RequireUser in front of it — and stands in only for the two
// things phase 4 owns: the Parser and the Embedder. That is the point: this
// test is the phase's end-to-end claim, and a handler tested against mocked
// stores would not have exercised the SQL that carries the isolation.
func newEnv(t *testing.T) *env {
	t.Helper()
	pool := testutil.TestDB(t)
	ctx := context.Background()

	e := &env{t: t, pool: pool}
	e.alice = makeUser(t, pool, "alice")
	e.bob = makeUser(t, pool, "bob")

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("blob store: %v", err)
	}

	kbStore := pg.NewKnowledgeStore(pool)
	chunkStore := pg.NewChunkStore(pool)
	queue := jobs.NewQueue(pool, time.Minute)
	providers := &replayProviders{parser: newReplayParser(t, "rag"), embedder: newHashEmbedder(768)}
	e.providers = providers

	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: chunkStore, Blobs: blobs, Jobs: queue,
		Providers: providers, Events: knowledge.NewEvents(),
	})

	e.svc = svc
	e.handler = api.BuildMux(api.Deps{
		Knowledge:    kbapi.NewHandler(svc, authz.New(kbStore), retrieve.New(pool), providers),
		Users:        userLookup{pool},
		GatewayToken: gatewayToken,
	})

	e.worker = jobs.NewWorker(queue, "test-worker-"+uuid.NewString()[:8], time.Millisecond)
	e.worker.Handle(jobs.KindParseDocument, func(ctx context.Context, job *jobs.Job) error {
		var payload knowledge.ParseJobPayload
		if err := json.Unmarshal(job.Payload, &payload); err != nil {
			return jobs.Terminal(err)
		}
		err := svc.ProcessDocument(ctx, job.UserID, payload,
			knowledge.Attempt{Number: job.Attempts, Max: job.MaxAttempts})
		if knowledge.IsTerminal(err) {
			return jobs.Terminal(err)
		}
		return err
	})
	_ = ctx
	return e
}

// drainJobs runs queued work to completion, the way the background worker would.
func (e *env) drainJobs() {
	e.t.Helper()
	for i := 0; i < 20; i++ {
		ran, err := e.worker.RunOnce(context.Background())
		if err != nil {
			e.t.Fatalf("worker: %v", err)
		}
		if !ran {
			return
		}
	}
	e.t.Fatal("job queue did not drain")
}

// do issues a request through the real mux, with the two credentials the trust
// boundary requires.
func (e *env) do(user uuid.UUID, method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	if user != uuid.Nil {
		req.Header.Set(httpx.UserIDHeader, user.String())
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func (e *env) upload(user uuid.UUID, kbID uuid.UUID, filename string, data []byte) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		e.t.Fatalf("form file: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		e.t.Fatalf("write part: %v", err)
	}
	if err := w.Close(); err != nil {
		e.t.Fatalf("close writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/kb/"+kbID.String()+"/documents", &buf)
	req.Header.Set("Authorization", "Bearer "+gatewayToken)
	req.Header.Set(httpx.UserIDHeader, user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func (e *env) createKB(user uuid.UUID, name string) uuid.UUID {
	e.t.Helper()
	rec := e.do(user, http.MethodPost, "/v1/kb", map[string]string{"name": name})
	if rec.Code != http.StatusCreated {
		e.t.Fatalf("create kb: %d %s", rec.Code, rec.Body.String())
	}
	var kb struct {
		ID uuid.UUID `json:"id"`
	}
	decode(e.t, rec, &kb)
	return kb.ID
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, v any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
}

func makeUser(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
		"kbapi-"+uuid.NewString()+"@example.test", label).Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

type userLookup struct{ pool *pgxpool.Pool }

func (u userLookup) UserExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var exists bool
	err := u.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)`, id).Scan(&exists)
	return exists, err
}

// ─────────────────────────────────────────────────────── the phase-4 stand-ins

type replayProviders struct {
	parser   knowledge.Parser
	embedder knowledge.Embedder
}

func (p *replayProviders) ParserChain(context.Context, knowledge.UserID) ([]knowledge.Parser, error) {
	return []knowledge.Parser{p.parser}, nil
}

func (p *replayProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	return p.embedder, nil
}

// replayParser serves the Markdown Spike B actually got back from Gemini for
// this PDF, sliced to whatever window the batcher asks for. The text the
// retrieval assertions below search for is therefore real text from a real
// model reading a real paper.
type replayParser struct {
	pages map[int]string
	mu    sync.Mutex
}

func newReplayParser(t *testing.T, stem string) *replayParser {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "rag", "parse", "testdata", "recorded", stem+".gemini.md"))
	if err != nil {
		t.Fatalf("read recording: %v", err)
	}
	_, bodies, nums := parse.SplitAtMarkers(string(raw))
	pages := map[int]string{}
	for i, n := range nums {
		if i < len(bodies) {
			pages[n] = bodies[i]
		}
	}
	return &replayParser{pages: pages}
}

func (p *replayParser) ProviderName() string { return "gemini" }

func (p *replayParser) ParsePages(_ context.Context, req parse.PageRequest) (parse.PageResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	var sb strings.Builder
	for n := req.Start; n <= req.End; n++ {
		sb.WriteString(parse.Marker(n))
		sb.WriteString("\n")
		sb.WriteString(p.pages[n])
		sb.WriteString("\n\n")
	}
	return parse.PageResult{
		Markdown: sb.String(), Finish: parse.PageFinishStop, Model: "gemini-3.6-flash",
	}, nil
}

type hashEmbedder struct {
	dims  int
	mu    sync.Mutex
	tasks []knowledge.EmbedTask
}

func newHashEmbedder(dims int) *hashEmbedder { return &hashEmbedder{dims: dims} }

func (h *hashEmbedder) Model() string        { return "test-embed-001" }
func (h *hashEmbedder) ProviderName() string { return "fake" }

func (h *hashEmbedder) Embed(_ context.Context, texts []string, task knowledge.EmbedTask) ([][]float32, int, error) {
	h.mu.Lock()
	h.tasks = append(h.tasks, task)
	h.mu.Unlock()
	out := make([][]float32, len(texts))
	for i, text := range texts {
		v := make([]float32, h.dims)
		fn := fnv.New64a()
		for _, word := range strings.Fields(strings.ToLower(text)) {
			fn.Reset()
			_, _ = fn.Write([]byte(word))
			v[fn.Sum64()%uint64(h.dims)] += 1
		}
		var norm float32
		for _, x := range v {
			norm += x * x
		}
		if norm > 0 {
			inv := 1 / sqrt32(norm)
			for j := range v {
				v[j] *= inv
			}
		} else {
			v[0] = 1
		}
		out[i] = v
	}
	return out, h.dims, nil
}

func (h *hashEmbedder) tasksUsed() []knowledge.EmbedTask {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]knowledge.EmbedTask(nil), h.tasks...)
}

func sqrt32(x float32) float32 {
	z := x
	for i := 0; i < 24; i++ {
		z = (z + x/z) / 2
	}
	return z
}

func ragPDF(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "rag", "parse", "testdata", "rag.pdf"))
	if err != nil {
		t.Fatalf("read rag.pdf: %v", err)
	}
	return b
}

// ───────────────────────────────────────────────────────────── the AC1 path

type documentJSON struct {
	ID         uuid.UUID       `json:"id"`
	KBID       uuid.UUID       `json:"kb_id"`
	Title      string          `json:"title"`
	Status     string          `json:"status"`
	Error      string          `json:"error"`
	PageCount  int             `json:"page_count"`
	ChunkCount int             `json:"chunk_count"`
	Processed  json.RawMessage `json:"processed_by"`
}

// TestUploadToCitationEndToEnd is the phase's acceptance path, through HTTP:
// upload a PDF, wait for it to be ready, ask the debug query a question, and
// open the viewer at the page the citation names — then check the quoted text
// really is on that page.
//
// That last step is AC1 ("a citation that opens the page containing the quoted
// text"), and it is the reason none of the cheaper versions of this test would
// do: everything up to the page number can be right while the page number
// itself is off by one.
func TestUploadToCitationEndToEnd(t *testing.T) {
	e := newEnv(t)
	kbID := e.createKB(e.alice, "Retrieval papers")

	// ── upload ────────────────────────────────────────────────────────────
	rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	var accepted struct {
		Document documentJSON `json:"document"`
		JobID    uuid.UUID    `json:"job_id"`
	}
	decode(t, rec, &accepted)
	if accepted.Document.Status != "queued" {
		t.Fatalf("status after upload = %q, want queued", accepted.Document.Status)
	}
	if accepted.Document.PageCount != 19 {
		t.Fatalf("page count = %d, want 19 — counted at upload so the cap is enforceable",
			accepted.Document.PageCount)
	}
	if accepted.JobID == uuid.Nil {
		t.Fatal("upload must return the job that will process the document")
	}

	// ── process ───────────────────────────────────────────────────────────
	e.drainJobs()

	rec = e.do(e.alice, http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list documents: %d %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q; a cached status list shows 'parsing' after it is ready", cc)
	}
	var listing struct {
		Documents []documentJSON `json:"documents"`
	}
	decode(t, rec, &listing)
	if len(listing.Documents) != 1 {
		t.Fatalf("got %d documents", len(listing.Documents))
	}
	doc := listing.Documents[0]
	if doc.Status != "ready" {
		t.Fatalf("status = %q (%s), want ready", doc.Status, doc.Error)
	}
	if doc.ChunkCount < 20 {
		t.Fatalf("chunk count = %d, want a real chunking", doc.ChunkCount)
	}
	if !strings.Contains(string(doc.Processed), "gemini") {
		t.Fatalf("processed_by = %s, want the lane that read it", doc.Processed)
	}

	// ── query ─────────────────────────────────────────────────────────────
	// A phrase that really is in the paper. The query goes through the same
	// hybrid RRF statement a chat answer will use.
	rec = e.do(e.alice, http.MethodPost, "/v1/kb/"+kbID.String()+"/query",
		map[string]any{"query": "retrieval augmented generation parametric memory"})
	if rec.Code != http.StatusOK {
		t.Fatalf("query: %d %s", rec.Code, rec.Body.String())
	}
	var results struct {
		Hits []struct {
			DocumentID uuid.UUID `json:"document_id"`
			Title      string    `json:"title"`
			PageStart  int       `json:"page_start"`
			PageEnd    int       `json:"page_end"`
			Text       string    `json:"text"`
			FromText   bool      `json:"from_text"`
			FromVector bool      `json:"from_vector"`
		} `json:"hits"`
	}
	decode(t, rec, &results)
	if len(results.Hits) == 0 {
		t.Fatal("the debug query returned nothing from a document that is ready")
	}

	// The question was embedded as a QUERY and the corpus as DOCUMENTS. Phase
	// 4's embed package is explicit that mixing these measurably degrades
	// retrieval, and it degrades it silently — every call still succeeds.
	embedder := e.providers.embedder.(*hashEmbedder)
	tasks := embedder.tasksUsed()
	if len(tasks) < 2 {
		t.Fatalf("expected both indexing and query embeds, got %v", tasks)
	}
	if tasks[len(tasks)-1] != knowledge.EmbedQuery {
		t.Fatalf("the question was embedded as %q, want %q", tasks[len(tasks)-1], knowledge.EmbedQuery)
	}
	for _, task := range tasks[:len(tasks)-1] {
		if task != knowledge.EmbedDocument {
			t.Fatalf("an indexing call used task %q, want %q", task, knowledge.EmbedDocument)
		}
	}

	hit := results.Hits[0]
	if hit.DocumentID != doc.ID {
		t.Fatalf("hit names document %s, want %s", hit.DocumentID, doc.ID)
	}
	if hit.Title != "rag.pdf" {
		t.Fatalf("hit title = %q — a citation needs the document's name", hit.Title)
	}
	if hit.PageStart < 1 || hit.PageEnd > 19 {
		t.Fatalf("hit claims pages %d-%d in a 19-page document", hit.PageStart, hit.PageEnd)
	}
	if !hit.FromText && !hit.FromVector {
		t.Fatal("a hit must say which arm found it")
	}

	// ── open the viewer at the cited page ─────────────────────────────────
	rec = e.do(e.alice, http.MethodGet,
		fmt.Sprintf("/v1/documents/%s/content?page=%d", doc.ID, hit.PageStart), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("document content: %d %s", rec.Code, rec.Body.String())
	}
	var content struct {
		Document documentJSON `json:"document"`
		Pages    []struct {
			Page     int    `json:"page"`
			Markdown string `json:"markdown"`
		} `json:"pages"`
	}
	decode(t, rec, &content)
	if len(content.Pages) != 1 || content.Pages[0].Page != hit.PageStart {
		t.Fatalf("?page=%d returned %+v", hit.PageStart, content.Pages)
	}

	// AC1, asserted: the quoted passage really is on the page the citation
	// named. Compared on letters only, because the chunker's text has been
	// re-rendered by the Markdown splitter and differs from the page body in
	// whitespace and heading prefixes.
	quote := sampleQuote(hit.Text)
	if quote == "" {
		t.Fatalf("hit text too short to verify: %.80q", hit.Text)
	}
	if !strings.Contains(lettersOnly(content.Pages[0].Markdown), lettersOnly(quote)) {
		t.Fatalf("the citation points at page %d, but the quoted text is not on it.\nquote: %.160q",
			hit.PageStart, quote)
	}

	// The whole document also comes back, which is what the viewer route loads.
	rec = e.do(e.alice, http.MethodGet, "/v1/documents/"+doc.ID.String()+"/content", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("full content: %d", rec.Code)
	}
	decode(t, rec, &content)
	if len(content.Pages) != 19 {
		t.Fatalf("full document has %d pages, want 19", len(content.Pages))
	}
	for i, p := range content.Pages {
		if p.Page != i+1 {
			t.Fatalf("page %d is numbered %d", i, p.Page)
		}
	}
}

// ─────────────────────────────────────────────────────────────── isolation

// Red-team RT-3, at the HTTP layer: user B must not reach user A's knowledge
// base, document, chunks or parsed content through ANY handler, and every
// refusal must be a 404 — indistinguishable from a resource that never existed.
func TestUserBCannotReachUserAsKnowledgeThroughAnyHandler(t *testing.T) {
	e := newEnv(t)
	kbID := e.createKB(e.alice, "Alice's private research")

	rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	e.drainJobs()

	rec = e.do(e.alice, http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil)
	var listing struct {
		Documents []documentJSON `json:"documents"`
	}
	decode(t, rec, &listing)
	if len(listing.Documents) != 1 || listing.Documents[0].Status != "ready" {
		t.Fatalf("alice's document is not ready: %+v", listing.Documents)
	}
	docID := listing.Documents[0].ID

	// Bob has his own knowledge base, so "he owns something" is not what is
	// being tested — naming Alice's id is.
	bobKB := e.createKB(e.bob, "Bob's own")

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"get kb", http.MethodGet, "/v1/kb/" + kbID.String(), nil},
		{"delete kb", http.MethodDelete, "/v1/kb/" + kbID.String(), nil},
		{"list documents", http.MethodGet, "/v1/kb/" + kbID.String() + "/documents", nil},
		{"upload into it", http.MethodPost, "/v1/kb/" + kbID.String() + "/documents", nil},
		{"delete document", http.MethodDelete,
			"/v1/kb/" + kbID.String() + "/documents/" + docID.String(), nil},
		{"delete document via his own kb", http.MethodDelete,
			"/v1/kb/" + bobKB.String() + "/documents/" + docID.String(), nil},
		{"reindex", http.MethodPost, "/v1/kb/" + kbID.String() + "/reindex", map[string]any{}},
		{"query", http.MethodPost, "/v1/kb/" + kbID.String() + "/query",
			map[string]any{"query": "what is in alice's document"}},
		{"document content", http.MethodGet, "/v1/documents/" + docID.String() + "/content", nil},
		{"document page", http.MethodGet, "/v1/documents/" + docID.String() + "/content?page=1", nil},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var rec *httptest.ResponseRecorder
			if tc.name == "upload into it" {
				rec = e.upload(e.bob, kbID, "smuggled.pdf", ragPDF(t))
			} else {
				rec = e.do(e.bob, tc.method, tc.path, tc.body)
			}
			if rec.Code != http.StatusNotFound {
				t.Fatalf("bob got %d %s — he must not reach alice's resources",
					rec.Code, rec.Body.String())
			}
			if strings.Contains(strings.ToLower(rec.Body.String()), "forbidden") {
				t.Fatalf("the body distinguishes forbidden from missing: %s", rec.Body.String())
			}
		})
	}

	// And a uuid that never existed answers identically, so the endpoint is not
	// an oracle for which ids are real.
	ghost := e.do(e.bob, http.MethodGet, "/v1/kb/"+uuid.NewString(), nil)
	real := e.do(e.bob, http.MethodGet, "/v1/kb/"+kbID.String(), nil)
	if ghost.Code != real.Code || ghost.Body.String() != real.Body.String() {
		t.Fatalf("a missing kb (%d %s) and an unowned one (%d %s) answer differently",
			ghost.Code, ghost.Body.String(), real.Code, real.Body.String())
	}

	// Bob's own list must not mention Alice's knowledge base.
	rec = e.do(e.bob, http.MethodGet, "/v1/kb", nil)
	if strings.Contains(rec.Body.String(), kbID.String()) {
		t.Fatalf("alice's kb id leaked into bob's list: %s", rec.Body.String())
	}

	// Alice's document survived every one of bob's attempts.
	rec = e.do(e.alice, http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil)
	decode(t, rec, &listing)
	if len(listing.Documents) != 1 {
		t.Fatalf("alice now has %d documents", len(listing.Documents))
	}
}

// ──────────────────────────────────────────────────────── upload validation

func TestUploadRejectsWhatItMust(t *testing.T) {
	e := newEnv(t)
	kbID := e.createKB(e.alice, "Validation")

	t.Run("unsupported type", func(t *testing.T) {
		rec := e.upload(e.alice, kbID, "payload.exe", []byte("MZ\x90\x00binary"))
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("got %d %s, want 415", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), ".pdf") {
			t.Fatalf("the refusal should list what IS accepted: %s", rec.Body.String())
		}
	})

	t.Run("extension lies about content", func(t *testing.T) {
		rec := e.upload(e.alice, kbID, "notreally.pdf", []byte("PK\x03\x04 this is a zip"))
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("got %d %s, want 415", rec.Code, rec.Body.String())
		}
	})

	t.Run("duplicate", func(t *testing.T) {
		if rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t)); rec.Code != http.StatusAccepted {
			t.Fatalf("first upload: %d %s", rec.Code, rec.Body.String())
		}
		rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t))
		if rec.Code != http.StatusConflict {
			t.Fatalf("got %d %s, want 409 for the same file twice", rec.Code, rec.Body.String())
		}
	})

	t.Run("no file part", func(t *testing.T) {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		_ = w.WriteField("notafile", "x")
		_ = w.Close()
		req := httptest.NewRequest(http.MethodPost, "/v1/kb/"+kbID.String()+"/documents", &buf)
		req.Header.Set("Authorization", "Bearer "+gatewayToken)
		req.Header.Set(httpx.UserIDHeader, e.alice.String())
		req.Header.Set("Content-Type", w.FormDataContentType())
		rec := httptest.NewRecorder()
		e.handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("got %d, want 400", rec.Code)
		}
	})
}

// ───────────────────────────────────────────────── the needs_reembed block

// Changing the embed route must BLOCK queries until a reindex, because ranking
// a new question against vectors from a different embedding space does not
// fail — it returns plausible, wrong answers.
func TestQueryIsBlockedUntilReindexAfterTheRouteChanges(t *testing.T) {
	e := newEnv(t)
	kbID := e.createKB(e.alice, "Route change")

	if rec := e.upload(e.alice, kbID, "rag.pdf", ragPDF(t)); rec.Code != http.StatusAccepted {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
	}
	e.drainJobs()

	// Queries work while the route is the one the KB was indexed with.
	rec := e.do(e.alice, http.MethodPost, "/v1/kb/"+kbID.String()+"/query",
		map[string]any{"query": "retrieval"})
	if rec.Code != http.StatusOK {
		t.Fatalf("query before the change: %d %s", rec.Code, rec.Body.String())
	}

	// The user switches embedding model.
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE knowledge_bases SET needs_reembed = true WHERE id = $1 AND user_id = $2`,
		kbID, e.alice); err != nil {
		t.Fatalf("set needs_reembed: %v", err)
	}

	rec = e.do(e.alice, http.MethodPost, "/v1/kb/"+kbID.String()+"/query",
		map[string]any{"query": "retrieval"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("got %d %s, want 409 while a reindex is outstanding", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "needs_reembed") {
		t.Fatalf("the code must be machine-readable: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Reindex") {
		t.Fatalf("the message must say what to do: %s", rec.Body.String())
	}

	// Reindexing lifts it.
	if rec := e.do(e.alice, http.MethodPost, "/v1/kb/"+kbID.String()+"/reindex", map[string]any{}); rec.Code != http.StatusAccepted {
		t.Fatalf("reindex: %d %s", rec.Code, rec.Body.String())
	}
}

// ───────────────────────────────────────────────────────── route plumbing

// Every route this package registers must be declared in
// api.RegisteredPatterns, which is what the mux allowlist test walks. A route
// that is not enumerated is exactly the route that ships unauthenticated.
func TestEveryPatternIsDeclared(t *testing.T) {
	declared := map[string]bool{}
	for _, p := range api.RegisteredPatterns() {
		declared[p] = true
	}
	for _, p := range kbapi.Patterns() {
		if !declared[p] {
			t.Fatalf("%q is registered by kbapi but missing from api.RegisteredPatterns()", p)
		}
	}
}

func TestKnowledgeRoutesRequireAuthentication(t *testing.T) {
	e := newEnv(t)
	kbID := e.createKB(e.alice, "Auth")

	for _, path := range []string{"/v1/kb", "/v1/kb/" + kbID.String()} {
		t.Run(path, func(t *testing.T) {
			// No user header at all.
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set("Authorization", "Bearer "+gatewayToken)
			rec := httptest.NewRecorder()
			e.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("without a user id: %d, want 401", rec.Code)
			}

			// No gateway bearer.
			req = httptest.NewRequest(http.MethodGet, path, nil)
			req.Header.Set(httpx.UserIDHeader, e.alice.String())
			rec = httptest.NewRecorder()
			e.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("without the gateway token: %d, want 401", rec.Code)
			}
		})
	}
}

// ─────────────────────────────────────────────────────────────── helpers

// sampleQuote picks a distinctive run of prose out of a chunk: long enough to
// be unique in the document, and not a heading the splitter prefixed.
func sampleQuote(text string) string {
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, "|") || len(line) < 90 {
			continue
		}
		if len(line) > 200 {
			line = line[:200]
		}
		return line
	}
	return ""
}

func lettersOnly(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
