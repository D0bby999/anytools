package app

// grounded_chat_e2e_test.go — AC1, end to end, through the wiring.
//
// Upload a real PDF → wait for it to be indexed → ask a question in a chat
// session that names the knowledge base → read the streamed answer off the SSE
// endpoint → take the `sources` frame's chip and open `documents/:id?page=N` →
// check the quoted text really is on that page.
//
// Every seam the wiring commit created is on that path and none of them is
// stubbed: the knowledge-base authorizer (without it the session is refused
// outright), `rag_search` over internal/rag/retrieve, the chat chain over
// internal/byok, and the turn row's record of which provider served it.
//
// Two things are fakes, and both are fakes of somebody ELSE's server:
//
//   - the model is an httptest server speaking the OpenAI wire format. It runs
//     through the real byok chain, the real provider client and the real DTO
//     conversions, so "fake model" here means a scripted upstream, not a
//     scripted ChatProvider;
//   - the parser and embedder are phase 5's own test doubles (a replay of what
//     Gemini really returned for this PDF, and a hashing embedder), for the
//     same reason internal/api/kbapi uses them: a real one would need a key.
//
// The browser's leg of the path — /app/api/stream/kb/:id and
// /app/api/stream/turns/:id — is the RR7 proxy, which is Node. It is covered by
// ui/web/app/test/stream-proxy.test.ts, which asserts the same two upstream
// URLs this test calls directly.

