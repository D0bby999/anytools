package knowledge_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/blob"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/knowledge"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Links are tested against the real document store: the behaviours that
// matter here (URL uniqueness, file-only content hashes, the auto-sync cap,
// per-row sync errors) are the migration's, and a fake would assert its own
// idea of them.

// site is a fixture web server reached as https://example.com through the
// production fetch client's shape (guarded dialer, redirect cap).
type site struct {
	mu     sync.Mutex
	bodies map[string]string
	status map[string]int
	hits   map[string]int
	robots string
}

func (s *site) set(path, body string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.bodies[path] = body
	delete(s.status, path)
}

func (s *site) fail(path string, status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status[path] = status
}

func (s *site) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.hits[r.URL.Path]++
	switch {
	case r.URL.Path == "/robots.txt":
		if s.robots == "" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(s.robots))
		return
	case strings.HasPrefix(r.URL.Path, "/hop/"):
		var n int
		_, _ = fmt.Sscanf(r.URL.Path, "/hop/%d", &n)
		if n > 0 {
			http.Redirect(w, r, fmt.Sprintf("/hop/%d", n-1), http.StatusFound)
			return
		}
	case r.URL.Path == "/huge":
		w.Header().Set("Content-Type", "text/html")
		chunk := strings.Repeat("<p>x</p>", 1<<17)
		for i := 0; i < 6; i++ {
			_, _ = w.Write([]byte(chunk))
		}
		return
	}
	if st, ok := s.status[r.URL.Path]; ok {
		w.WriteHeader(st)
		return
	}
	body, ok := s.bodies[r.URL.Path]
	if !ok && strings.HasPrefix(r.URL.Path, "/hop/") {
		body, ok = "<html><title>Landed</title><body><p>End of the chain.</p></body></html>", true
	}
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(body))
}

func page(title, text string) string {
	return "<!doctype html><html><head><title>" + title + "</title></head><body><article><h1>" + title +
		"</h1><p>" + text + "</p><p>Retrieval pairs a model with an index of passages, and every answer cites one.</p></article></body></html>"
}

type linkHarness struct {
	svc     *knowledge.Service
	store   *pg.KnowledgeStore
	jobs    *memJobs
	objects *blob.Local
	site    *site
	yt      *httptest.Server
	ytMode  *string
	gemini  *fakeTranscribers
	user    uuid.UUID
	kb      *knowledge.KB
	now     time.Time
}

