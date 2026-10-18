package app

// links_e2e_test.go — AC4, end to end, through the wiring (learning-depth
// phase 4).
//
// A web page link becomes a ready, citable document; a YouTube video whose
// captions YouTube refuses to this server becomes ready from a pasted
// transcript, and its citation names the second the cited segment starts; the
// same video is transcribed by the learner's own Gemini key through the REAL
// byok chain and the transcribe_video job.
//
// Three things are scripted, all of them somebody else's server: the web (a
// TLS fixture answering as example.com through the fetch guard's dialer),
// YouTube (answering 403, as it does to cloud addresses, from the recorded
// fixtures), and Gemini's native generateContent (answering the recorded
// response shape). No live YouTube or Gemini call is made.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/citations"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

const notesPage = `<!doctype html><html><head><title>Notes on RAG</title></head><body><article>
<h1>Notes on RAG</h1>
<p>Retrieval-augmented generation combines parametric memory, the knowledge stored in a model's weights,
with non-parametric memory, a dense index of passages the model retrieves at answer time.</p>
<p>Because the parametric memory is fixed after training, the retriever is what keeps answers current.</p>
</article></body></html>`

// scriptedLinks is the web and YouTube a link test sees.
type scriptedLinks struct {
	site *httptest.Server
	yt   *httptest.Server
}

func newScriptedLinks(t *testing.T) (*scriptedLinks, *linkDeps) {
	t.Helper()
	site := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rag-notes":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, notesPage)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(site.Close)
	addr := site.Listener.Addr().String()
	fetch := security.FetchClientWith(10*time.Second, security.GuardedDialer{
		Lookup: func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
	})
	fetch.Transport.(*http.Transport).TLSClientConfig = site.Client().Transport.(*http.Transport).TLSClientConfig.Clone()

	// YouTube as a VPS sees it: oEmbed answers, everything else is refused.
	yt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oembed" {
			raw, err := os.ReadFile("../connectors/youtube/testdata/oembed.json")
			if err != nil {
				t.Error(err)
			}
			_, _ = w.Write(raw)
			return
		}
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(yt.Close)
	host := strings.TrimPrefix(yt.URL, "http://")
	return &scriptedLinks{site: site, yt: yt}, &linkDeps{
		fetch:   fetch,
		youtube: &youtube.Client{HTTP: security.AllowlistClientOver(yt.Client(), host), Base: yt.URL},
	}
}

func newLinksE2E(t *testing.T) (*e2e, uuid.UUID) {
	t.Helper()
	model := newFakeModel(t)
	_, links := newScriptedLinks(t)
	e := buildE2EFull(t, model.server.URL, []string{"chat"}, nil, webDeps{}, links)
	e.model = model
	kbID := uuid.MustParse(e.json(http.MethodPost, "/v1/kb",
		map[string]string{"name": "Links"}, http.StatusCreated)["id"].(string))
	return e, kbID
}

// askForASource runs one grounded chat turn and returns its first chip.
func (e *e2e) askForASource(kbID uuid.UUID) citations.Source {
	e.t.Helper()
	session := e.json(http.MethodPost, "/v1/chat/sessions", map[string]any{
		"title": "links", "kb_ids": []string{kbID.String()},
	}, http.StatusCreated)
	turn := e.json(http.MethodPost, "/v1/chat/sessions/"+session["id"].(string)+"/turns",
		map[string]any{"message": "What is parametric memory?"}, http.StatusAccepted)
	var sources []citations.Source
	for _, f := range e.readTurnStream(turn["turn_id"].(string)) {
		switch f.event {
		case "sources":
			raw, _ := json.Marshal(f.data["metadata"].(map[string]any)["sources"])
			_ = json.Unmarshal(raw, &sources)
		case "stream_error":
			e.t.Fatalf("the turn failed: %v", f.data["content"])
		}
	}
	if len(sources) == 0 {
		e.t.Fatal("no sources: the answer cited nothing")
	}
	return sources[0]
}

