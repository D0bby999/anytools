package app

// sources_e2e_test.go — documentation sites and GitHub repositories, end to
// end through the wiring (up-methods phase 18).
//
// A site is crawled by the crawl_site job on the real queue into ready,
// grouped page documents; a re-sync while one is queued is refused; a cancel
// stops the crawl. A repository is imported by the sync_repo job, and a
// grounded chat turn through the REAL byok chain cites its code file by path
// and line range.
//
// Scripted, all of them somebody else's server: the docs site and GitHub (a
// TLS fixture reached through the fetch guard's dialer), and the model (the
// fake OpenAI-compatible upstream). No live site, GitHub or model is called.

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api"
	"github.com/D0bby999/anytools/internal/api/kbapi"
	"github.com/D0bby999/anytools/internal/api/sourceapi"
	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/jobs"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/rag/retrieve"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const repoSHA = "abcdefabcdefabcdefabcdefabcdefabcdefabcd"

// sourcesFixture is the docs site and GitHub, on one TLS server.
func sourcesFixture(t *testing.T) *http.Client {
	t.Helper()
	page := func(title string, links ...string) string {
		var b strings.Builder
		fmt.Fprintf(&b, "<!doctype html><html><head><title>%s</title></head><body><article><h1>%s</h1>"+
			"<p>%s describes how the framework keeps a cache of rendered pages.</p>", title, title, title)
		for _, l := range links {
			fmt.Fprintf(&b, `<a href="%s">%s</a>`, l, l)
		}
		return b.String() + "</article></body></html>"
	}
	pages := map[string]string{
		"/docs/":         page("Framework docs", "cache", "routing", "/blog/"),
		"/docs/cache":    page("Caching"),
		"/docs/routing":  page("Routing"),
		"/blog/":         page("Blog"),
		"/docs/notfound": "",
	}
	var tarball bytes.Buffer
	gz := gzip.NewWriter(&tarball)
	tw := tar.NewWriter(gz)
	for name, body := range map[string]string{
		"README.md": "# Notes\n\nA repository of study notes.\n",
		"memory.go": "package notes\n\n// Recall reads from parametric memory, the knowledge stored in a model's weights.\n" +
			"func Recall() string {\n\treturn \"weights\"\n}\n\n// Retrieve reads from non-parametric memory, a dense index of passages.\n" +
			"func Retrieve() string {\n\treturn \"index\"\n}\n",
	} {
		_ = tw.WriteHeader(&tar.Header{Name: "notes-" + repoSHA + "/" + name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))})
		_, _ = tw.Write([]byte(body))
	}
	_ = tw.Close()
	_ = gz.Close()

	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Host == "gh.example.com" && strings.HasSuffix(r.URL.Path, ".git/info/refs"):
			pkt := func(s string) string { return fmt.Sprintf("%04x%s", len(s)+4, s) }
			w.Header().Set("Content-Type", "application/x-git-upload-pack-advertisement")
			_, _ = w.Write([]byte(pkt("# service=git-upload-pack\n") + "0000" +
				pkt(repoSHA+" HEAD\x00symref=HEAD:refs/heads/main\n") + pkt(repoSHA+" refs/heads/main\n") + "0000"))
		case r.Host == "codeload.example.com":
			w.Header().Set("Content-Type", "application/x-gzip")
			_, _ = w.Write(tarball.Bytes())
		case r.URL.Path == "/robots.txt":
			http.NotFound(w, r)
		default:
			body, ok := pages[r.URL.Path]
			if !ok || body == "" {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(body))
		}
	}))
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	fetch := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	fetch.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()
	return fetch
}

