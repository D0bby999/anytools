package app

// transcribe_engines_e2e_test.go — up-methods phase 21, end to end through
// the wiring: a learner with no key transcribes a captionless video on the
// server's built-in Whisper within their daily minutes; a learner with a Groq
// key chooses it instead; YouTube refusing the server ends the job with the
// "blocked" reason and gives the minutes back; no audio is left on disk after
// any of it.
//
// Scripted, all of it somebody else's program: yt-dlp is a fake binary on
// PATH that writes a recorded 70-second MP3 (internal/media/testdata), the
// built-in engine is an httptest server answering like speaches (/health,
// /v1/audio/transcriptions with verbose_json), and Groq is another answering
// its recorded shape. ffmpeg is the real one; the test is skipped without it.
// No live YouTube, Groq or Whisper call is made.

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// speechServer answers like speaches or Groq, and records what it was sent.
type speechServer struct {
	server  *httptest.Server
	healthy atomic.Bool
	calls   atomic.Int32
	mu      sync.Mutex
	models  []string
	auths   []string
	files   []string
}

func newSpeechServer(t *testing.T, fixture string) *speechServer {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "providers", "stt", "testdata", fixture))
	if err != nil {
		t.Fatal(err)
	}
	s := &speechServer{}
	s.healthy.Store(true)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		if !s.healthy.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = io.WriteString(w, "OK")
	})
	// speaches answers a downloaded model's id.
	mux.HandleFunc("GET /v1/models/{id...}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"id":"`+r.PathValue("id")+`"}`)
	})
	handle := func(w http.ResponseWriter, r *http.Request) {
		s.calls.Add(1)
		_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		mr := multipart.NewReader(r.Body, params["boundary"])
		s.mu.Lock()
		for {
			p, err := mr.NextPart()
			if err != nil {
				break
			}
			data, _ := io.ReadAll(p)
			switch p.FormName() {
			case "model":
				s.models = append(s.models, string(data))
			case "file":
				s.files = append(s.files, p.FileName()+":"+string(data[:min(4, len(data))]))
			}
		}
		s.auths = append(s.auths, r.Header.Get("Authorization"))
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
	mux.HandleFunc("POST /v1/audio/transcriptions", handle)
	mux.HandleFunc("POST /openai/v1/audio/transcriptions", handle)
	s.server = httptest.NewServer(mux)
	t.Cleanup(s.server.Close)
	return s
}

// fakeYTDLPOnPath puts a yt-dlp on PATH that records its arguments and either
// writes the recorded MP3 to its output template or prints YouTube's bot
// check. The mode is a file beside it: yt-dlp runs with a bare environment.
func fakeYTDLPOnPath(t *testing.T) (dir string, setMode func(string)) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	dir = t.TempDir()
	mp3, err := filepath.Abs(filepath.Join("..", "media", "testdata", "seventy-seconds.mp3"))
	if err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
here=$(dirname "$0")
for a in "$@"; do printf '%s\n' "$a" >> "$here/args"; done
out=""; prev=""
for a in "$@"; do if [ "$prev" = "-o" ]; then out="$a"; fi; prev="$a"; done
case $(cat "$here/mode") in
  ok) cp "` + mp3 + `" "$(printf '%s' "$out" | sed 's/%(ext)s/mp3/')" ;;
  bot) echo "ERROR: [youtube] x: Sign in to confirm you're not a bot." >&2; exit 1 ;;