func TestAWebLinkBecomesAReadyCitableDocument(t *testing.T) {
	e, kbID := newLinksE2E(t)

	added := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://example.com/rag-notes"}, http.StatusAccepted)
	doc := added["document"].(map[string]any)
	if doc["source_kind"] != "web" || doc["source_url"] != "https://example.com/rag-notes" || doc["title"] != "Notes on RAG" {
		t.Fatalf("document = %v", doc)
	}
	e.drainJobs()
	got := e.json(http.MethodGet, "/v1/documents/"+doc["id"].(string), nil, http.StatusOK)["document"].(map[string]any)
	if got["status"] != "ready" {
		t.Fatalf("status = %v (%v)", got["status"], got["error"])
	}

	chip := e.askForASource(kbID)
	if chip.DocumentID != doc["id"] || chip.Page != 1 || chip.Seconds != nil {
		t.Fatalf("chip = %+v", chip)
	}
	content := e.json(http.MethodGet, fmt.Sprintf("/v1/documents/%s/content?page=1", chip.DocumentID), nil, http.StatusOK)
	page := content["pages"].([]any)[0].(map[string]any)["markdown"].(string)
	if !containsNormalised(page, e.model.quotedText()) {
		t.Fatalf("the cited passage is not on the page:\n%s", page)
	}

	// The same link again is refused as a duplicate, and PATCH turns sync on.
	if st := e.status(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://example.com/rag-notes#again"}); st != http.StatusConflict {
		t.Fatalf("duplicate link: %d", st)
	}
	patched := e.json(http.MethodPatch, "/v1/documents/"+chip.DocumentID, map[string]any{"auto_sync": true}, http.StatusOK)
	if patched["document"].(map[string]any)["auto_sync"] != true {
		t.Fatalf("patch: %v", patched)
	}
	resynced := e.json(http.MethodPost, "/v1/documents/"+chip.DocumentID+"/resync", nil, http.StatusAccepted)
	if resynced["changed"] != false {
		t.Fatalf("an unchanged page re-indexed: %v", resynced)
	}
}

func TestAPastedTranscriptMakesABlockedVideoCitableToTheSecond(t *testing.T) {
	e, kbID := newLinksE2E(t)

	added := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://youtu.be/jNQXAC9IVRw"}, http.StatusAccepted)
	doc := added["document"].(map[string]any)
	id := doc["id"].(string)
	if doc["status"] != "needs_transcript" || doc["title"] != "Me at the zoo" {
		t.Fatalf("blocked video = %v", doc)
	}
	// No Gemini key on the parse route: the page offers upload and paste only.
	view := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)
	if tr := view["transcribe"].(map[string]any); tr["available"] != false || tr["free_tier_daily_seconds"] != float64(8*3600) {
		t.Fatalf("transcribe = %v", tr)
	}
	if st := e.status(http.MethodPost, "/v1/documents/"+id+"/transcribe", nil); st != http.StatusConflict {
		t.Fatalf("transcribe without a Gemini key: %d", st)
	}

	// Ten minutes of talk about elephants, then the answer at 10:00: the
	// cited passage starts well into the video, so "maps to a second" is
	// tested at a second that is not zero.
	var paste strings.Builder
	for s := 0; s < 600; s += 8 {
		fmt.Fprintf(&paste, "[%s] The elephants at the zoo walk slowly around the enclosure while the keeper "+
			"explains how much they eat each day, how they sleep standing up, and why their trunks are so long.\n",
			youtube.FormatClock(float64(s)))
	}
	paste.WriteString("[10:00] Parametric memory is the knowledge stored in a model's weights, and it does not change after training.\n")
	paste.WriteString("[10:20] That is pretty much all there is to say.")
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcript", map[string]any{"text": paste.String()}, http.StatusAccepted)
	e.drainJobs()

	view = e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)
	got := view["document"].(map[string]any)
	if got["status"] != "ready" || got["transcript_source"] != "learner" {
		t.Fatalf("after paste: %v", got)
	}

	chip := e.askForASource(kbID)
	if chip.DocumentID != id || chip.Seconds == nil || *chip.Seconds == 0 || chip.AITranscript {
		t.Fatalf("chip = %+v", chip)
	}
	timeline := got["timeline"].([]any)
	start := int(timeline[chip.Page-1].([]any)[0].(float64))
	if *chip.Seconds != start {
		t.Fatalf("chip opens at %d s, the cited page starts at %d s", *chip.Seconds, start)
	}
	// The chip opens the player where its page starts, and that page is the
	// one whose [MM:SS] says so. A chunk can run over into the next segment
	// (the chunker's overlap), so the quote is looked for from the cited page on.
	content := e.json(http.MethodGet, "/v1/documents/"+id+"/content", nil, http.StatusOK)
	var from strings.Builder
	for _, p := range content["pages"].([]any) {
		pg := p.(map[string]any)
		if n := int(pg["page"].(float64)); n == chip.Page {
			if md := pg["markdown"].(string); !strings.HasPrefix(md, "["+youtube.FormatClock(float64(start))+"]") {
				t.Fatalf("page %d does not start at %d s: %q", n, start, md)
			}
		}
		if int(pg["page"].(float64)) >= chip.Page {
			from.WriteString(pg["markdown"].(string) + " ")
		}
	}
	if !containsNormalised(from.String(), e.model.quotedText()) {
		t.Fatalf("the quote %q is not in the video from page %d on", e.model.quotedText(), chip.Page)
	}
}