import (
	"bufio"
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
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/api/visualizeapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/capabilities/visualize"
	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/rag/parse"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const e2eToken = "app-e2e-token"

type e2e struct {
	t      *testing.T
	pool   *pgxpool.Pool
	server *httptest.Server
	worker *jobs.Worker
	user   uuid.UUID
	model  *fakeModel
	// blobRoot is the data directory; tmp/ under it is where a transcription
	// job's audio lives while the job runs (up-methods phase 21).
	blobRoot string
}

func newE2E(t *testing.T) *e2e {
	t.Helper()
	model := newFakeModel(t)
	e := buildE2E(t, model.server.URL, []string{"chat"}, nil)
	e.model = model
	return e
}

// buildE2E wires the real handlers over a test database, with every routed
// function in fns pointed at the fake upstream at modelURL. clock, when set, is
// the quiz and mastery services' clock.
func buildE2E(t *testing.T, modelURL string, fns []string, clock func() time.Time) *e2e {
	t.Helper()
	return buildE2EWith(t, modelURL, fns, clock, webDeps{})
}

// buildE2EWith is buildE2E with phase 9's network collaborators replaceable;
// the zero webDeps is production's (the user's own search keys, the guarded
// fetch client).
func buildE2EWith(t *testing.T, modelURL string, fns []string, clock func() time.Time, web webDeps) *e2e {
	t.Helper()
	return buildE2EFull(t, modelURL, fns, clock, web, nil)
}

// buildE2EFull is buildE2EWith with phase 4's links turned on when links is
// non-nil: a scripted web and YouTube, the real byok transcription chain, and
// the transcribe_video job on the worker.
func buildE2EFull(t *testing.T, modelURL string, fns []string, clock func() time.Time, web webDeps, links *linkDeps) *e2e {
	t.Helper()
	return buildE2EStorage(t, modelURL, fns, clock, web, links, nil)
}

// e2eFiles is where the e2e keeps learners' files: the server's Local, or a
// router over it (drive-user-storage phase 3 puts a Drive backend behind it).
type e2eFiles interface {
	blob.Store
	blob.ObjectStore
	Root() string
}

// buildE2EStorage is buildE2EFull with the learners' files kept wherever
// files says; nil keeps them on the server's disk.
func buildE2EStorage(t *testing.T, modelURL string, fns []string, clock func() time.Time, web webDeps, links *linkDeps,
	files func(local *blob.Local, pool *pgxpool.Pool) e2eFiles) *e2e {
	t.Helper()
	// The fake model is loopback; BYOK egress refuses that unless an operator
	// opts in. Set before any provider client is constructed.
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	user := testutil.NewUser(t, pool)

	// ── BYOK, routed at the fake model ────────────────────────────────────
	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	tokens, err := oauth.NewService(
		pg.NewOAuthCredentialStore(pool, key), conns, pg.NewConnectionLockStore(pool), nil, nil)
	if err != nil {
		t.Fatalf("oauth.NewService: %v", err)
	}
	byokSvc := byok.NewService(conns, routes, pg.NewSearchConnectionStore(pool, key), tokens)
	byokSvc.SetSleepForTest(func(time.Duration) {})

	ctx := context.Background()
	conn, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai_compat", Kind: store.KindAPIKey,
		Name: "fake", APIBase: modelURL + "/v1", Secret: "key",
	})
	if err != nil {
		t.Fatalf("create connection: %v", err)
	}
	for _, fn := range fns {
		if err := routes.ReplaceRoute(ctx, user, fn,
			[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "fake-1"}}); err != nil {
			t.Fatalf("route %s: %v", fn, err)
		}
	}

	// ── Knowledge, with phase 5's own parse/embed doubles ─────────────────
	local, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatalf("blob store: %v", err)
	}
	var blobs e2eFiles = local
	if files != nil {
		blobs = files(local, pool)
	}
	kbStore := pg.NewKnowledgeStore(pool)
	queue := jobs.NewQueue(pool, time.Minute)
	// As buildKnowledge does: a job that gives up settles what it owned in its
	// final transaction (a video's transcript state, built-in minutes).
	queue.OnGaveUp(reapHandler())
	providers := &replayProviders{
		parser:   newReplayParser(t, "rag"),
		embedder: newHashEmbedder(768),
	}
	var linkCfg *knowledge.LinkConfig
	if links != nil {
		// The engines that hear audio need the database and the queue
		// (up-methods phase 21); the built-in one only when its URL is set.
		links.pool, links.queue = pool, queue
		linkCfg = linkConfig(kbStore, blobs, byokSvc, *links)
	}
	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: pg.NewChunkStore(pool), Blobs: blobs,
		Jobs: queue, Providers: providers, Events: knowledge.NewEvents(),
		Links: linkCfg,
	})
	authorizer := authz.New(kbStore)
	retriever := retrieve.New(pool)

	kb := knowledgeSubsystem{
		handler:   kbapi.NewHandler(svc, authorizer, retriever, providers),
		service:   svc,
		authz:     authorizer,
		retriever: retriever,
		providers: providers,
		blobs:     blobs,
		objects:   blobs, queue: queue, jobHandlers: map[string]jobs.Handler{},
		soloHandlers: map[string]jobs.Handler{},
	}
	if links != nil {
		kb.engines = links.engines
	}

	// ── The wiring under test ─────────────────────────────────────────────
	web = web.withDefaults(byokSvc, pool)
	loopSvc, loopHandler, _ := buildLoop(pool, clock)
	rt := buildChatRuntime(pool, byokSvc, kb, web, nil, loopStates{loopSvc})
	t.Cleanup(rt.stop)

	quizHandler, masteryHandler, _ := buildQuizMastery(pool, kb, newChatResolver(byokSvc), clock, nil)
	solveHandler, researchHandler := buildSolveResearch(pool, rt, kb, web)
	// Learning depth, phase 7: the reading surface and the vocabulary.
	pages := newPageLoader(pool, kb)
	_, readingHandler := buildReadingSurface(pool, readingDeps{
		Notes: newNotebook(pool), Chat: rt.chatStore, Orch: rt.orch, Knowledge: svc,
		Blobs: blobs, Authz: authorizer, Pages: pages, Providers: newChatResolver(byokSvc),
	})

	handler := api.BuildMux(api.Deps{
		Knowledge:    kb.handler,
		Chat:         rt.handler,
		Quiz:         quizHandler,
		Mastery:      masteryHandler,
		Solve:        solveHandler,
		Research:     researchHandler,
		Loop:         loopHandler,
		Visualize:    visualizeapi.NewHandler(visualize.NewService(rt.chatStore, newChatResolver(byokSvc))),
		Audio:        buildAudio(pool, kb, byokSvc),
		Reading:      readingHandler,
		Vocab:        buildVocab(pool, pages),
		Profile:      e2eProfile(pool, byokSvc),
		Books:        buildBooks(pool, kb, byokSvc),
		Exams:        buildExams(pool, kb, newChatResolver(byokSvc)),
		Worksheets:   buildWorksheets(pool, kb).WithDiagnoser(buildWritingDiagnosis(pool, newChatResolver(byokSvc))),
		Zotero:       buildZotero(pool, kb, byokSvc, web.zotero), // up methods, phase 20
		Users:        e2eUsers{pool},
		GatewayToken: e2eToken,
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	worker := jobs.NewWorker(queue, "e2e-"+uuid.NewString()[:8], time.Millisecond)
	worker.Handle(jobs.KindParseDocument, parseDocumentHandler(svc))
	for kind, h := range kb.jobHandlers {
		worker.Handle(kind, h)
	}
	// One worker here runs every kind; production gives each solo kind its own.
	for kind, h := range kb.soloHandlers {
		worker.Handle(kind, h)
	}
	if links != nil {
		worker.Handle(jobs.KindTranscribeVideo, transcribeVideoHandler(svc, queue))
		worker.Handle(jobs.KindTranscribeBuiltin, transcribeBuiltinHandler(svc, queue))
	}

	return &e2e{t: t, pool: pool, server: server, worker: worker, user: user, blobRoot: blobs.Root()}
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

func (e *e2e) do(method, path string, body any) *http.Response {
	e.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			e.t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, e.server.URL+path, reader)
	if err != nil {
		e.t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func (e *e2e) json(method, path string, body any, wantStatus int) map[string]any {
	e.t.Helper()
	res := e.do(method, path, body)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != wantStatus {
		e.t.Fatalf("%s %s: status %d, want %d (%s)", method, path, res.StatusCode, wantStatus, raw)
	}
	var out map[string]any
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			e.t.Fatalf("decode %s: %v", raw, err)
		}
	}
	return out
}

func (e *e2e) upload(kbID uuid.UUID, filename string, data []byte) {
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

	req, err := http.NewRequest(http.MethodPost, e.server.URL+"/v1/kb/"+kbID.String()+"/documents", &buf)
	if err != nil {
		e.t.Fatalf("build upload: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())

	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatalf("upload: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		raw, _ := io.ReadAll(res.Body)
		e.t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
}

func (e *e2e) drainJobs() {
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

// ── the acceptance path ──────────────────────────────────────────────────────

// TestGroundedAnswerOpensThePageItQuoted is AC1 with a fake model.
func TestGroundedAnswerOpensThePageItQuoted(t *testing.T) {
	e := newE2E(t)

	// ── a knowledge base with a real PDF in it ────────────────────────────
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Retrieval papers"}, http.StatusCreated)["id"].(string))

	e.upload(kbID, "rag.pdf", ragFixturePDF(t))
	e.drainJobs()

	docs := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil, http.StatusOK)
	list := docs["documents"].([]any)
	if len(list) != 1 {
		t.Fatalf("got %d documents", len(list))
	}
	doc := list[0].(map[string]any)
	if doc["status"] != "ready" {
		t.Fatalf("document status = %v (%v)", doc["status"], doc["error"])
	}

	// ── a session that names the knowledge base ───────────────────────────
	//
	// This is the line that used to be impossible: with a nil authorizer,
	// chatapi refused every session carrying a kb id with "knowledge bases are
	// not available yet".
	session := e.json(http.MethodPost, "/v1/chat/sessions", map[string]any{
		"title": "AC1", "kb_ids": []string{kbID.String()},
	}, http.StatusCreated)
	sessionID := session["id"].(string)
	if ids := session["kb_ids"].([]any); len(ids) != 1 || ids[0] != kbID.String() {
		t.Fatalf("session kb_ids = %v", session["kb_ids"])
	}

	// ── ask ───────────────────────────────────────────────────────────────
	turn := e.json(http.MethodPost, "/v1/chat/sessions/"+sessionID+"/turns",
		map[string]any{"message": "What does the paper say about parametric memory?"},
		http.StatusAccepted)
	turnID := turn["turn_id"].(string)

	frames := e.readTurnStream(turnID)

	// ── the answer, and the chip ──────────────────────────────────────────
	var sources []citations.Source
	var answer string
	sawContent := false
	for _, f := range frames {
		switch f.event {
		case "content":
			sawContent = true
		case "sources":
			raw, _ := json.Marshal(f.data["metadata"].(map[string]any)["sources"])
			if err := json.Unmarshal(raw, &sources); err != nil {
				t.Fatalf("decode sources: %v", err)
			}
		case "result":
			answer, _ = f.data["content"].(string)
		case "stream_error":
			t.Fatalf("the turn failed: %v", f.data["content"])
		}
	}

	if !sawContent {
		t.Fatal("no content frame — the answer was not streamed, it was delivered in one piece")
	}
	if len(sources) == 0 {
		t.Fatal("no sources frame: the answer cited nothing, so there is no chip to open")
	}
	// The marker survives in the text — that is what the UI splits into a chip —
	// but every marker in it must be one the validator RECOGNISED. A dropped
	// citation is a lie removed, and a turn that drops any here means the model
	// cited something no tool produced.
	chip := sources[0]
	if !strings.Contains(answer, citations.Format(chip.Kind, chip.ID)) {
		t.Fatalf("the answer does not carry the marker the chip renders from: %q", answer)
	}
	if dropped := droppedCount(frames); dropped != 0 {
		t.Fatalf("%d citations were dropped as unverifiable", dropped)
	}

	if chip.DocumentID == "" || chip.Page < 1 {
		t.Fatalf("chip = %+v — a source with no page lands on page one of a 19-page PDF", chip)
	}
	if chip.DocumentID != doc["id"] {
		t.Fatalf("chip names document %s, want the one that was uploaded", chip.DocumentID)
	}

	// ── open it, exactly as `documents/:id?page=N` does ───────────────────
	content := e.json(http.MethodGet,
		fmt.Sprintf("/v1/documents/%s/content?page=%d", chip.DocumentID, chip.Page),
		nil, http.StatusOK)
	pages := content["pages"].([]any)
	if len(pages) != 1 {
		t.Fatalf("the cited page returned %d pages", len(pages))
	}
	page := pages[0].(map[string]any)
	if int(page["page"].(float64)) != chip.Page {
		t.Fatalf("opened page %v, cited page %d", page["page"], chip.Page)
	}

	// AC1 itself: the quoted text is ON that page. Everything above can be
	// right while the page number is off by one, which is the only version of
	// this failure a user ever notices.
	quoted := e.model.quotedText()
	if quoted == "" {
		t.Fatal("the model was never handed a passage to quote")
	}
	markdown := page["markdown"].(string)
	if !containsNormalised(markdown, quoted) {
		t.Fatalf("the cited passage is not on page %d.\npassage: %q\npage: %q",
			chip.Page, truncateForMsg(quoted), truncateForMsg(markdown))
	}

	// ── and the turn row names the lane that served it (AC3) ──────────────
	messages := e.json(http.MethodGet, "/v1/chat/sessions/"+sessionID+"/messages", nil, http.StatusOK)
	turns := messages["turns"].([]any)
	if len(turns) == 0 {
		t.Fatal("no turn rows")
	}
	row := turns[0].(map[string]any)
	if row["status"] != "done" {
		t.Fatalf("turn status = %v (%v)", row["status"], row["error"])
	}
	if row["provider"] != "openai_compat" || row["model"] != "fake-1" {
		t.Fatalf("turn row records provider=%v model=%v — the connection that answered is not recorded",
			row["provider"], row["model"])
	}
}

// A session naming a knowledge base that is not the caller's is still refused,
// now that the authorizer is real. The 404 is the same answer as a KB that does
// not exist, on purpose.
func TestASessionCannotNameAnotherUsersKnowledgeBase(t *testing.T) {
	e := newE2E(t)
	stranger := testutil.NewUser(t, e.pool)

	kbStore := pg.NewKnowledgeStore(e.pool)
	theirs, err := kbStore.CreateKB(context.Background(), stranger, "Not yours")
	if err != nil {
		t.Fatalf("create kb: %v", err)
	}

	res := e.do(http.MethodPost, "/v1/chat/sessions", map[string]any{
		"title": "nope", "kb_ids": []string{theirs.ID.String()},
	})
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", res.StatusCode)
	}
}

// droppedCount reads the validator's own count off the result frame.
func droppedCount(frames []e2eFrame) int {
	for _, f := range frames {
		if f.event != "result" {
			continue
		}
		meta, _ := f.data["metadata"].(map[string]any)
		if n, ok := meta["dropped_citations"].(float64); ok {
			return int(n)
		}
	}
	return 0
}

// ── the turn stream ──────────────────────────────────────────────────────────

type e2eFrame struct {
	event string
	data  map[string]any
}

func (e *e2e) readTurnStream(turnID string) []e2eFrame {
	e.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		e.server.URL+"/v1/turns/"+turnID+"/events", nil)
	if err != nil {
		e.t.Fatalf("build stream request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	req.Header.Set("Accept", "text/event-stream")

	res, err := e.server.Client().Do(req)
	if err != nil {
		e.t.Fatalf("open stream: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		e.t.Fatalf("stream status %d (%s)", res.StatusCode, raw)
	}

	var frames []e2eFrame
	var cur e2eFrame
	scanner := bufio.NewScanner(res.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case line == "":
			if cur.event != "" {
				frames = append(frames, cur)
				if cur.event == "done" || cur.event == "stream_error" {
					return frames
				}
			}
			cur = e2eFrame{}
		case strings.HasPrefix(line, ":"):
		case strings.HasPrefix(line, "event: "):
			cur.event = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &cur.data); err != nil {
				e.t.Fatalf("decode frame: %v", err)
			}
		}
	}
	return frames
}

// ── the fake model ───────────────────────────────────────────────────────────

// fakeModel is an httptest server speaking the OpenAI streaming wire format.
//
// It does what a grounded model does and nothing else: on the first round it
// calls rag_search, and on the second it answers using the passage it was
// handed, citing it with the marker the tool told it to use. It cannot invent a
// citation — it reads the id out of the tool result, exactly as a real model
// must.
type fakeModel struct {
	server *httptest.Server
	mu     sync.Mutex
	quoted string
	rounds int
}

// citeInstruction is how internal/tools tells the model what marker to use.
var citeInstruction = regexp.MustCompile(`Cite this passage as (\[\[cite:chunk:[A-Za-z0-9_.:-]+\]\])`)

// envelopeBody pulls the first quoted passage out of the provenance envelope so
// the test can assert it against the cited page.
var envelopeBody = regexp.MustCompile(`(?s)Cite this passage as \[\[cite:chunk:[A-Za-z0-9_.:-]+\]\]`)

func newFakeModel(t *testing.T) *fakeModel {
	t.Helper()
	m := &fakeModel{}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Tools []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tools"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			t.Errorf("fake model got unparseable request: %v", err)
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}

		m.mu.Lock()
		m.rounds++
		round := m.rounds
		m.mu.Unlock()

		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		if round == 1 {
			// The grounding tool must be on offer, or this product is a chat box.
			if !hasTool(req.Tools, "rag_search") {
				t.Error("rag_search was not mounted for a session with a knowledge base")
			}
			writeSSE(w, flusher, map[string]any{
				"choices": []any{map[string]any{"delta": map[string]any{
					"tool_calls": []any{map[string]any{
						"index": 0, "id": "call-1",
						"function": map[string]any{
							"name":      "rag_search",
							"arguments": `{"query":"parametric memory","limit":4}`,
						},
					}},
				}}},
			})
			writeSSE(w, flusher, map[string]any{
				"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "tool_calls"}},
			})
			fmt.Fprint(w, "data: [DONE]\n\n")
			flusher.Flush()
			return
		}

		// Round two: find the tool result and quote from it.
		var toolText string
		for _, msg := range req.Messages {
			if msg.Role == "tool" {
				toolText = msg.Content
			}
		}
		match := citeInstruction.FindStringSubmatch(toolText)
		if match == nil {
			t.Errorf("the tool result carried no citation instruction: %q", truncateForMsg(toolText))
			http.Error(w, "no passage", http.StatusInternalServerError)
			return
		}
		m.mu.Lock()
		m.quoted = firstSentenceOfPassage(toolText)
		m.mu.Unlock()

		answer := "The paper contrasts parametric memory with retrieved passages. " + match[1]
		for _, word := range strings.SplitAfter(answer, " ") {
			if word == "" {
				continue
			}
			writeSSE(w, flusher, map[string]any{
				"choices": []any{map[string]any{"delta": map[string]any{"content": word}}},
			})
		}
		writeSSE(w, flusher, map[string]any{
			"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "stop"}},
			"usage": map[string]any{
				"prompt_tokens": 900, "completion_tokens": 20, "total_tokens": 920,
			},
		})
		fmt.Fprint(w, "data: [DONE]\n\n")
		flusher.Flush()
	})
	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

func (m *fakeModel) quotedText() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.quoted
}

