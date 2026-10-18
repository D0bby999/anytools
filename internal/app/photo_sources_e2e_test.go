package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
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

// Up-methods phase 16 end to end: two photos of a book's pages go up as one
// document, the learner's own parse route (a Gemini key, through the real
// BYOK chain and pageParser) reads each photo with the photo prompt, and the
// passages it answers are cited on the right page with the model that read
// them. Gemini is scripted: no live key exists, so its answers below are
// written in the shape of a generateContent response, not recorded from one.

// photoAnswers are the scripted readings, keyed by the name inside a photo
// fixture.
var photoAnswers = map[string]string{
	"page-41": "## 4.2 Light reactions\n\nChlorophyll absorbs red and blue light; the thylakoid membrane holds the photosystems.",
	"page-42": "| Stage | Where |\n|---|---|\n| Calvin cycle | stroma |\n\nMargin note: ask about [illegible] tomorrow.",
}

type photoGemini struct {
	server *httptest.Server
	mu     sync.Mutex
	calls  []map[string]any
	keys   []string
}

func newPhotoGemini(t *testing.T) *photoGemini {
	g := &photoGemini{}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		g.mu.Lock()
		g.calls = append(g.calls, body)
		g.keys = append(g.keys, r.Header.Get("x-goog-api-key"))
		g.mu.Unlock()

		parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		data, _ := base64.StdEncoding.DecodeString(parts[0].(map[string]any)["inline_data"].(map[string]any)["data"].(string))
		name := string(bytes.Split(data, []byte("|"))[1])
		text, _ := json.Marshal(photoAnswers[name])
		fmt.Fprintf(w, `{"candidates":[{"content":{"parts":[{"text":%s}]},"finishReason":"STOP"}],
			"usageMetadata":{"promptTokenCount":1290,"candidatesTokenCount":60}}`, text)
	}))
	t.Cleanup(g.server.Close)
	return g
}

// photoProviders is the real parse chain (byokProviders) with the test's
// hashing embedder, so only the model upstream is scripted.
type photoProviders struct {
	real     knowledge.Providers
	embedder knowledge.Embedder
}

func (p photoProviders) ParserChain(ctx context.Context, u knowledge.UserID) ([]knowledge.Parser, error) {
	return p.real.ParserChain(ctx, u)
}

func (p photoProviders) EmbedderFor(context.Context, knowledge.UserID) (knowledge.Embedder, error) {
	return p.embedder, nil
}