// geminiUpstream is Gemini's native API as the recorded shape: it checks what
// arrives and answers testdata/gemini_response.json.
type geminiUpstream struct {
	server *httptest.Server
	mu     sync.Mutex
	bodies []map[string]any
	keys   []string
}

func newGeminiUpstream(t *testing.T) *geminiUpstream {
	g := &geminiUpstream{}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, ":generateContent") {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		g.mu.Lock()
		g.bodies = append(g.bodies, body)
		g.keys = append(g.keys, r.Header.Get("x-goog-api-key"))
		g.mu.Unlock()
		resp, err := os.ReadFile("../connectors/youtube/testdata/gemini_response.json")
		if err != nil {
			t.Error(err)
		}
		_, _ = w.Write(resp)
	}))
	t.Cleanup(g.server.Close)
	return g
}

func TestAGeminiTranscriptThroughTheRealChainIsLabelled(t *testing.T) {
	e, kbID := newLinksE2E(t)
	gemini := newGeminiUpstream(t)

	// The learner's parse route holds their own Gemini API key.
	ctx := context.Background()
	key := testutil.TestEncryptionKey
	conn, err := pg.NewProviderConnectionStore(e.pool, key).CreateConnection(ctx, e.user, store.NewProviderConnection{
		Provider: "gemini", Kind: store.KindAPIKey, Name: "mine", APIBase: gemini.server.URL, Secret: "AIza-learner-key"})
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.NewFunctionRouteStore(e.pool, key).ReplaceRoute(ctx, e.user, "parse",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "gemini-3.6-flash"}}); err != nil {
		t.Fatal(err)
	}

	doc := e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links",
		map[string]any{"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"}, http.StatusAccepted)["document"].(map[string]any)
	id := doc["id"].(string)
	if tr := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["transcribe"].(map[string]any); tr["available"] != true {
		t.Fatalf("transcribe = %v", tr)
	}
	job := e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", nil, http.StatusAccepted)["job_id"].(string)
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	if got["status"] != "ready" || got["transcript_source"] != "ai_transcript" {
		t.Fatalf("after transcription: %v", got)
	}
	if pb := got["processed_by"].(map[string]any); pb["parser"] != "gemini" || pb["model"] != "gemini-3.6-flash" {
		t.Fatalf("processed_by = %v", pb)
	}

	// What reached Google: the watch URL as file_data.file_uri, low media
	// resolution, the transcript prompt, and the learner's key.
	if len(gemini.bodies) != 1 || gemini.keys[0] != "AIza-learner-key" {
		t.Fatalf("%d calls, keys %v", len(gemini.bodies), gemini.keys)
	}
	parts := gemini.bodies[0]["contents"].([]any)[0].(map[string]any)["parts"].([]any)
	if parts[0].(map[string]any)["file_data"].(map[string]any)["file_uri"] != "https://www.youtube.com/watch?v=jNQXAC9IVRw" ||
		gemini.bodies[0]["generationConfig"].(map[string]any)["mediaResolution"] != "MEDIA_RESOLUTION_LOW" ||
		!strings.Contains(parts[1].(map[string]any)["text"].(string), "verbatim") {
		t.Fatalf("request = %v", gemini.bodies[0])
	}
	// One billed call, recorded on the job for the UI.
	if n := e.scalar(`SELECT (progress->>'billed')::int FROM jobs WHERE id = $1`, job); n != 1 {
		t.Fatalf("billed = %d", n)
	}

	content := e.json(http.MethodGet, "/v1/documents/"+id+"/content?page=1", nil, http.StatusOK)
	if page := content["pages"].([]any)[0].(map[string]any)["markdown"].(string); !strings.HasPrefix(page, "[00:01] All right") {
		t.Fatalf("page 1 = %q", page)
	}
}

