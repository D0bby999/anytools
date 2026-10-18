package knowledge_test

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/crawl"
	"github.com/D0bby999/anytools/internal/connectors/github"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Sites and repositories are tested against the real store and a fixture
// web server reached through the production fetch client's shape, as links
// are: what matters (the frontier's order and cap, removal marks, URL
// uniqueness) is the migration's.

// docsSite serves pages, redirects and robots.txt, and counts every hit.
type docsSite struct {
	mu        sync.Mutex
	pages     map[string]string
	redirects map[string]string
	robots    string
	hits      map[string]int
}

func (d *docsSite) set(path, body string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pages[path] = body
}

func (d *docsSite) drop(path string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.pages, path)
}

func (d *docsSite) count(path string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.hits[path]
}

func (d *docsSite) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	d.mu.Lock()
	defer d.mu.Unlock()
	key := r.URL.Path
	if r.Host != "example.com" {
		key = r.Host + r.URL.Path
	}
	d.hits[key]++
	if r.URL.Path == "/robots.txt" {
		if d.robots == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(d.robots))
		return
	}
	if to, ok := d.redirects[r.URL.Path]; ok {
		http.Redirect(w, r, to, http.StatusFound)
		return
	}
	body, ok := d.pages[r.URL.Path]
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

// docPage is a page with a title, some text and links.
func docPage(title string, links ...string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "<!doctype html><html><head><title>%s</title></head><body><article><h1>%s</h1>"+
		"<p>%s explains one part of the framework in enough words to be indexed.</p>", title, title, title)
	for _, l := range links {
		fmt.Fprintf(&b, `<a href="%s">%s</a> `, l, l)
	}
	b.WriteString("</article></body></html>")
	return b.String()
}

// sourceJobs records what the service queued.
type sourceJobs struct {
	mu   sync.Mutex
	jobs []queuedJob
}

type queuedJob struct {
	id      uuid.UUID
	kind    string
	payload any
}

func (j *sourceJobs) Enqueue(_ context.Context, _ uuid.UUID, kind string, payload any, _ int) (uuid.UUID, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	id := uuid.New()
	j.jobs = append(j.jobs, queuedJob{id: id, kind: kind, payload: payload})
	return id, nil
}

func (j *sourceJobs) count(kind string) int {
	j.mu.Lock()
	defer j.mu.Unlock()
	n := 0
	for _, q := range j.jobs {
		if q.kind == kind {
			n++
		}
	}
	return n
}

// parses are the documents parse_document was queued for, in order.
func (j *sourceJobs) parses() []uuid.UUID {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []uuid.UUID
	for _, q := range j.jobs {
		if p, ok := q.payload.(knowledge.ParseJobPayload); ok {
			out = append(out, p.DocumentID)
		}
	}
	return out
}

// parseQueued runs every parse queued since the last call, as the worker
// would, so the documents rest in ready.
func (h *sourceHarness) parseQueued(t *testing.T) {
	t.Helper()
	all := h.jobs.parses()
	for _, id := range all[h.parsed:] {
		if err := h.svc.ProcessDocument(context.Background(), h.user, knowledge.ParseJobPayload{DocumentID: id, KBID: h.kb.ID},
			knowledge.Attempt{Number: 1, Max: 3}); err != nil {
			t.Fatalf("parse: %v", err)
		}
	}
	h.parsed = len(all)
}

type fakeTokens struct{ token string }

func (f fakeTokens) GitHubToken(context.Context, uuid.UUID) (string, error) { return f.token, nil }

type sourceHarness struct {
	svc     *knowledge.Service
	store   *pg.KnowledgeStore
	sources *pg.SourceStore
	jobs    *sourceJobs
	site    *docsSite
	gh      *fakeRepoHost
	dials   *atomic.Int32
	user    uuid.UUID
	kb      *knowledge.KB
	now     time.Time
	parsed  int
}