func newLinkHarness(t *testing.T) *linkHarness {
	t.Helper()
	pool := testutil.TestDB(t)
	st := &site{bodies: map[string]string{}, status: map[string]int{}, hits: map[string]int{}}
	srv := httptest.NewTLSServer(st)
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
	// httptest's certificate is issued for example.com, which is the host
	// every fixture URL names.
	fetch.Transport.(*http.Transport).TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig.Clone()

	mode := "blocked"
	yt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		read := func(name string) []byte {
			b, err := os.ReadFile(filepath.Join("..", "connectors", "youtube", "testdata", name))
			if err != nil {
				t.Fatal(err)
			}
			return b
		}
		switch {
		case r.URL.Path == "/oembed":
			_, _ = w.Write(read("oembed.json"))
		case mode == "blocked":
			w.WriteHeader(http.StatusForbidden)
		case r.URL.Path == "/watch":
			_, _ = w.Write(read("watch_page.html"))
		case r.URL.Path == "/youtubei/v1/player":
			_, _ = w.Write(read("player_ok.json"))
		case r.URL.Path == "/api/timedtext":
			_, _ = w.Write(read("captions_srv3.xml"))
		}
	}))
	t.Cleanup(yt.Close)

	blobs, err := blob.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := &linkHarness{
		store: pg.NewKnowledgeStore(pool), jobs: &memJobs{}, objects: blobs, site: st,
		yt: yt, ytMode: &mode, gemini: &fakeTranscribers{}, user: testutil.NewUser(t, pool),
		// Microseconds, as Postgres keeps them: Linux clocks carry nanoseconds.
		now: time.Now().UTC().Truncate(time.Microsecond),
	}
	h.svc = knowledge.NewService(knowledge.Config{
		Store: h.store, Chunks: pg.NewChunkStore(pool), Blobs: blobs, Jobs: h.jobs,
		Providers: &fakeProviders{embedder: newFakeEmbedder("fake-embed", 768)},
		Links: &knowledge.LinkConfig{
			Store: h.store, Fetch: fetch,
			YouTube:      &youtube.Client{HTTP: yt.Client(), Base: yt.URL},
			Transcribers: h.gemini, Objects: blobs,
			Now: func() time.Time { return h.now },
		},
	})
	h.kb, err = h.svc.CreateKB(context.Background(), h.user, "Links")
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// parse runs the parse_document job the way the worker would.
func (h *linkHarness) parse(t *testing.T, doc *knowledge.Document) *knowledge.Document {
	t.Helper()
	err := h.svc.ProcessDocument(context.Background(), h.user,
		knowledge.ParseJobPayload{DocumentID: doc.ID, KBID: doc.KBID}, knowledge.Attempt{Number: 1, Max: 3})
	if err != nil {
		t.Fatalf("ProcessDocument: %v", err)
	}
	got, err := h.store.GetDocument(context.Background(), h.user, doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != knowledge.StatusReady {
		t.Fatalf("status = %s (%s)", got.Status, got.Error)
	}
	return got
}

func linkCode(err error) string {
	var le *knowledge.LinkError
	if errors.As(err, &le) {
		return le.Code
	}
	return ""
}

type fakeTranscribers struct {
	available bool
	fail      error
	calls     []youtube.Window
}

func (f *fakeTranscribers) TranscriberAvailable(context.Context, uuid.UUID) (bool, error) {
	return f.available, nil
}

func (f *fakeTranscribers) TranscribeWindow(_ context.Context, _ uuid.UUID, id string, w youtube.Window) (*youtube.Part, int, error) {
	f.calls = append(f.calls, w)
	if f.fail != nil {
		return nil, 1, f.fail
	}
	return &youtube.Part{Language: "en", Model: "gemini-test", Cues: []youtube.Cue{
		{Start: float64(w.Start) + 1, End: float64(w.Start) + 4, Text: "An AI heard this in " + id + "."},
		{Start: float64(w.Start) + 30, End: float64(w.Start) + 33, Text: "And then this."},
	}}, 1, nil
}

func TestAWebLinkBecomesAReadyCitableDocument(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	h.site.set("/article", page("How RAG works", "Retrieval-augmented generation grounds answers."))

	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://EXAMPLE.com/article#intro", false)
	if err != nil {
		t.Fatal(err)
	}
	doc := res.Document
	if doc.SourceKind != knowledge.SourceWeb || doc.SourceURL != "https://example.com/article" ||
		doc.Title != "How RAG works" || doc.MIME != "text/html" || doc.Status != knowledge.StatusQueued {
		t.Fatalf("doc = %+v", doc)
	}
	ready := h.parse(t, doc)
	content, err := h.svc.DocumentContent(ctx, h.user, ready.ID, 0)
	if err != nil || len(content.Pages) != 1 || !strings.Contains(content.Pages[0].Markdown, "grounds answers") {
		t.Fatalf("content = %+v %v", content, err)
	}

	// The same page again is the same document, however it is spelled.
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/article", false); !knowledge.IsDuplicateDocument(err) {
		t.Fatalf("duplicate: %v", err)
	}
}

