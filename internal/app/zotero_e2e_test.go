package app

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/zotero/zoterotest"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/logging"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// up methods, phase 20: "Add from Zotero" over HTTP, through the production
// handler, service and upload path, against a scripted Zotero Web API.

// newZoteroE2E is one learner with a knowledge base and the given Zotero
// fixture, and a function that stores a Zotero key for any user.
func newZoteroE2E(t *testing.T, srv *zoterotest.Server, fns ...string) (*e2e, uuid.UUID, func(user uuid.UUID, key string)) {
	t.Helper()
	model := newStageModel(t)
	web := newScriptedWeb(t, true)
	e := buildE2EWith(t, model.server.URL, append([]string{"chat"}, fns...), nil,
		webDeps{searcher: web, fetchClient: web.fetchClient(), zotero: srv.Client()})
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Library"}, http.StatusCreated)["id"].(string))
	keys := pg.NewSearchConnectionStore(e.pool, testutil.TestEncryptionKey)
	connect := func(user uuid.UUID, key string) {
		t.Helper()
		secret, err := byok.ZoteroSecret(zoterotest.UserID, key)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := keys.UpsertSearchConnection(context.Background(), user, byok.ProviderZotero, secret); err != nil {
			t.Fatal(err)
		}
	}
	return e, kbID, connect
}