func newSourceHarness(t *testing.T, lookupIP string) *sourceHarness {
	t.Helper()
	pool := testutil.TestDB(t)
	site := &docsSite{pages: map[string]string{}, redirects: map[string]string{}, hits: map[string]int{}}
	gh := &fakeRepoHost{hits: map[string]int{}}
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.Host, "gh.example.com") || r.Host == "api.example.com" || r.Host == "codeload.example.com" {
			gh.ServeHTTP(w, r)
			return
		}
		site.ServeHTTP(w, r)
	})
	srv := httptest.NewTLSServer(mux)
	t.Cleanup(srv.Close)
	addr := srv.Listener.Addr().String()
	dials := &atomic.Int32{}
	fetch := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP(lookupIP)}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			dials.Add(1)
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	fetch.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := &sourceHarness{store: pg.NewKnowledgeStore(pool), sources: pg.NewSourceStore(pool), jobs: &sourceJobs{},
		site: site, gh: gh, dials: dials, user: testutil.NewUser(t, pool), now: time.Now().UTC()}
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: pg.NewChunkStore(pool), Blobs: blobs, Jobs: h.jobs,
		Providers: &fakeProviders{embedder: newFakeEmbedder("fake-embed", 768)},
		Links: &knowledge.LinkConfig{Store: h.store, Fetch: fetch, Objects: blobs,
			Now: func() time.Time { return h.now }},
		Sources: &knowledge.SourceConfig{
			Store: h.sources, Fetch: fetch,
			GitHub:  github.NewClientFor(fetch, "https://gh.example.com", "https://api.example.com", "https://codeload.example.com"),
			Tokens:  &gh.tokens,
			Limiter: crawl.NewLimiter(crawl.MaxConcurrent, time.Millisecond),
		},
	})
	h.kb, err = h.svc.CreateKB(context.Background(), h.user, "Sources")
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// crawl runs a site's queued crawl the way the worker does, resuming from
// done like jobs.RunUnits.
func (h *sourceHarness) crawl(t *testing.T, siteID, jobID uuid.UUID) error {
	t.Helper()
	done := 0
	return h.svc.RunCrawl(context.Background(), h.user, siteID, jobID,
		func(ctx context.Context, total int, unit func(context.Context, int) (int, error)) error {
			for ; done < total; done++ {
				if _, err := unit(ctx, done); err != nil {
					return err
				}
			}
			return nil
		})
}

func (h *sourceHarness) addSite(t *testing.T, raw string, depth, pages int) *knowledge.Site {
	t.Helper()
	site, jobID, err := h.svc.AddSite(context.Background(), h.user, h.kb.ID, raw, depth, pages)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.crawl(t, site.ID, jobID); err != nil {
		t.Fatalf("crawl: %v", err)
	}
	h.parseQueued(t)
	got, _, err := h.svc.GetSite(context.Background(), h.user, site.ID)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func (h *sourceHarness) resync(t *testing.T, siteID uuid.UUID) {
	t.Helper()
	jobID, err := h.svc.ResyncSite(context.Background(), h.user, siteID)
	if err != nil {
		t.Fatal(err)
	}
	if err := h.crawl(t, siteID, jobID); err != nil {
		t.Fatalf("re-crawl: %v", err)
	}
	h.parseQueued(t)
}

func pagesByURL(t *testing.T, h *sourceHarness, siteID uuid.UUID) map[string]knowledge.SitePage {
	t.Helper()
	_, pages, err := h.svc.GetSite(context.Background(), h.user, siteID)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]knowledge.SitePage{}
	for _, p := range pages {
		out[strings.TrimPrefix(p.URL, "https://example.com")] = p
	}
	return out
}

// tree is a docs site three levels deep under /docs/, with links out of scope.
func (h *sourceHarness) tree() {
	h.site.set("/docs/", docPage("Docs home", "intro", "guide/", "/blog/news", "https://other.example.com/docs/x", "/docs/private/secret"))
	h.site.set("/docs/intro", docPage("Intro", "guide/"))
	h.site.set("/docs/guide/", docPage("Guide", "setup", "deep/"))
	h.site.set("/docs/guide/setup", docPage("Setup"))
	h.site.set("/docs/guide/deep/", docPage("Deep", "deeper"))
	h.site.set("/docs/guide/deep/deeper", docPage("Deeper", "deepest"))
	h.site.set("/docs/guide/deep/deepest", docPage("Deepest"))
	h.site.set("/docs/private/secret", docPage("Secret"))
	h.site.set("/blog/news", docPage("News"))
}