func TestAddLinkRefusesWhatItMustNotFetch(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	h.site.robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: OtherBot\nDisallow: /\n"
	h.site.set("/private/secret", page("Secret", "x"))
	h.site.set("/private/ok", page("Allowed", "x"))

	cases := map[string]string{
		"https://example.com/huge":           knowledge.LinkTooLarge, // over 5 MB, no Content-Length
		"https://example.com/hop/4":          knowledge.LinkFetchFailed,
		"https://example.com/private/secret": knowledge.LinkRobots,
		"http://example.com/article":         knowledge.LinkBadURL, // https only
		"https://127.0.0.1/":                 knowledge.LinkBadURL,
		"https://www.youtube.com/@jawed":     knowledge.LinkBadURL, // a YouTube page that is no video
		"ftp://example.com/x":                knowledge.LinkBadURL,
	}
	for raw, want := range cases {
		if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, raw, false); linkCode(err) != want {
			t.Errorf("%s: err = %v (code %q), want %s", raw, err, linkCode(err), want)
		}
	}
	if h.site.hits["/private/secret"] != 0 {
		t.Error("a page robots.txt disallows was fetched")
	}
	// Longest match: the Allow under the Disallow wins.
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/private/ok", false); err != nil {
		t.Fatalf("allowed path: %v", err)
	}
	// Two redirects are within the fetch guard's cap.
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/hop/2", false); err != nil {
		t.Fatalf("two redirects: %v", err)
	}
	docs, _ := h.svc.ListDocuments(ctx, h.user, h.kb.ID)
	if len(docs) != 2 {
		t.Fatalf("%d documents after the refusals, want 2", len(docs))
	}
}

func TestIdenticalPagesAndTwoBlockedVideosCoexist(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	wall := page("Please accept cookies", "This site uses cookies.")
	h.site.set("/one", wall)
	h.site.set("/two", wall)

	for _, raw := range []string{
		"https://example.com/one", "https://example.com/two",
		"https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://youtu.be/bbbbbbbbbbb",
	} {
		if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, raw, false); err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
	}
	docs, _ := h.svc.ListDocuments(ctx, h.user, h.kb.ID)
	if len(docs) != 4 {
		t.Fatalf("%d documents, want 4", len(docs))
	}
	for _, d := range docs {
		if d.SourceKind == knowledge.SourceYouTube {
			if d.Status != knowledge.StatusNeedsTranscript || d.SHA256 != blob.Digest([]byte(d.SourceURL)) ||
				d.Bytes != 0 || d.MIME != "text/vtt" || d.Error == "" || d.Media.CaptionError != youtube.ReasonBlocked {
				t.Fatalf("blocked video = %+v media %+v", d, d.Media)
			}
			if d.Title != "Me at the zoo" {
				t.Fatalf("oEmbed title not used: %q", d.Title)
			}
		}
	}
	// Files keep their content-hash uniqueness.
	if _, err := h.svc.Upload(ctx, h.user, h.kb.ID, "a.txt", []byte("same bytes")); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Upload(ctx, h.user, h.kb.ID, "b.txt", []byte("same bytes")); !knowledge.IsDuplicateDocument(err) {
		t.Fatalf("duplicate file: %v", err)
	}
}

func TestATwentyFirstAutoSyncLinkIsRefused(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	for i := 0; i <= knowledge.MaxAutoSyncLinks; i++ {
		h.site.set(fmt.Sprintf("/p/%d", i), page(fmt.Sprintf("Page %d", i), fmt.Sprintf("content %d", i)))
	}
	for i := 0; i < knowledge.MaxAutoSyncLinks; i++ {
		if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, fmt.Sprintf("https://example.com/p/%d", i), true); err != nil {
			t.Fatalf("link %d: %v", i, err)
		}
	}
	last := fmt.Sprintf("https://example.com/p/%d", knowledge.MaxAutoSyncLinks)
	if _, err := h.svc.AddLink(ctx, h.user, h.kb.ID, last, true); !errors.Is(err, knowledge.ErrAutoSyncLimit) {
		t.Fatalf("21st auto-sync link: %v", err)
	}
	// Added without auto-sync it is fine; turning it on is refused the same way.
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, last, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.SetAutoSync(ctx, h.user, res.Document.ID, true); !errors.Is(err, knowledge.ErrAutoSyncLimit) {
		t.Fatalf("PATCH to a 21st: %v", err)
	}
}