func (e *e2e) zoteroStatus(method, path string, body any) (int, string) {
	e.t.Helper()
	res := e.do(method, path, body)
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

func TestAZoteroItemIsAddedAsItsPDFOrANoteAndOnlyOnce(t *testing.T) {
	srv := zoterotest.New(t)
	srv.PDF = ragFixturePDF(t)
	e, kbID, connect := newZoteroE2E(t, srv)
	kb := "/v1/kb/" + kbID.String()

	// No key yet: the panel is told to add one, and Zotero is not called.
	if got, body := e.zoteroStatus(http.MethodGet, kb+"/zotero/search?q=retrieval", nil); got != http.StatusConflict ||
		!strings.Contains(body, "zotero_not_connected") {
		t.Fatalf("search without a key: %d %s", got, body)
	}
	if srv.Calls.Load() != 0 {
		t.Fatal("Zotero was called without a key")
	}
	connect(e.user, zoterotest.Key)

	// Search, against the fixture.
	items := e.json(http.MethodGet, kb+"/zotero/search?q=retrieval", nil, http.StatusOK)["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("items: %v", items)
	}
	first := items[0].(map[string]any)
	if first["key"] != zoterotest.ItemWithPDF || first["year"] != "2020" || first["item_type"] != "journalArticle" ||
		len(first["creators"].([]any)) != 3 {
		t.Fatalf("first item: %v", first)
	}
	// Browse: top-level collections, then one collection's items.
	top := e.json(http.MethodGet, kb+"/zotero/collections", nil, http.StatusOK)
	if cols := top["collections"].([]any); len(cols) != 1 || cols[0].(map[string]any)["name"] != "Retrieval" {
		t.Fatalf("collections: %v", top)
	}
	inside := e.json(http.MethodGet, kb+"/zotero/collections?collection="+zoterotest.Collection, nil, http.StatusOK)
	if len(inside["items"].([]any)) != 2 {
		t.Fatalf("collection items: %v", inside)
	}
	if got, _ := e.zoteroStatus(http.MethodGet, kb+"/zotero/collections?collection=../keys", nil); got != http.StatusBadRequest {
		t.Fatalf("a path for a collection: %d", got)
	}

	// An item with a PDF in Zotero storage is added as that PDF.
	added := e.json(http.MethodPost, kb+"/zotero/items", map[string]string{"item_key": zoterotest.ItemWithPDF}, http.StatusCreated)
	if added["as_pdf"] != true {
		t.Fatalf("added: %v", added)
	}
	if srv.KeyAtStorage.Load() {
		t.Fatal("the Zotero key followed the redirect to the file host")
	}
	// Without one, a Markdown note of its metadata and abstract, with a link.
	note := e.json(http.MethodPost, kb+"/zotero/items", map[string]string{"item_key": zoterotest.ItemWithoutPDF}, http.StatusCreated)
	if note["as_pdf"] != false || note["title"] != "Attention Is All You Need" {
		t.Fatalf("note: %v", note)
	}
	e.drainJobs()

	var pdfMime, mdMime string
	if err := e.pool.QueryRow(t.Context(),
		`SELECT mime FROM documents WHERE user_id = $1 AND kb_id = $2 AND zotero_key = $3`,
		e.user, kbID, zoterotest.ItemWithPDF).Scan(&pdfMime); err != nil {
		t.Fatal(err)
	}
	if err := e.pool.QueryRow(t.Context(),
		`SELECT mime FROM documents WHERE user_id = $1 AND kb_id = $2 AND zotero_key = $3`,
		e.user, kbID, zoterotest.ItemWithoutPDF).Scan(&mdMime); err != nil {
		t.Fatal(err)
	}
	if pdfMime != "application/pdf" || !strings.Contains(mdMime, "markdown") {
		t.Fatalf("mimes: %q %q", pdfMime, mdMime)
	}
	docs := e.json(http.MethodGet, kb+"/documents", nil, http.StatusOK)["documents"].([]any)
	for _, d := range docs {
		doc := d.(map[string]any)
		if doc["status"] != "ready" {
			t.Errorf("document %v is %v: %v", doc["title"], doc["status"], doc["error"])
		}
	}
	if len(docs) != 2 {
		t.Fatalf("documents: %v", docs)
	}

	// The same item twice is refused, before Zotero is asked for it again.
	before := srv.Calls.Load()
	for _, key := range []string{zoterotest.ItemWithPDF, zoterotest.ItemWithoutPDF} {
		if got, body := e.zoteroStatus(http.MethodPost, kb+"/zotero/items", map[string]string{"item_key": key}); got != http.StatusConflict ||
			!strings.Contains(body, "already_added") {
			t.Fatalf("adding %s twice: %d %s", key, got, body)
		}
	}
	if srv.Calls.Load() != before {
		t.Fatal("a duplicate reached Zotero")
	}
	// A key that cannot be one is refused.
	if got, _ := e.zoteroStatus(http.MethodPost, kb+"/zotero/items", map[string]string{"item_key": "../keys/x"}); got != http.StatusBadRequest {
		t.Fatalf("a bad item key: %d", got)
	}
	// Another knowledge base of the same learner takes the same item.
	other := e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Other"}, http.StatusCreated)["id"].(string)
	e.json(http.MethodPost, "/v1/kb/"+other+"/zotero/items", map[string]string{"item_key": zoterotest.ItemWithoutPDF}, http.StatusCreated)

	// The item changed in Zotero since (other bytes, so the content hash
	// does not catch it): the item key still refuses a second copy, even
	// when two adds race past the service's own check.
	_, err := pg.NewKnowledgeStore(e.pool).CreateDocument(t.Context(), knowledge.Document{
		UserID: e.user, KBID: kbID, SourceKind: knowledge.SourceUpload, Title: "changed", MIME: "text/markdown",
		Bytes: 1, SHA256: strings.Repeat("ab", 32), PageCount: 1, ZoteroKey: zoterotest.ItemWithoutPDF,
	})
	if !knowledge.IsDuplicateDocument(err) {
		t.Fatalf("a second document for the same item: %v", err)
	}
}

// Another user's knowledge base answers exactly like a missing one, BEFORE
// the caller's key is read or Zotero is called, though the caller has a key.
func TestAnotherUsersKnowledgeBaseAnswers404BeforeAnyZoteroCall(t *testing.T) {
	srv := zoterotest.New(t)
	e, kbID, connect := newZoteroE2E(t, srv)
	bob := testutil.NewUser(t, e.pool)
	connect(bob, zoterotest.Key)
	stranger := e.as(bob)

	for _, kb := range []string{kbID.String(), uuid.NewString(), "not-a-uuid"} {
		for _, probe := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/v1/kb/" + kb + "/zotero/search?q=retrieval", nil},
			{http.MethodGet, "/v1/kb/" + kb + "/zotero/collections", nil},
			{http.MethodGet, "/v1/kb/" + kb + "/zotero/collections?collection=" + zoterotest.Collection, nil},
			{http.MethodPost, "/v1/kb/" + kb + "/zotero/items", map[string]string{"item_key": zoterotest.ItemWithPDF}},
			{http.MethodPost, "/v1/kb/" + kb + "/zotero/items", map[string]string{"item_key": "bad"}},
		} {
			if got, body := stranger.zoteroStatus(probe.method, probe.path, probe.body); got != http.StatusNotFound ||
				!strings.Contains(body, `"not_found"`) {
				t.Errorf("bob %s %s: %d %s", probe.method, probe.path, got, body)
			}
		}
	}
	if n := srv.Calls.Load(); n != 0 {
		t.Fatalf("Zotero was called %d times for a knowledge base that is not the caller's", n)
	}
	if n := e.scalar(`SELECT count(*) FROM documents WHERE kb_id = $1`, kbID); n != 0 {
		t.Fatalf("bob added %d documents to alice's knowledge base", n)
	}
}