func TestACrawlHoldsDepthPrefixOriginAndRobots(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	h.tree()
	h.site.robots = "User-agent: *\nDisallow: /docs/private/\n"

	site := h.addSite(t, "https://example.com/docs/", 1, 50)
	pages := pagesByURL(t, h, site.ID)
	want := []string{"/docs/", "/docs/intro", "/docs/guide/"}
	if len(pages) != len(want) {
		t.Fatalf("depth 1 found %v", pages)
	}
	for _, p := range want {
		if pages[p].Status != knowledge.PageAdded || pages[p].DocumentID == nil {
			t.Fatalf("%s: %+v", p, pages[p])
		}
	}
	for _, p := range []string{"/docs/guide/setup", "/blog/news", "/docs/private/secret"} {
		if n := h.site.count(p); n != 0 {
			t.Errorf("%s fetched %d times", p, n)
		}
	}
	if n := h.site.count("other.example.com/docs/x"); n != 0 {
		t.Errorf("another origin was fetched")
	}
	if h.site.count("/robots.txt") != 1 {
		t.Errorf("robots.txt read %d times; once per crawl", h.site.count("/robots.txt"))
	}
	if site.Status != knowledge.SiteReady || site.Title != "Docs home" || site.Found != 3 || site.Done != 3 || site.Documents != 3 {
		t.Fatalf("site = %+v", site)
	}
	// Each page is its own document, cited by its own URL.
	if h.jobs.count("parse_document") != 3 {
		t.Fatalf("%d parses", h.jobs.count("parse_document"))
	}
	doc, err := h.store.GetDocument(context.Background(), h.user, *pages["/docs/intro"].DocumentID)
	if err != nil || doc.SourceKind != knowledge.SourceSitePage || doc.SourceURL != "https://example.com/docs/intro" ||
		doc.SiteID == nil || *doc.SiteID != site.ID || doc.Title != "Intro" {
		t.Fatalf("page document %+v %v", doc, err)
	}
}

func TestACrawlStopsAtThePageLimitAndDepthThree(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	h.tree()
	site := h.addSite(t, "https://example.com/docs/", 3, 4)
	if site.Found != 4 || site.Documents != 4 {
		t.Fatalf("page limit 4: %+v", site)
	}
	if h.site.count("/docs/guide/deep/") != 0 {
		t.Fatal("a fifth page was fetched")
	}

	h2 := newSourceHarness(t, "93.184.216.34")
	h2.tree()
	deep := h2.addSite(t, "https://example.com/docs/", 3, 50)
	// home 0; intro, guide, private 1; setup, deep 2; deeper 3. Deepest is 4.
	if h2.site.count("/docs/guide/deep/deeper") != 1 || h2.site.count("/docs/guide/deep/deepest") != 0 {
		t.Fatalf("depth 3: deeper fetched %d times, deepest %d", h2.site.count("/docs/guide/deep/deeper"),
			h2.site.count("/docs/guide/deep/deepest"))
	}
	if deep.Found != 7 {
		t.Fatalf("depth 3 found %d pages", deep.Found)
	}
	if _, _, err := h.svc.AddSite(context.Background(), h.user, h.kb.ID, "https://example.com/x/", 4, 10); err == nil {
		t.Fatal("depth 4 accepted")
	}
	if _, _, err := h.svc.AddSite(context.Background(), h.user, h.kb.ID, "https://example.com/x/", 1, 201); err == nil {
		t.Fatal("201 pages accepted")
	}
}

func TestARedirectOffThePrefixIsSkipped(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	h.site.set("/docs/", docPage("Home", "moved", "inside"))
	h.site.redirects["/docs/moved"] = "/blog/elsewhere"
	h.site.redirects["/docs/inside"] = "/docs/landed"
	h.site.set("/docs/landed", docPage("Landed"))
	h.site.set("/blog/elsewhere", docPage("Elsewhere"))

	site := h.addSite(t, "https://example.com/docs/", 1, 10)
	pages := pagesByURL(t, h, site.ID)
	if p := pages["/docs/moved"]; p.Status != knowledge.PageSkipped || p.DocumentID != nil {
		t.Fatalf("redirect off the prefix: %+v", p)
	}
	if h.site.count("/blog/elsewhere") != 0 {
		t.Fatal("the redirect target off the prefix was fetched")
	}
	if p := pages["/docs/inside"]; p.Status != knowledge.PageAdded {
		t.Fatalf("redirect inside the prefix: %+v", p)
	}
}