// newSourcesE2E is the production wiring for knowledge, sources and chat,
// with the network and the model scripted.
func newSourcesE2E(t *testing.T) (*e2e, uuid.UUID) {
	t.Helper()
	model := newFakeModel(t)
	t.Setenv(security.AllowPrivateEndpointsEnv, "1") // the fake model is loopback

	pool := testutil.TestDB(t)
	key := testutil.TestEncryptionKey
	user := testutil.NewUser(t, pool)
	conns := pg.NewProviderConnectionStore(pool, key)
	routes := pg.NewFunctionRouteStore(pool, key)
	tokens, err := oauth.NewService(pg.NewOAuthCredentialStore(pool, key), conns, pg.NewConnectionLockStore(pool), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	byokSvc := byok.NewService(conns, routes, pg.NewSearchConnectionStore(pool, key), tokens)
	byokSvc.SetSleepForTest(func(time.Duration) {})
	ctx := context.Background()
	conn, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai_compat", Kind: store.KindAPIKey, Name: "fake", APIBase: model.server.URL + "/v1", Secret: "key"})
	if err != nil {
		t.Fatal(err)
	}
	if err := routes.ReplaceRoute(ctx, user, "chat", []store.RouteEntryInput{{ConnectionID: conn.ID, Model: "fake-1"}}); err != nil {
		t.Fatal(err)
	}

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fetch := sourcesFixture(t)
	kbStore := pg.NewKnowledgeStore(pool)
	queue := jobs.NewQueue(pool, time.Minute)
	providers := &replayProviders{parser: newReplayParser(t, "rag"), embedder: newHashEmbedder(768)}
	svc := knowledge.NewService(knowledge.Config{
		Store: kbStore, Chunks: pg.NewChunkStore(pool), Blobs: blobs,
		Jobs: queue, Providers: providers, Events: knowledge.NewEvents(),
		Links: linkConfig(kbStore, blobs, byokSvc, linkDeps{fetch: fetch}),
		Sources: sourceConfig(pool, byokSvc, queue, sourceDeps{
			fetch:   fetch,
			github:  github.NewClientFor(fetch, "https://gh.example.com", "https://api.example.com", "https://codeload.example.com"),
			limiter: crawl.NewLimiter(crawl.MaxConcurrent, time.Millisecond),
		}),
	})
	authorizer := authz.New(kbStore)
	retriever := retrieve.New(pool)
	kb := knowledgeSubsystem{
		handler: kbapi.NewHandler(svc, authorizer, retriever, providers), service: svc, authz: authorizer,
		retriever: retriever, providers: providers, blobs: blobs, objects: blobs, queue: queue,
		jobHandlers: map[string]jobs.Handler{},
	}
	addSourceJobs(kb.jobHandlers, svc, queue)

	web := webDeps{}.withDefaults(byokSvc, pool)
	loopSvc, _, _ := buildLoop(pool, nil)
	rt := buildChatRuntime(pool, byokSvc, kb, web, nil, loopStates{loopSvc})
	t.Cleanup(rt.stop)

	server := httptest.NewServer(api.BuildMux(api.Deps{
		Knowledge: kb.handler, Chat: rt.handler, Sources: sourceapi.NewHandler(svc, authorizer),
		Users: e2eUsers{pool}, GatewayToken: e2eToken,
	}))
	t.Cleanup(server.Close)

	worker := jobs.NewWorker(queue, "e2e-"+uuid.NewString()[:8], time.Millisecond)
	worker.Handle(jobs.KindParseDocument, parseDocumentHandler(svc))
	for kind, h := range kb.jobHandlers {
		worker.Handle(kind, h)
	}
	e := &e2e{t: t, pool: pool, server: server, worker: worker, user: user, model: model}
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Sources"}, http.StatusCreated)["id"].(string))
	return e, kbID
}

func TestASiteIsCrawledIntoGroupedPagesAndCanBeCancelled(t *testing.T) {
	e, kbID := newSourcesE2E(t)

	added := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/sites",
		map[string]any{"url": "https://example.com/docs/", "depth": 1}, http.StatusAccepted)
	site := added["site"].(map[string]any)
	siteID := site["id"].(string)
	if site["status"] != "queued" || site["max_pages"] != float64(crawl.DefaultPages) || site["path_prefix"] != "/docs/" {
		t.Fatalf("site = %v", site)
	}
	// A second add of the same start URL is the same site.
	if st := e.status(http.MethodPost, "/v1/kb/"+kbID.String()+"/sites", map[string]any{"url": "https://example.com/docs/"}); st != http.StatusConflict {
		t.Fatalf("duplicate site: %d", st)
	}
	e.drainJobs()

	view := e.json(http.MethodGet, "/v1/sites/"+siteID, nil, http.StatusOK)
	got := view["site"].(map[string]any)
	if got["status"] != "ready" || got["found"] != float64(3) || got["done"] != float64(3) || got["documents"] != float64(3) {
		t.Fatalf("crawled site = %v", got)
	}
	if got["title"] != "Framework docs" {
		t.Fatalf("title = %v", got["title"])
	}
	for _, p := range view["pages"].([]any) {
		page := p.(map[string]any)
		if page["status"] != "added" || page["document_status"] != "ready" {
			t.Fatalf("page = %v", page)
		}
	}
	docs := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil, http.StatusOK)["documents"].([]any)
	if len(docs) != 3 {
		t.Fatalf("%d documents", len(docs))
	}
	for _, d := range docs {
		doc := d.(map[string]any)
		if doc["source_kind"] != "site_page" || doc["site_id"] != siteID || !strings.HasPrefix(doc["source_url"].(string), "https://example.com/docs/") {
			t.Fatalf("page document = %v", doc)
		}
	}

	// Re-sync: queued once, refused while queued, then cancelled.
	resync := e.json(http.MethodPost, "/v1/sites/"+siteID+"/resync", nil, http.StatusAccepted)
	if resync["job_id"] == nil {
		t.Fatal("no job")
	}
	if st := e.status(http.MethodPost, "/v1/sites/"+siteID+"/resync", nil); st != http.StatusConflict {
		t.Fatalf("a second re-sync while one is queued: %d", st)
	}
	e.json(http.MethodPost, "/v1/sites/"+siteID+"/cancel", nil, http.StatusAccepted)
	e.drainJobs()
	if st := e.json(http.MethodGet, "/v1/sites/"+siteID, nil, http.StatusOK)["site"].(map[string]any)["status"]; st != "cancelled" {
		t.Fatalf("after cancel: %v", st)
	}
	if st := e.status(http.MethodPost, "/v1/sites/"+siteID+"/cancel", nil); st != http.StatusConflict {
		t.Fatalf("cancelling a resting site: %d", st)
	}

	// Deleting the site deletes its pages.
	if st := e.status(http.MethodDelete, "/v1/sites/"+siteID, nil); st != http.StatusNoContent {
		t.Fatalf("delete: %d", st)
	}
	if docs := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil, http.StatusOK)["documents"].([]any); len(docs) != 0 {
		t.Fatalf("%d documents outlived their site", len(docs))
	}
}