// The link routes, against Alice's REAL link documents (the isolation
// harness's seeded document is an upload): Bob's requests, with bodies that
// pass validation, are answered exactly as a nonexistent id is, and change
// nothing.
func TestLinkRoutesAnswerAForeignLinkLikeAMissingOne(t *testing.T) {
	e, kbID := newLinksE2E(t)
	e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links", map[string]any{"url": "https://example.com/rag-notes"}, http.StatusAccepted)
	e.json(http.MethodPost, "/v1/kb/"+kbID.String()+"/links", map[string]any{"url": "https://youtu.be/jNQXAC9IVRw"}, http.StatusAccepted)
	e.drainJobs()
	docs := e.json(http.MethodGet, "/v1/kb/"+kbID.String()+"/documents", nil, http.StatusOK)["documents"].([]any)
	byKind := map[string]string{}
	for _, d := range docs {
		m := d.(map[string]any)
		byKind[m["source_kind"].(string)] = m["id"].(string)
	}
	before := e.scalar(`SELECT count(*) FROM documents WHERE user_id = $1 AND status IN ('ready','needs_transcript') AND NOT auto_sync`, e.user)

	bob := e.as(testutil.NewUser(t, e.pool))
	probes := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/v1/kb/" + kbID.String() + "/links", map[string]any{"url": "https://example.com/other"}},
		{http.MethodGet, "/v1/documents/" + byKind["youtube"], nil},
		{http.MethodPatch, "/v1/documents/" + byKind["web"], map[string]any{"auto_sync": true}},
		{http.MethodPost, "/v1/documents/" + byKind["web"] + "/resync", nil},
		{http.MethodPost, "/v1/documents/" + byKind["youtube"] + "/transcript", map[string]any{"text": "[00:00] hijacked"}},
		{http.MethodPost, "/v1/documents/" + byKind["youtube"] + "/transcribe", nil},
	}
	for _, p := range probes {
		got := bob.status(p.method, p.path, p.body)
		fake := strings.NewReplacer(kbID.String(), uuid.NewString(), byKind["web"], uuid.NewString(),
			byKind["youtube"], uuid.NewString()).Replace(p.path)
		if got != http.StatusNotFound || bob.status(p.method, fake, p.body) != got {
			t.Errorf("%s %s as another user: %d", p.method, p.path, got)
		}
	}
	after := e.scalar(`SELECT count(*) FROM documents WHERE user_id = $1 AND status IN ('ready','needs_transcript') AND NOT auto_sync`, e.user)
	if before != 2 || after != 2 {
		t.Fatalf("alice's link documents changed: %d before, %d after", before, after)
	}
}