func TestAPrivateAddressIsNeverCrawled(t *testing.T) {
	h := newSourceHarness(t, "10.1.2.3")
	if _, _, err := h.svc.AddSite(context.Background(), h.user, h.kb.ID, "https://10.0.0.1/docs/", 1, 5); linkCode(err) != knowledge.LinkBadURL {
		t.Fatalf("a literal private address: %v", err)
	}
	site, jobID, err := h.svc.AddSite(context.Background(), h.user, h.kb.ID, "https://intranet.example.com/docs/", 1, 5)
	if err != nil {
		t.Fatal(err)
	}
	err = h.crawl(t, site.ID, jobID)
	if !knowledge.IsTerminal(err) {
		t.Fatalf("a name resolving to a private address: %v", err)
	}
	if n := h.dials.Load(); n != 0 {
		t.Fatalf("the guard let %d connections through", n)
	}
	h.svc.FailCrawl(context.Background(), h.user, site.ID, err, false)
	got, _, _ := h.svc.GetSite(context.Background(), h.user, site.ID)
	if got.Status != knowledge.SiteFailed || got.Documents != 0 {
		t.Fatalf("site after a refused crawl: %+v", got)
	}
}

func TestASiteResyncReindexesOnlyChangesAndMarksRemovals(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	ctx := context.Background()
	h.site.set("/docs/", docPage("Home", "a", "b", "c"))
	h.site.set("/docs/a", docPage("A"))
	h.site.set("/docs/b", docPage("B"))
	h.site.set("/docs/c", docPage("C"))
	site := h.addSite(t, "https://example.com/docs/", 1, 10)
	before := pagesByURL(t, h, site.ID)
	parses := len(h.jobs.parses())

	// Nothing changed: no parse.
	h.resync(t, site.ID)
	if n := len(h.jobs.parses()); n != parses {
		t.Fatalf("an unchanged re-sync queued %d parses", n-parses)
	}
	for p, page := range pagesByURL(t, h, site.ID) {
		if page.Status != knowledge.PageUnchanged {
			t.Fatalf("%s: %s", p, page.Status)
		}
	}

	// A changes, B is gone (404), C is no longer linked.
	h.site.set("/docs/", docPage("Home", "a", "b"))
	h.site.set("/docs/a", docPage("A, revised"))
	h.site.drop("/docs/b")
	h.resync(t, site.ID)

	got := h.jobs.parses()[parses:]
	if len(got) != 2 || !containsID(got, *before["/docs/a"].DocumentID) || !containsID(got, *before["/docs/"].DocumentID) {
		t.Fatalf("re-indexed %v; want the home page and A only", got)
	}
	after := pagesByURL(t, h, site.ID)
	if after["/docs/a"].Status != knowledge.PageChanged {
		t.Fatalf("A: %+v", after["/docs/a"])
	}
	for _, p := range []string{"/docs/b", "/docs/c"} {
		page := after[p]
		if page.Status != knowledge.PageRemoved || page.DocumentID == nil || page.RemovedAt == nil {
			t.Fatalf("%s: %+v", p, page)
		}
		// Marked, never deleted.
		doc, err := h.store.GetDocument(ctx, h.user, *page.DocumentID)
		if err != nil || doc.RemovedAt == nil {
			t.Fatalf("%s document: %+v %v", p, doc, err)
		}
	}
	s, _, _ := h.svc.GetSite(ctx, h.user, site.ID)
	if s.Documents != 4 || s.Removed != 2 {
		t.Fatalf("site counts %+v", s)
	}

	// B comes back unchanged: the mark is lifted without a parse.
	h.site.set("/docs/", docPage("Home", "a", "b"))
	h.site.set("/docs/b", docPage("B"))
	n := len(h.jobs.parses())
	h.resync(t, site.ID)
	back := pagesByURL(t, h, site.ID)["/docs/b"]
	if back.Status != knowledge.PageUnchanged || back.RemovedAt != nil || len(h.jobs.parses()) != n {
		t.Fatalf("B restored: %+v, %d parses", back, len(h.jobs.parses())-n)
	}

	// A re-sync while one is queued is refused.
	if _, err := h.svc.ResyncSite(ctx, h.user, site.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.ResyncSite(ctx, h.user, site.ID); linkCode(err) != knowledge.LinkBusy {
		t.Fatalf("a second re-sync: %v", err)
	}
}

func TestSiteAPagePastTheCrawlIsMarkedOnlyWhenTheCrawlFinishes(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	ctx := context.Background()
	h.site.set("/docs/", docPage("Home", "a"))
	h.site.set("/docs/a", docPage("A"))
	site := h.addSite(t, "https://example.com/docs/", 1, 10)

	// A crawl that stops after the first page (cancelled) marks nothing.
	jobID, err := h.svc.ResyncSite(ctx, h.user, site.ID)
	if err != nil {
		t.Fatal(err)
	}
	stop := errors.New("cancelled")
	err = h.svc.RunCrawl(ctx, h.user, site.ID, jobID, func(ctx context.Context, total int, unit func(context.Context, int) (int, error)) error {
		if _, err := unit(ctx, 0); err != nil {
			return err
		}
		return stop
	})
	if !errors.Is(err, stop) {
		t.Fatal(err)
	}
	h.svc.FailCrawl(ctx, h.user, site.ID, err, true)
	s, _, _ := h.svc.GetSite(ctx, h.user, site.ID)
	if s.Status != knowledge.SiteCancelled || s.Removed != 0 {
		t.Fatalf("cancelled crawl: %+v", s)
	}
}

func containsID(ids []uuid.UUID, id uuid.UUID) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

// ───────────────────────────────────────────────────────── repositories

type fakeRepoHost struct {
	mu      sync.Mutex
	sha     string
	files   map[string]string
	private bool
	// accept is the token GitHub honours; tokens is what the learner saved.
	accept string
	tokens fakeTokens
	hits   map[string]int
}

func (f *fakeRepoHost) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.hits[r.Host+r.URL.Path]++
	switch {
	case strings.HasSuffix(r.URL.Path, ".git/info/refs"):
		if f.private && r.Header.Get("Authorization") != "Basic "+basic(f.accept) {
			http.Error(w, "auth for "+f.tokens.token, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/x-git-upload-pack-advertisement")
		pkt := func(s string) string { return fmt.Sprintf("%04x%s", len(s)+4, s) }
		_, _ = w.Write([]byte(pkt("# service=git-upload-pack\n") + "0000" +
			pkt(f.sha+" HEAD\x00symref=HEAD:refs/heads/main\n") + pkt(f.sha+" refs/heads/main\n") + "0000"))
	case r.Host == "api.example.com":
		if r.Header.Get("Authorization") != "Bearer "+f.accept {
			http.Error(w, "bad credentials", http.StatusUnauthorized)
			return
		}
		http.Redirect(w, r, "https://codeload.example.com/acme/docs/legacy.tar.gz/"+f.sha+"?token=GRANT", http.StatusFound)
	case r.Host == "codeload.example.com":
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		tw := tar.NewWriter(gz)
		for p, body := range f.files {
			_ = tw.WriteHeader(&tar.Header{Name: "docs-" + f.sha + "/" + p, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))})
			_, _ = tw.Write([]byte(body))
		}
		_ = tw.Close()
		_ = gz.Close()
		w.Header().Set("Content-Type", "application/x-gzip")
		_, _ = w.Write(buf.Bytes())
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeRepoHost) hit(key string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hits[key]
}

func (f *fakeRepoHost) commit(sha string, files map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sha, f.files = sha, files
}

func (h *sourceHarness) syncRepo(t *testing.T, repoID, jobID uuid.UUID) *knowledge.RepoSyncResult {
	t.Helper()
	res, err := h.svc.SyncRepo(context.Background(), h.user, repoID, jobID)
	if err != nil {
		t.Fatalf("sync: %v", err)
	}
	h.parseQueued(t)
	return res
}

func repoFiles(t *testing.T, h *sourceHarness, repoID uuid.UUID) map[string]knowledge.Document {
	t.Helper()
	_, docs, err := h.svc.GetRepo(context.Background(), h.user, repoID)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]knowledge.Document{}
	for _, d := range docs {
		out[d.SourcePath] = d
	}
	return out
}