func TestResyncOnlyReindexesChangedBytes(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	h.site.set("/news", page("News", "Version one."))
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/news", false)
	if err != nil {
		t.Fatal(err)
	}
	doc := h.parse(t, res.Document)
	queuedBefore := len(h.jobs.enqueued)

	_, changed, err := h.svc.ResyncWeb(ctx, h.user, doc.ID)
	if err != nil || changed {
		t.Fatalf("same bytes: changed=%v err=%v", changed, err)
	}
	same, _ := h.store.GetDocument(ctx, h.user, doc.ID)
	if same.Version != doc.Version || same.Status != knowledge.StatusReady || len(h.jobs.enqueued) != queuedBefore || same.LastSyncedAt == nil {
		t.Fatalf("an unchanged page did work: %+v, %d jobs", same, len(h.jobs.enqueued)-queuedBefore)
	}

	h.site.set("/news", page("News", "Version two, rewritten."))
	_, changed, err = h.svc.ResyncWeb(ctx, h.user, doc.ID)
	if err != nil || !changed {
		t.Fatalf("changed bytes: changed=%v err=%v", changed, err)
	}
	moved, _ := h.store.GetDocument(ctx, h.user, doc.ID)
	if moved.Version != doc.Version+1 || moved.Status != knowledge.StatusQueued || moved.SyncChanges != 1 {
		t.Fatalf("after a change: %+v", moved)
	}
	ready := h.parse(t, moved)
	content, _ := h.svc.DocumentContent(ctx, h.user, ready.ID, 1)
	if !strings.Contains(content.Pages[0].Markdown, "Version two") {
		t.Fatalf("not re-indexed: %s", content.Pages[0].Markdown)
	}
}

func TestASyncPassRecordsOnePagesFailureAndContinues(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	pool := testutil.TestDB(t)
	var ids []uuid.UUID
	for i := 1; i <= 3; i++ {
		h.site.set(fmt.Sprintf("/s/%d", i), page(fmt.Sprintf("S%d", i), "first"))
		res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, fmt.Sprintf("https://example.com/s/%d", i), true)
		if err != nil {
			t.Fatal(err)
		}
		h.parse(t, res.Document)
		ids = append(ids, res.Document.ID)
	}
	// A fourth page that changed on three syncs in a row is on the weekly
	// schedule, and two days is not a week.
	h.site.set("/s/4", page("S4", "first"))
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://example.com/s/4", true)
	if err != nil {
		t.Fatal(err)
	}
	h.parse(t, res.Document)
	weekly := res.Document.ID
	if _, err := pool.Exec(ctx, `UPDATE documents SET sync_changes = 3 WHERE id = $1`, weekly); err != nil {
		t.Fatal(err)
	}

	// Two days later, page 2 is broken and page 3 changed.
	h.now = h.now.Add(48 * time.Hour)
	h.site.fail("/s/2", http.StatusInternalServerError)
	h.site.set("/s/3", page("S3", "second"))
	hitsBefore := h.site.hits["/s/4"]

	if _, err := h.svc.SyncDueWebSources(ctx); err != nil {
		t.Fatal(err)
	}
	get := func(id uuid.UUID) *knowledge.Document {
		d, err := h.store.GetDocument(ctx, h.user, id)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	d1, d2, d3 := get(ids[0]), get(ids[1]), get(ids[2])
	if d1.SyncError != "" || !d1.LastSyncedAt.Equal(h.now) || d1.Status != knowledge.StatusReady {
		t.Errorf("page 1: %+v", d1)
	}
	if d2.SyncError != "the site answered HTTP 500" || d2.Status != knowledge.StatusReady {
		t.Errorf("page 2 should carry its own error and keep its content: %q %s", d2.SyncError, d2.Status)
	}
	if d3.Status != knowledge.StatusQueued || d3.SyncError != "" || d3.SyncChanges != 1 {
		t.Errorf("page 3 was not synced after page 2 failed: %+v", d3)
	}
	if h.site.hits["/s/4"] != hitsBefore {
		t.Error("a page on the weekly schedule was re-fetched after two days")
	}
}