func TestPhotosOfABookAreReadByTheLearnersParseRouteAndCited(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	user := testutil.NewUser(t, pool)
	ctx := context.Background()
	gemini := newPhotoGemini(t)

	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	tokens, err := oauth.NewService(pg.NewOAuthCredentialStore(pool, key), conns, pg.NewConnectionLockStore(pool), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	byokSvc := byok.NewService(conns, routes, pg.NewSearchConnectionStore(pool, key), tokens)
	byokSvc.SetSleepForTest(func(time.Duration) {})
	conn, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "mine", APIBase: gemini.server.URL, Secret: "AIza-learner-key"})
	if err != nil {
		t.Fatal(err)
	}
	if err := routes.ReplaceRoute(ctx, user, "parse", []store.RouteEntryInput{{ConnectionID: conn.ID, Model: "gemini-3.6-flash"}}); err != nil {
		t.Fatal(err)
	}

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	kbStore := pg.NewKnowledgeStore(pool)
	queue := jobs.NewQueue(pool, time.Minute)
	providers := photoProviders{real: newProviders(byokSvc), embedder: newHashEmbedder(768)}
	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: pg.NewChunkStore(pool), Blobs: blobs, Jobs: queue,
		Providers: providers, Events: knowledge.NewEvents(),
	})
	server := httptest.NewServer(api.BuildMux(api.Deps{
		Knowledge:    kbapi.NewHandler(svc, authz.New(kbStore), retrieve.New(pool), providers),
		Users:        e2eUsers{pool},
		GatewayToken: e2eToken,
	}))
	t.Cleanup(server.Close)
	worker := jobs.NewWorker(queue, "e2e-photos-"+uuid.NewString()[:8], time.Millisecond)
	worker.Handle(jobs.KindParseDocument, parseDocumentHandler(svc))
	e := &e2e{t: t, pool: pool, server: server, worker: worker, user: user}

	kbID := e.json(http.MethodPost, "/v1/kb", map[string]any{"name": "Biology"}, http.StatusCreated)["id"].(string)

	// Two photos, added together, in the order the learner chose them.
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("one_document", "true")
	photos := [][]byte{
		[]byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00|page-41|"),
		[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR|page-42|"),
	}
	for i, p := range photos {
		part, _ := w.CreateFormFile("file", fmt.Sprintf("IMG_204%d.jpg", i+1))
		_, _ = part.Write(p)
	}
	_ = w.Close()
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/kb/"+kbID+"/documents", &buf)
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, user.String())
	req.Header.Set("Content-Type", w.FormDataContentType())
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("upload: %d %s", res.StatusCode, raw)
	}
	var up struct {
		Document struct {
			ID string `json:"id"`
		} `json:"document"`
	}
	_ = json.Unmarshal(raw, &up)
	e.drainJobs()

	// What reached Google: one call per photo, in order, each the photo with
	// its own type, the photo prompt, and the learner's key.
	if len(gemini.calls) != 2 {
		t.Fatalf("%d calls to the parse route, want one per photo", len(gemini.calls))
	}
	for i, want := range []string{"image/jpeg", "image/png"} {
		parts := gemini.calls[i]["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		inline := parts[0].(map[string]any)["inline_data"].(map[string]any)
		if inline["mime_type"] != want || inline["data"] != base64.StdEncoding.EncodeToString(photos[i]) ||
			parts[1].(map[string]any)["text"] != parse.ImagePrompt() || gemini.keys[i] != "AIza-learner-key" {
			t.Fatalf("call %d = %v %v", i+1, inline["mime_type"], parts[1])
		}
	}

	doc := e.json(http.MethodGet, "/v1/documents/"+up.Document.ID, nil, http.StatusOK)["document"].(map[string]any)
	if doc["status"] != "ready" || doc["page_count"] != float64(2) {
		t.Fatalf("document = %v", doc)
	}
	if pb := doc["processed_by"].(map[string]any); pb["parser"] != "gemini" || pb["model"] != "gemini-3.6-flash" {
		t.Fatalf("processed_by = %v", pb)
	}
	pages := e.json(http.MethodGet, "/v1/documents/"+up.Document.ID+"/content", nil, http.StatusOK)["pages"].([]any)
	if len(pages) != 2 {
		t.Fatalf("%d pages", len(pages))
	}
	for i, name := range []string{"page-41", "page-42"} {
		p := pages[i].(map[string]any)
		if p["page"] != float64(i+1) || strings.TrimSpace(p["markdown"].(string)) != photoAnswers[name] {
			t.Errorf("page %d = %v", i+1, p)
		}
	}

	// The Calvin cycle is on the second photo, and is cited there, read by
	// the learner's model from a photo.
	hits := e.json(http.MethodPost, "/v1/kb/"+kbID+"/query", map[string]any{"query": "Calvin cycle stroma"}, http.StatusOK)
	list, _ := hits["hits"].([]any)
	if len(list) == 0 {
		t.Fatalf("no hits: %v", hits)
	}
	top := list[0].(map[string]any)
	if top["page_start"] != float64(2) || top["photo_model"] != "gemini-3.6-flash" || top["document_id"] != up.Document.ID {
		t.Fatalf("top hit = %v", top)
	}

	// And the citation's page opens that photo.
	photo := e.do(http.MethodGet, "/v1/documents/"+up.Document.ID+"/photo?page=2", nil)
	got, _ := io.ReadAll(photo.Body)
	photo.Body.Close()
	if photo.StatusCode != http.StatusOK || photo.Header.Get("Content-Type") != "image/png" || !bytes.Equal(got, photos[1]) {
		t.Fatalf("photo 2: %d %s", photo.StatusCode, photo.Header.Get("Content-Type"))
	}
}