esac
`
	if err := os.WriteFile(filepath.Join(dir, "yt-dlp"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	setMode = func(m string) {
		if err := os.WriteFile(filepath.Join(dir, "mode"), []byte(m), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	setMode("ok")
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir, setMode
}

type engineE2E struct {
	*e2e
	kb       uuid.UUID
	builtin  *speechServer
	ytdlp    string
	setMode  func(string)
	tmpEmpty func() bool
}

func newEngineE2E(t *testing.T, sttURL bool) *engineE2E {
	t.Helper()
	ytdlp, setMode := fakeYTDLPOnPath(t)
	builtin := newSpeechServer(t, "speaches_verbose.json")
	model := newFakeModel(t)
	_, links := newScriptedLinks(t)
	if sttURL {
		links.engines = config.EnginesConfig{STTURL: builtin.server.URL, STTModel: "Systran/faster-whisper-small", STTDailyMinutes: 120}
	}
	e := buildE2EFull(t, model.server.URL, []string{"chat"}, nil, webDeps{}, links)
	e.model = model
	kb := uuid.MustParse(e.json(http.MethodPost, "/v1/kb", map[string]string{"name": "Videos"}, http.StatusCreated)["id"].(string))
	tmp := filepath.Join(e.blobRoot, "tmp")
	return &engineE2E{e2e: e, kb: kb, builtin: builtin, ytdlp: ytdlp, setMode: setMode, tmpEmpty: func() bool {
		entries, err := os.ReadDir(tmp)
		return (err == nil || os.IsNotExist(err)) && len(entries) == 0
	}}
}

// addVideo adds a captionless video (YouTube answers this server 403) and
// gives it the listed length the watch page would have carried.
func (e *engineE2E) addVideo(url string, seconds int) string {
	e.t.Helper()
	doc := e.json(http.MethodPost, "/v1/kb/"+e.kb.String()+"/links", map[string]any{"url": url}, http.StatusAccepted)["document"].(map[string]any)
	id := doc["id"].(string)
	if _, err := e.pool.Exec(e.t.Context(),
		`UPDATE documents SET media = jsonb_set(media, '{duration_seconds}', to_jsonb($2::int)) WHERE id = $1`, id, seconds); err != nil {
		e.t.Fatal(err)
	}
	return id
}

func (e *engineE2E) engines(id string) []map[string]any {
	e.t.Helper()
	tr := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["transcribe"].(map[string]any)
	var out []map[string]any
	for _, x := range tr["engines"].([]any) {
		out = append(out, x.(map[string]any))
	}
	return out
}

func (e *engineE2E) spent() int {
	return e.scalar(`SELECT coalesce(sum(seconds), 0)::int FROM stt_usage WHERE user_id = $1`, e.user)
}

func TestNoKeyLearnerTranscribesOnTheBuiltinEngine(t *testing.T) {
	e := newEngineE2E(t, true)
	id := e.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)

	// The page offers the built-in engine, with its time and today's minutes,
	// and nothing else: this learner has no key.
	engines := e.engines(id)
	if len(engines) != 1 || engines[0]["engine"] != "builtin" || engines[0]["usable"] != true ||
		engines[0]["daily_minutes"].(float64) != 120 || engines[0]["wait_minutes"].(float64) < 1 {
		t.Fatalf("engines = %v", engines)
	}
	// Nothing ran before the learner chose.
	if e.builtin.calls.Load() != 0 || e.spent() != 0 {
		t.Fatal("work happened before the learner chose an engine")
	}

	start := e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"}, http.StatusAccepted)
	if start["engine"] != "builtin" || start["queue_ahead"].(float64) != 0 {
		t.Fatalf("start = %v", start)
	}
	if e.spent() != 70 {
		t.Fatalf("booked %d seconds", e.spent())
	}
	if n := e.scalar(`SELECT count(*)::int FROM jobs WHERE id = $1 AND kind = 'transcribe_builtin'`, start["job_id"]); n != 1 {
		t.Fatal("the built-in job is not on its own kind")
	}
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	if got["status"] != "ready" || got["transcript_source"] != "ai_transcript" {
		t.Fatalf("after transcription: %v", got)
	}
	pb := got["processed_by"].(map[string]any)
	if pb["engine"] != "builtin" || pb["model"] != "Systran/faster-whisper-small" ||
		!strings.Contains(pb["note"].(string), "Whisper small on this server") {
		t.Fatalf("processed_by = %v", pb)
	}
	content := e.json(http.MethodGet, "/v1/documents/"+id+"/content?page=1", nil, http.StatusOK)
	if page := content["pages"].([]any)[0].(map[string]any)["markdown"].(string); !strings.HasPrefix(page, "[00:00] The beach was a popular spot") {
		t.Fatalf("page 1 = %q", page)
	}
	// One window of 16 kHz Opus reached the engine, keyless.
	if e.builtin.calls.Load() != 1 || e.builtin.auths[0] != "" || e.builtin.files[0] != "audio.ogg:OggS" ||
		e.builtin.models[0] != "Systran/faster-whisper-small" {
		t.Fatalf("engine saw %d calls, auth %q, files %v, models %v", e.builtin.calls.Load(), e.builtin.auths, e.builtin.files, e.builtin.models)
	}
	// yt-dlp was given the validated watch URL and nothing else variable.
	args, _ := os.ReadFile(filepath.Join(e.ytdlp, "args"))
	if !strings.HasSuffix(strings.TrimSpace(string(args)), "\nhttps://www.youtube.com/watch?v=jNQXAC9IVRw") {
		t.Fatalf("yt-dlp args %q", args)
	}
	if !e.tmpEmpty() {
		t.Fatal("audio is left on disk after a successful job")
	}
}

func TestYouTubeBlockingTheServerEndsTheJobAndGivesTheMinutesBack(t *testing.T) {
	e := newEngineE2E(t, true)
	id := e.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)
	e.setMode("bot")
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"}, http.StatusAccepted)
	e.drainJobs()

	view := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)
	doc := view["document"].(map[string]any)
	if doc["status"] != "needs_transcript" || !strings.HasPrefix(doc["error"].(string), "YouTube blocked this server") {
		t.Fatalf("after a bot check: %v", doc)
	}
	if view["transcribe"].(map[string]any)["audio_blocked"] != true {
		t.Fatal("the page is not told YouTube blocked the server")
	}
	if e.spent() != 0 {
		t.Fatalf("a refused job kept %d seconds", e.spent())
	}
	if e.builtin.calls.Load() != 0 {
		t.Fatal("the engine was called without audio")
	}
	if !e.tmpEmpty() {
		t.Fatal("the job directory survived a failed job")
	}
}

// Two jobs of 110 minutes at once against 120 minutes a day: one starts, the
// other is refused with the minutes left, and nothing is queued for it.
func TestTwoBuiltinJobsAtOnceCannotBothSpendTheDay(t *testing.T) {
	e := newEngineE2E(t, true)
	a := e.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 110*60)
	b := e.addVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ", 110*60)

	var wg sync.WaitGroup
	statuses := make([]int, 2)
	for i, id := range []string{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res := e.do(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"})
			defer res.Body.Close()
			statuses[i] = res.StatusCode
		}()
	}
	wg.Wait()
	if !(statuses[0] == http.StatusAccepted && statuses[1] == http.StatusConflict ||
		statuses[1] == http.StatusAccepted && statuses[0] == http.StatusConflict) {
		t.Fatalf("statuses %v", statuses)
	}
	if e.spent() != 110*60 {
		t.Fatalf("spent %d", e.spent())
	}
	if n := e.scalar(`SELECT count(*)::int FROM jobs WHERE user_id = $1 AND kind = 'transcribe_builtin'`, e.user); n != 1 {
		t.Fatalf("%d jobs queued", n)
	}
	// The refused video now lists the built-in engine as unusable, and why.
	refused := a
	if statuses[0] == http.StatusAccepted {
		refused = b
	}
	for _, opt := range e.engines(refused) {
		if opt["engine"] == "builtin" && (opt["usable"] != false || !strings.Contains(opt["reason"].(string), "10 of your 120")) {
			t.Fatalf("refused video's option %v", opt)
		}
	}
}

func TestAGroqKeyIsChosenInsteadThroughTheRealChain(t *testing.T) {
	e := newEngineE2E(t, true)
	groq := newSpeechServer(t, "groq_verbose.json")
	ctx := context.Background()
	key := testutil.TestEncryptionKey
	conn, err := pg.NewProviderConnectionStore(e.pool, key).CreateConnection(ctx, e.user, store.NewProviderConnection{
		Provider: "groq", Kind: store.KindAPIKey, Name: "my groq", APIBase: groq.server.URL + "/openai/v1", Secret: "gsk-learner-key"})
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.NewFunctionRouteStore(e.pool, key).ReplaceRoute(ctx, e.user, "stt",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "whisper-large-v3-turbo"}}); err != nil {
		t.Fatal(err)
	}
	id := e.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)

	var groqOpt map[string]any
	for _, opt := range e.engines(id) {
		if opt["engine"] == "byok" {
			groqOpt = opt
		}
	}
	if groqOpt == nil || groqOpt["provider"] != "groq" || groqOpt["connection_id"] != conn.ID.String() ||
		groqOpt["audio_minutes"].(float64) != 2 || groqOpt["model"] != "whisper-large-v3-turbo" {
		t.Fatalf("groq option %v", groqOpt)
	}
	e.json(http.MethodPost, "/v1/documents/"+id+"/transcribe",
		map[string]any{"engine": "byok", "connection_id": conn.ID}, http.StatusAccepted)
	if e.spent() != 0 {
		t.Fatal("the learner's own key spent built-in minutes")
	}
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/documents/"+id, nil, http.StatusOK)["document"].(map[string]any)
	pb := got["processed_by"].(map[string]any)
	if got["status"] != "ready" || pb["engine"] != "groq" || pb["model"] != "whisper-large-v3-turbo" ||
		!strings.Contains(pb["note"].(string), "your Groq key, whisper-large-v3-turbo") {
		t.Fatalf("after transcription: %v", got)
	}
	if groq.calls.Load() != 1 || groq.auths[0] != "Bearer gsk-learner-key" || e.builtin.calls.Load() != 0 {
		t.Fatalf("groq %d calls auth %v; builtin %d", groq.calls.Load(), groq.auths, e.builtin.calls.Load())
	}
	if !e.tmpEmpty() {
		t.Fatal("audio is left on disk")
	}
}

// Another learner's video answers 404 before any download or engine call, and
// another learner's connection in the body answers like a nonexistent one.
func TestAForeignVideoOrKeyAnswers404BeforeAnyWork(t *testing.T) {
	e := newEngineE2E(t, true)
	id := e.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)
	bob := testutil.NewUser(t, e.pool)

	asBob := func(path string, body any) int {
		raw, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, e.server.URL+path, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+e2eToken)
		req.Header.Set(httpx.UserIDHeader, bob.String())
		req.Header.Set("Content-Type", "application/json")
		res, err := e.server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if got := asBob("/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"}); got != http.StatusNotFound {
		t.Fatalf("bob on alice's video: %d", got)
	}
	if got := asBob("/v1/documents/"+uuid.NewString()+"/transcribe", map[string]any{"engine": "builtin"}); got != http.StatusNotFound {
		t.Fatalf("a nonexistent video: %d", got)
	}

	// Alice's video, Bob's Groq key in the body, while Alice has a Groq key
	// of her own on her route: a loose match must not fall back to hers.
	conns := pg.NewProviderConnectionStore(e.pool, testutil.TestEncryptionKey)
	bobKey, err := conns.CreateConnection(context.Background(), bob,
		store.NewProviderConnection{Provider: "groq", Kind: store.KindAPIKey, Name: "bob", Secret: "gsk-bob"})
	if err != nil {
		t.Fatal(err)
	}
	aliceKey, err := conns.CreateConnection(context.Background(), e.user,
		store.NewProviderConnection{Provider: "groq", Kind: store.KindAPIKey, Name: "alice", Secret: "gsk-alice"})
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.NewFunctionRouteStore(e.pool, testutil.TestEncryptionKey).ReplaceRoute(context.Background(), e.user, "stt",
		[]store.RouteEntryInput{{ConnectionID: aliceKey.ID, Model: "whisper-large-v3"}}); err != nil {
		t.Fatal(err)
	}
	for _, conn := range []uuid.UUID{bobKey.ID, uuid.New()} {
		res := e.do(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "byok", "connection_id": conn})
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Fatalf("connection %s: %d", conn, res.StatusCode)
		}
	}
	if _, err := os.Stat(filepath.Join(e.ytdlp, "args")); !os.IsNotExist(err) {
		t.Fatal("yt-dlp ran for a refused request")
	}
	if e.builtin.calls.Load() != 0 || e.spent() != 0 {
		t.Fatal("work was done for a refused request")
	}
}

// The built-in engine is offered only while its URL is set and /health
// answers; without it a Gemini-only learner sees the page as before.
func TestTheBuiltinEngineIsOfferedOnlyWhenConfiguredAndHealthy(t *testing.T) {
	unset := newEngineE2E(t, false)
	id := unset.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)
	if got := unset.engines(id); len(got) != 0 {
		t.Fatalf("no STT URL: engines %v", got)
	}
	res := unset.do(http.MethodPost, "/v1/documents/"+id+"/transcribe", map[string]any{"engine": "builtin"})
	res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("builtin without a URL: %d", res.StatusCode)
	}

	down := newEngineE2E(t, true)
	down.builtin.healthy.Store(false)
	id = down.addVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw", 70)
	for _, opt := range down.engines(id) {
		if opt["engine"] == "builtin" {
			t.Fatalf("an unhealthy engine is offered: %v", opt)
		}
	}
}