func hasTool(tools []struct {
	Function struct {
		Name string `json:"name"`
	} `json:"function"`
}, name string) bool {
	for _, t := range tools {
		if t.Function.Name == name {
			return true
		}
	}
	return false
}

func writeSSE(w http.ResponseWriter, f http.Flusher, payload any) {
	raw, _ := json.Marshal(payload)
	fmt.Fprintf(w, "data: %s\n\n", raw)
	if f != nil {
		f.Flush()
	}
}

// firstSentenceOfPassage returns a chunk of the first quoted passage — the text
// the answer is grounded in, which must appear on the page the chip opens.
//
// The envelope wraps every passage and ends it with the cite instruction, so
// the passage body is what sits just before that line.
func firstSentenceOfPassage(envelope string) string {
	loc := envelopeBody.FindStringIndex(envelope)
	if loc == nil {
		return ""
	}
	body := strings.TrimSpace(envelope[:loc[0]])
	// Take a distinctive run of words from the END of the body: the start of a
	// chunk can be a heading the splitter carried over, while the tail is
	// always prose from the page itself.
	words := strings.Fields(body)
	if len(words) > 12 {
		words = words[len(words)-12:]
	}
	return strings.Join(words, " ")
}

// containsNormalised compares with whitespace collapsed: the chunker joins
// lines that the page-split renders with their original wrapping.
func containsNormalised(haystack, needle string) bool {
	norm := func(s string) string { return strings.Join(strings.Fields(s), " ") }
	return strings.Contains(norm(haystack), norm(needle))
}