func TestAVideoWithoutCaptionsTakesSubtitlesOrAPaste(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/watch?v=jNQXAC9IVRw", false)
	if err != nil {
		t.Fatal(err)
	}
	video := res.Document
	if video.Status != knowledge.StatusNeedsTranscript {
		t.Fatalf("blocked video: %+v", video)
	}

	srt := "1\n00:00:01,000 --> 00:00:04,000\nFirst line.\n\n2\n00:00:30,000 --> 00:00:33,000\nA later line.\n"
	res, err = h.svc.SetTranscript(ctx, h.user, video.ID, knowledge.TranscriptInput{Filename: "talk.srt", Data: []byte(srt)})
	if err != nil {
		t.Fatal(err)
	}
	if res.Document.TranscriptSource != knowledge.TranscriptLearner || res.Document.MIME != knowledge.TranscriptMIME ||
		len(res.Document.Timeline) != 2 || res.Document.Timeline[1] != [2]int{30, 33} {
		t.Fatalf("after upload: %+v", res.Document)
	}
	ready := h.parse(t, res.Document)
	content, _ := h.svc.DocumentContent(ctx, h.user, ready.ID, 2)
	if !strings.HasPrefix(content.Pages[0].Markdown, "[00:30] A later line.") {
		t.Fatalf("page 2 = %q", content.Pages[0].Markdown)
	}
	cues, err := h.svc.TranscriptCues(ctx, h.user, ready.ID)
	if err != nil || len(cues.Cues) != 2 {
		t.Fatalf("cues: %+v %v", cues, err)
	}

	// Replaced by a paste at any time; the parsed copy is kept until the new
	// one is ready, so the version moves.
	res, err = h.svc.SetTranscript(ctx, h.user, video.ID, knowledge.TranscriptInput{Text: "No times here. Just words."})
	if err != nil || res.Document.Timeline != nil || res.Document.Version != ready.Version+1 {
		t.Fatalf("paste: %+v %v", res, err)
	}
	// While that parse is queued, another transcript is refused.
	if _, err := h.svc.SetTranscript(ctx, h.user, video.ID, knowledge.TranscriptInput{Text: "x"}); linkCode(err) != knowledge.LinkBusy {
		t.Fatalf("busy: %v", err)
	}
	for _, in := range []knowledge.TranscriptInput{{Filename: "x.txt", Data: []byte(srt)}, {}} {
		if _, err := h.svc.SetTranscript(ctx, h.user, video.ID, in); err == nil {
			t.Fatalf("%+v accepted", in)
		}
	}
}

func TestCaptionsFetchedByTheServerAreUsedFirst(t *testing.T) {
	h := newLinkHarness(t)
	*h.ytMode = "ok"
	res, err := h.svc.AddLink(context.Background(), h.user, h.kb.ID, "https://youtu.be/jNQXAC9IVRw", false)
	if err != nil {
		t.Fatal(err)
	}
	d := res.Document
	if d.Status != knowledge.StatusQueued || d.TranscriptSource != knowledge.TranscriptCaptions ||
		d.Media.DurationSeconds != 19 || len(d.Media.Tracks) != 2 || d.Media.Language != "en" || len(d.Timeline) == 0 {
		t.Fatalf("captioned video: %+v media %+v", d, d.Media)
	}
	// The creator's description is stored with the document and read back.
	stored, err := h.svc.GetDocument(context.Background(), h.user, d.ID)
	if err != nil || !strings.HasPrefix(stored.Media.Description, "The first video on YouTube.") || stored.Media.AutoCaptions {
		t.Fatalf("stored media %+v (%v)", stored.Media, err)
	}
	h.parse(t, d)
}