const (
	sha1 = "1111111111111111111111111111111111111111"
	sha2 = "2222222222222222222222222222222222222222"
)

func TestARepositoryImportsDocsAndCodeAndResyncsBySHA(t *testing.T) {
	h := newSourceHarness(t, "140.82.112.3")
	ctx := context.Background()
	h.gh.commit(sha1, map[string]string{
		"README.md":                 "# Project\n\nTop-level readme, outside the folder.\n",
		"docs/intro.md":             "# Intro\n\nThe framework renders pages.\n",
		"docs/guide.rst":            "Guide\n=====\n\nHow to configure it.\n",
		"docs/old.md":               "# Old\n\nDeprecated page.\n",
		"docs/node_modules/x/a.md":  "# dependency\n",
		"docs/examples/main.go":     "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n\nfunc helper() int {\n\treturn 1\n}\n",
		"docs/drafts/unfinished.md": "# Draft\n",
	})

	repo, jobID, err := h.svc.AddRepo(ctx, h.user, h.kb.ID, knowledge.NewRepo{
		URL: "https://github.com/acme/docs/tree/main/docs", Extensions: []string{"md", ".rst", ".GO"},
		Ignore: []string{"drafts/"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.PathPrefix != "docs" || repo.Branch != "main" || strings.Join(repo.Extensions, " ") != ".go .md .rst" {
		t.Fatalf("repo = %+v", repo)
	}
	res := h.syncRepo(t, repo.ID, jobID)
	files := repoFiles(t, h, repo.ID)
	if res.Added != 4 || len(files) != 4 {
		t.Fatalf("first sync %+v, files %v", res, files)
	}
	for _, p := range []string{"docs/intro.md", "docs/guide.rst", "docs/old.md", "docs/examples/main.go"} {
		if _, ok := files[p]; !ok {
			t.Fatalf("%s missing", p)
		}
	}
	code := files["docs/examples/main.go"]
	if code.PageUnit != knowledge.PageUnitLine || code.SourceKind != knowledge.SourceRepoFile ||
		code.SourceURL != "https://github.com/acme/docs/blob/main/docs/examples/main.go" {
		t.Fatalf("code file %+v", code)
	}
	if files["docs/intro.md"].PageUnit != knowledge.PageUnitPage {
		t.Fatal("a doc file is cited by line")
	}

	// The code file parsed into blank-line chunks cited by line range.
	chunks, err := pg.NewChunkStore(testutil.TestDB(t)).ChunkTexts(ctx, h.user, code.ID)
	if err != nil || len(chunks) == 0 {
		t.Fatalf("chunks %v %v", chunks, err)
	}
	if chunks[0].HeadingPath != "docs/examples/main.go" || chunks[0].PageStart != 1 ||
		!strings.Contains(chunks[0].Text, "docs/examples/main.go (lines 1-") {
		t.Fatalf("code chunk %+v", chunks[0])
	}

	// The same commit does no work: no tarball, no parse.
	tarHits, parses := h.gh.hit("codeload.example.com/acme/docs/tar.gz/"+sha1), len(h.jobs.parses())
	jobID, err = h.svc.ResyncRepo(ctx, h.user, repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res := h.syncRepo(t, repo.ID, jobID); !res.Skipped {
		t.Fatalf("same SHA: %+v", res)
	}
	if h.gh.hit("codeload.example.com/acme/docs/tar.gz/"+sha1) != tarHits || len(h.jobs.parses()) != parses {
		t.Fatal("a re-sync at the same commit downloaded or re-indexed")
	}

	// A new commit: intro changes, old.md is deleted, guide is untouched.
	h.gh.commit(sha2, map[string]string{
		"docs/intro.md":         "# Intro\n\nThe framework renders pages, now faster.\n",
		"docs/guide.rst":        "Guide\n=====\n\nHow to configure it.\n",
		"docs/examples/main.go": "package main\n\nfunc main() {\n\tprintln(\"hi\")\n}\n\nfunc helper() int {\n\treturn 1\n}\n",
	})
	jobID, err = h.svc.ResyncRepo(ctx, h.user, repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	res = h.syncRepo(t, repo.ID, jobID)
	if res.Changed != 1 || res.Unchanged != 2 || res.Removed != 1 || res.Added != 0 {
		t.Fatalf("second sync %+v", res)
	}
	reindexed := h.jobs.parses()[parses:]
	if len(reindexed) != 1 || reindexed[0] != files["docs/intro.md"].ID {
		t.Fatalf("re-indexed %v; want intro.md only", reindexed)
	}
	after := repoFiles(t, h, repo.ID)
	if after["docs/old.md"].RemovedAt == nil || after["docs/intro.md"].RemovedAt != nil {
		t.Fatalf("removal marks: old %v, intro %v", after["docs/old.md"].RemovedAt, after["docs/intro.md"].RemovedAt)
	}
	got, _, _ := h.svc.GetRepo(ctx, h.user, repo.ID)
	if got.CommitSHA != sha2 || got.ResolvedBranch != "main" || got.FileCount != 3 || got.Removed != 1 || got.Status != knowledge.RepoReady {
		t.Fatalf("repo after sync %+v", got)
	}

	// Deleting the repository deletes its documents.
	if err := h.svc.DeleteRepo(ctx, h.user, repo.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.store.GetDocument(ctx, h.user, code.ID); err == nil {
		t.Fatal("a file outlived its repository")
	}
}

func TestAPrivateRepositoryUsesTheLearnersTokenAndNeverShowsIt(t *testing.T) {
	h := newSourceHarness(t, "140.82.112.3")
	ctx := context.Background()
	h.gh.private = true
	h.gh.accept = "github_pat_SECRETVALUE123"
	h.gh.commit(sha1, map[string]string{"guide.md": "# Guide\n\nPrivate docs.\n"})

	// No token: refused with a sentence that says what to do.
	repo, jobID, err := h.svc.AddRepo(ctx, h.user, h.kb.ID, knowledge.NewRepo{URL: "https://github.com/acme/docs"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.svc.SyncRepo(ctx, h.user, repo.ID, jobID)
	if !knowledge.IsTerminal(err) || !strings.Contains(err.Error(), "GitHub token") {
		t.Fatalf("private without a token: %v", err)
	}
	h.svc.FailRepoSync(ctx, h.user, repo.ID, err)

	// A token: imported.
	h.gh.tokens.token = "github_pat_SECRETVALUE123"
	jobID, err = h.svc.ResyncRepo(ctx, h.user, repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res := h.syncRepo(t, repo.ID, jobID); res.Added != 1 {
		t.Fatalf("private with a token: %+v", res)
	}

	// A token GitHub refuses: the stored error never carries it.
	h.gh.commit(sha2, map[string]string{"guide.md": "# Guide\n\nPrivate docs, revised.\n"})
	h.gh.tokens.token = "github_pat_WRONGSECRET999"
	jobID, err = h.svc.ResyncRepo(ctx, h.user, repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = h.svc.SyncRepo(ctx, h.user, repo.ID, jobID)
	if err == nil {
		t.Fatal("a refused token synced")
	}
	h.svc.FailRepoSync(ctx, h.user, repo.ID, err)
	got, _, _ := h.svc.GetRepo(ctx, h.user, repo.ID)
	for _, s := range []string{err.Error(), fmt.Sprintf("%+v", err), got.Error, got.Note} {
		if strings.Contains(s, "SECRET") || strings.Contains(s, "GRANT") {
			t.Fatalf("a token reached an error: %q", s)
		}
	}
	if got.Status != knowledge.RepoFailed || got.CommitSHA != sha1 || got.FileCount != 1 {
		t.Fatalf("a failed sync keeps the last good one: %+v", got)
	}
}

func basic(token string) string {
	return base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
}

func TestADisallowedStartPageIsNeverFetched(t *testing.T) {
	h := newSourceHarness(t, "93.184.216.34")
	h.site.set("/docs/internal/", docPage("Internal", "a"))
	h.site.robots = "User-agent: AnyTools\nDisallow: /docs/internal/\n"
	site := h.addSite(t, "https://example.com/docs/internal/", 1, 10)
	pages := pagesByURL(t, h, site.ID)
	p := pages["/docs/internal/"]
	if p.Status != knowledge.PageSkipped || !strings.Contains(p.Reason, "robots.txt") || p.DocumentID != nil {
		t.Fatalf("disallowed start page: %+v", p)
	}
	if n := h.site.count("/docs/internal/"); n != 0 {
		t.Fatalf("the disallowed page was fetched %d times", n)
	}
}