// The key appears in no answer and no log line, whatever Zotero says back:
// the fixture echoes the Authorization header and the path in its refusals.
func TestTheZoteroKeyReachesNoAnswerAndNoLog(t *testing.T) {
	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(logging.NewRedactingHandler(slog.NewJSONHandler(&logs, nil))))
	t.Cleanup(func() { slog.SetDefault(previous) })

	srv := zoterotest.New(t)
	e, kbID, connect := newZoteroE2E(t, srv)
	const wrong = "WRONGKEY0SECRET000000000"
	connect(e.user, wrong)
	kb := "/v1/kb/" + kbID.String()

	var answers []string
	for _, probe := range []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, kb + "/zotero/search?q=retrieval", nil},
		{http.MethodGet, kb + "/zotero/collections", nil},
		{http.MethodPost, kb + "/zotero/items", map[string]string{"item_key": zoterotest.ItemWithPDF}},
	} {
		got, body := e.zoteroStatus(probe.method, probe.path, probe.body)
		if got != http.StatusConflict || !strings.Contains(body, "zotero_key") {
			t.Errorf("%s %s with a refused key: %d %s", probe.method, probe.path, got, body)
		}
		answers = append(answers, body)
	}
	// A transport failure: Go's error names the URL.
	srv.Close()
	got, body := e.zoteroStatus(http.MethodGet, kb+"/zotero/search?q=retrieval", nil)
	if got != http.StatusBadGateway {
		t.Errorf("Zotero down: %d %s", got, body)
	}
	answers = append(answers, body)

	for _, text := range append(answers, logs.String()) {
		if strings.Contains(text, "SECRET") || strings.Contains(text, wrong) {
			t.Fatalf("the Zotero key leaked: %s", text)
		}
	}
	if n := e.scalar(`SELECT count(*) FROM documents WHERE kb_id = $1`, kbID); n != 0 {
		t.Fatalf("%d documents added with a refused key", n)
	}
}

// Research searches the learner's library when it is connected, and every
// item reaches the model inside the untrusted envelope.
func TestResearchSearchesTheZoteroLibraryEnveloped(t *testing.T) {
	srv := zoterotest.New(t)
	model := newStageModel(t)
	web := newScriptedWeb(t, true)
	e := buildE2EWith(t, model.server.URL, []string{"chat", "solve", "research"}, nil,
		webDeps{searcher: web, fetchClient: web.fetchClient(), zotero: srv.Client()})
	secret, _ := byok.ZoteroSecret(zoterotest.UserID, zoterotest.Key)
	if _, err := pg.NewSearchConnectionStore(e.pool, testutil.TestEncryptionKey).
		UpsertSearchConnection(context.Background(), e.user, byok.ProviderZotero, secret); err != nil {
		t.Fatal(err)
	}

	started := e.json(http.MethodPost, "/v1/research",
		map[string]any{"query": "how does RAG use parametric memory", "mode": "quick"}, http.StatusAccepted)
	frames := e.readTurnStream(started["turn_id"].(string))
	_, meta := resultOf(t, frames)
	if meta["report_id"] == nil {
		t.Fatalf("result = %v", meta)
	}
	searched := 0
	for _, p := range srv.Paths() {
		if strings.Contains(p, "/items/top?") {
			searched++
		}
	}
	if searched == 0 {
		t.Fatal("research never searched the Zotero library")
	}
	model.mu.Lock()
	synth := model.synthInput
	model.mu.Unlock()
	// The abstract, in the envelope's body (the title is in its source).
	const abstract = "Large pre-trained language models store factual knowledge in their parameters."
	at := strings.Index(synth, abstract)
	if at < 0 {
		t.Fatalf("the library item never reached the synthesis: %s", synth)
	}
	open := strings.LastIndex(synth[:at], "<document ")
	if open < 0 || !strings.Contains(synth[open:at], `trust="untrusted"`) || strings.LastIndex(synth[:at], "</document>") > open {
		t.Fatalf("the library item reached the model outside an envelope: %s", synth)
	}
}