func TestGeminiTranscriptionIsTheFallbackAndIsLabelled(t *testing.T) {
	h := newLinkHarness(t)
	ctx := context.Background()
	res, err := h.svc.AddLink(ctx, h.user, h.kb.ID, "https://www.youtube.com/watch?v=jNQXAC9IVRw", false)
	if err != nil {
		t.Fatal(err)
	}
	video := res.Document

	// No Gemini connection on the parse route: the learner is sent to upload
	// or paste, and nothing is queued.
	if _, err := h.svc.StartTranscription(ctx, h.user, video.ID); linkCode(err) != knowledge.LinkNoTranscriber {
		t.Fatalf("no transcriber: %v", err)
	}

	h.gemini.available = true
	if _, err := h.svc.StartTranscription(ctx, h.user, video.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.StartTranscription(ctx, h.user, video.ID); linkCode(err) != knowledge.LinkBusy {
		t.Fatalf("second click: %v", err)
	}
	p := knowledge.TranscribeJobPayload{DocumentID: video.ID}
	windows, err := h.svc.TranscriptionWindows(ctx, h.user, p)
	if err != nil || len(windows) != 1 {
		t.Fatalf("windows: %v %v", windows, err)
	}
	if _, err := h.svc.TranscribeWindow(ctx, h.user, p, 0, windows[0]); err != nil {
		t.Fatal(err)
	}
	if err := h.svc.FinishTranscription(ctx, h.user, p, len(windows)); err != nil {
		t.Fatal(err)
	}
	d, _ := h.store.GetDocument(ctx, h.user, video.ID)
	var pb knowledge.ProcessedBy
	_ = json.Unmarshal(d.ProcessedBy, &pb)
	if d.TranscriptSource != knowledge.TranscriptAI || d.Status != knowledge.StatusQueued ||
		pb.Parser != "gemini" || pb.Model != "gemini-test" {
		t.Fatalf("after transcription: %+v %s", d, d.ProcessedBy)
	}
	if _, err := h.objects.GetObject(ctx, h.user, "transcripts", uuid.NewSHA1(video.ID, []byte("window-0"))); !errors.Is(err, blob.ErrNotFound) {
		t.Fatalf("the window object outlived the transcript: %v", err)
	}
	h.parse(t, d)

	// A refused video (Gemini answers 4xx: not public) settles back to
	// needs_transcript with a sentence the learner can act on.
	res, err = h.svc.AddLink(ctx, h.user, h.kb.ID, "https://youtu.be/bbbbbbbbbbb", false)
	if err != nil {
		t.Fatal(err)
	}
	h.gemini.fail = &providers.HTTPError{Status: 400, Body: "not public"}
	if _, err := h.svc.StartTranscription(ctx, h.user, res.Document.ID); err != nil {
		t.Fatal(err)
	}
	p = knowledge.TranscribeJobPayload{DocumentID: res.Document.ID}
	_, uerr := h.svc.TranscribeWindow(ctx, h.user, p, 0, youtube.Window{})
	if !knowledge.TranscriptionRefused(uerr) {
		t.Fatalf("a 400 must be terminal: %v", uerr)
	}
	ferr := h.svc.FailTranscription(ctx, h.user, p, uerr, true, knowledge.Attempt{Number: 1, Max: 2})
	if !knowledge.IsTerminal(ferr) {
		t.Fatalf("FailTranscription: %v", ferr)
	}
	d, _ = h.store.GetDocument(ctx, h.user, res.Document.ID)
	if d.Status != knowledge.StatusNeedsTranscript || !strings.Contains(d.Error, "public videos") {
		t.Fatalf("refused: %s %q", d.Status, d.Error)
	}
}