func TestARepositoryIsImportedAndItsCodeCitedByLine(t *testing.T) {
	e, kbID := newSourcesE2E(t)

	added := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/repos",
		map[string]any{"url": "https://github.com/acme/notes", "extensions": []string{".md", ".go"}}, http.StatusAccepted)
	repoID := added["repo"].(map[string]any)["id"].(string)
	e.drainJobs()

	view := e.json(http.MethodGet, "/v1/repos/"+repoID, nil, http.StatusOK)
	repo := view["repo"].(map[string]any)
	if repo["status"] != "ready" || repo["commit_sha"] != repoSHA || repo["resolved_branch"] != "main" || repo["file_count"] != float64(2) {
		t.Fatalf("repo = %v", repo)
	}
	var codeID string
	for _, f := range view["files"].([]any) {
		file := f.(map[string]any)
		if file["status"] != "ready" {
			t.Fatalf("file = %v", file)
		}
		if file["source_path"] == "memory.go" {
			codeID = file["id"].(string)
			if file["page_unit"] != "line" {
				t.Fatalf("code file = %v", file)
			}
		}
	}

	chip := e.askForASource(kbID)
	if chip.DocumentID != codeID || chip.Page < 1 || chip.LineEnd < chip.Page {
		t.Fatalf("chip = %+v; want memory.go with a line range", chip)
	}

	// The same commit: a re-sync does no work.
	e.json(http.MethodPost, "/v1/repos/"+repoID+"/resync", nil, http.StatusAccepted)
	e.drainJobs()
	again := e.json(http.MethodGet, "/v1/repos/"+repoID, nil, http.StatusOK)["repo"].(map[string]any)
	if again["status"] != "ready" || again["file_count"] != float64(2) {
		t.Fatalf("repo after re-sync = %v", again)
	}
}