func truncateForMsg(s string) string {
	if len(s) > 400 {
		return s[:400] + "…"
	}
	return s
}

// ── phase 5's doubles, as internal/api/kbapi uses them ───────────────────────

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

type replayParser struct {
	pages map[int]string
	mu    sync.Mutex
}

func newReplayParser(t *testing.T, stem string) *replayParser {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "rag", "parse", "testdata", "recorded", stem+".gemini.md"))
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
	dims int
	mu   sync.Mutex
}

func newHashEmbedder(dims int) *hashEmbedder { return &hashEmbedder{dims: dims} }

func (h *hashEmbedder) Model() string        { return "test-embed-001" }
func (h *hashEmbedder) ProviderName() string { return "fake" }

func (h *hashEmbedder) Embed(_ context.Context, texts []string, _ knowledge.EmbedTask) ([][]float32, int, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
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

func sqrt32(x float32) float32 {
	z := x
	for i := 0; i < 24; i++ {
		z = (z + x/z) / 2
	}
	return z
}

func ragFixturePDF(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "rag", "parse", "testdata", "rag.pdf"))
	if err != nil {
		t.Fatalf("read rag.pdf: %v", err)
	}
	return b
}

// e2eUsers is the identity lookup RequireUser consults.
type e2eUsers struct{ pool *pgxpool.Pool }

func (u e2eUsers) UserExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var exists bool
	err := u.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL)`, id).Scan(&exists)
	return exists, err
}
