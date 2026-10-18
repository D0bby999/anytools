package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/D0bby999/anytools/internal/api/httpx"
	"github.com/D0bby999/anytools/internal/capabilities/research"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/store/pg"
	"github.com/D0bby999/anytools/internal/testutil"
)

// speechFake is an OpenAI-shaped speech endpoint, shaped like Kokoro-FastAPI
// v0.9.0 when kokoro is set: GET /health, GET /v1/models/kokoro, and
// POST /v1/audio/speech answering raw PCM (0.1 s per request).
type speechFake struct {
	server  *httptest.Server
	calls   atomic.Int32
	healthy atomic.Bool
	mu      sync.Mutex
	bodies  []map[string]any
	auths   []string
}

func newSpeechFake(t *testing.T) *speechFake {
	t.Helper()
	f := &speechFake{}
	f.healthy.Store(true)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		if !f.healthy.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	})
	mux.HandleFunc("GET /v1/models/kokoro", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"id":"kokoro","object":"model","owned_by":"kokoro"}`))
	})
	mux.HandleFunc("POST /v1/audio/speech", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		f.bodies = append(f.bodies, body)
		f.auths = append(f.auths, r.Header.Get("Authorization"))
		f.mu.Unlock()
		f.calls.Add(1)
		w.Header().Set("Content-Type", "audio/pcm")
		_, _ = w.Write(make([]byte, 4800))
	})
	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

func (f *speechFake) voices() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.bodies))
	for _, b := range f.bodies {
		out = append(out, fmt.Sprint(b["voice"]))
	}
	return out
}

// scriptModel is a chat model that writes one ten-turn script.
func scriptModel(t *testing.T) *httptest.Server {
	t.Helper()
	var segments []map[string]any
	for i := 0; i < 10; i++ {
		seg := map[string]any{"speaker": "host", "text": fmt.Sprintf("Question %d about retrieval?", i/2+1), "source_ids": []string{}}
		if i%2 == 1 {
			seg = map[string]any{"speaker": "expert", "text": "Retrieval finds passages and the model writes from them.", "source_ids": []string{"S1"}}
		}
		segments = append(segments, seg)
	}
	scriptJSON, _ := json.Marshal(map[string]any{"title": "Retrieval in five minutes", "segments": segments})
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "cmpl", "object": "chat.completion", "model": "fake-1",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": string(scriptJSON)}}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
		})
	}))
	t.Cleanup(model.Close)
	return model
}

// audioE2E builds the app with the built-in Kokoro at kokoro's URL (or
// none), and a report to talk about.
func audioE2E(t *testing.T, kokoro *speechFake) (*e2e, string) {
	t.Helper()
	var links *linkDeps
	if kokoro != nil {
		links = &linkDeps{engines: config.EnginesConfig{TTSURL: kokoro.server.URL, TTSDailyMinutes: 60}}
	}
	e := buildE2EFull(t, scriptModel(t).URL, []string{"chat"}, nil, webDeps{}, links)
	report, err := pg.NewResearchStore(e.pool).InsertReport(context.Background(), research.Report{
		UserID: e.user, Query: "How does RAG work?", Mode: "quick",
		ReportMD: "Retrieval fetches passages.\n\nThe model writes an answer from them.", KBOnly: true, KBOnlyReason: "no_search_key",
	})
	if err != nil {
		t.Fatal(err)
	}
	return e, report.ID.String()
}

func (e *e2e) scriptedOverview(reportID, lang string) string {
	e.t.Helper()
	created := e.json(http.MethodPost, "/v1/audio-overviews",
		map[string]any{"report_id": reportID, "minutes": 3, "language": lang}, http.StatusAccepted)
	e.drainJobs()
	return created["id"].(string)
}

func (e *e2e) speechEngines(id string) []map[string]any {
	e.t.Helper()
	o := e.json(http.MethodGet, "/v1/audio-overviews/"+id, nil, http.StatusOK)
	if o["status"] != "script_only" {
		e.t.Fatalf("status %v", o["status"])
	}
	var out []map[string]any
	list, _ := o["engines"].([]any)
	for _, x := range list {
		out = append(out, x.(map[string]any))
	}
	return out
}

// Up-methods phase 22, end to end through the production wiring: with NO
// key, an English overview is scripted (fake chat model), offered the
// built-in Kokoro with its minutes, spoken by a Kokoro-FastAPI-shaped server
// in two distinct voices, served as one WAV, and labelled with who spoke it.
func TestANoKeyEnglishOverviewIsSpokenByTheBuiltinKokoro(t *testing.T) {
	kokoro := newSpeechFake(t)
	e, reportID := audioE2E(t, kokoro)
	id := e.scriptedOverview(reportID, "en")
	if kokoro.calls.Load() != 0 {
		t.Fatal("the script was spoken before anyone chose to")
	}

	engines := e.speechEngines(id)
	if len(engines) != 1 || engines[0]["engine"] != "builtin" || engines[0]["usable"] != true ||
		engines[0]["daily_minutes"] != float64(60) || mapAt(engines[0], "voices")["host"] != "af_heart" {
		t.Fatalf("engines %v", engines)
	}
	e.json(http.MethodPost, "/v1/audio-overviews/"+id+"/speak", map[string]any{"engine": "builtin"}, http.StatusAccepted)
	booked := e.scalar(`SELECT coalesce(sum(seconds), 0)::int FROM tts_usage WHERE user_id = $1`, e.user)
	if booked <= 0 {
		t.Fatal("nothing was booked from the day's built-in minutes")
	}
	if e.scalar(`SELECT count(*)::int FROM jobs WHERE user_id = $1 AND kind = 'audio_overview_builtin'`, e.user) != 1 {
		t.Fatal("the built-in job is not its own single-worker kind")
	}
	e.drainJobs()

	got := e.json(http.MethodGet, "/v1/audio-overviews/"+id, nil, http.StatusOK)
	if got["status"] != "ready" || got["tts_engine"] != "builtin" || got["tts_model"] != "kokoro" ||
		mapAt(got, "tts_voices")["host"] != "af_heart" || mapAt(got, "tts_voices")["expert"] != "am_michael" {
		t.Fatalf("overview %v", got)
	}
	// One request per turn, in the turn's own voice, with no key.
	voices := kokoro.voices()
	if len(voices) != 10 || voices[0] != "af_heart" || voices[1] != "am_michael" || kokoro.auths[0] != "" {
		t.Fatalf("voices %v auth %q", voices, kokoro.auths[0])
	}
	if kokoro.bodies[0]["response_format"] != "pcm" || kokoro.bodies[0]["model"] != "kokoro" {
		t.Fatalf("request %v", kokoro.bodies[0])
	}
	// One second spoken: that is what stays spent today.
	if spent := e.scalar(`SELECT coalesce(sum(seconds), 0)::int FROM tts_usage WHERE user_id = $1`, e.user); spent != 1 {
		t.Fatalf("after speaking %d seconds are spent (booked %d); want the one spoken", spent, booked)
	}

	req, _ := http.NewRequest(http.MethodGet, e.server.URL+"/v1/audio-overviews/"+id+"/audio", nil)
	req.Header.Set("Range", "bytes=0-43")
	req.Header.Set("Authorization", "Bearer "+e2eToken)
	req.Header.Set(httpx.UserIDHeader, e.user.String())
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	head, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusPartialContent || len(head) != 44 || string(head[:4]) != "RIFF" ||
		res.Header.Get("Content-Range") != fmt.Sprintf("bytes 0-43/%d", 44+10*4800) {
		t.Fatalf("range: %d %q %q", res.StatusCode, head[:4], res.Header.Get("Content-Range"))
	}
}

// A learner with an OpenAI key can choose it instead, and the key speaks in
// OpenAI's voices; a Vietnamese overview is offered that key and never the
// built-in Kokoro, which answers 409 without a call.
func TestAnOpenAIKeyIsChosenAndAVietnameseScriptNeverReachesKokoro(t *testing.T) {
	kokoro := newSpeechFake(t)
	openai := newSpeechFake(t)
	e, reportID := audioE2E(t, kokoro)
	ctx := context.Background()
	key := testutil.TestEncryptionKey
	conn, err := pg.NewProviderConnectionStore(e.pool, key).CreateConnection(ctx, e.user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "My OpenAI", APIBase: openai.server.URL + "/v1", Secret: "sk-speech",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := pg.NewFunctionRouteStore(e.pool, key).ReplaceRoute(ctx, e.user, "tts",
		[]store.RouteEntryInput{{ConnectionID: conn.ID, Model: "tts-1"}}); err != nil {
		t.Fatal(err)
	}

	en := e.scriptedOverview(reportID, "en")
	if engines := e.speechEngines(en); len(engines) != 2 || engines[0]["engine"] != "builtin" ||
		engines[1]["connection_id"] != conn.ID.String() || engines[1]["chars"] == float64(0) {
		t.Fatalf("english engines %v", engines)
	}

	vi := e.scriptedOverview(reportID, "vi")
	engines := e.speechEngines(vi)
	if len(engines) != 1 || engines[0]["provider"] != "openai" || mapAt(engines[0], "voices")["host"] != "nova" {
		t.Fatalf("a Vietnamese script is offered %v", engines)
	}
	res := e.do(http.MethodPost, "/v1/audio-overviews/"+vi+"/speak", map[string]any{"engine": "builtin"})
	_ = res.Body.Close()
	if res.StatusCode != http.StatusConflict || kokoro.calls.Load() != 0 {
		t.Fatalf("built-in on Vietnamese: %d, %d Kokoro calls", res.StatusCode, kokoro.calls.Load())
	}
	if n := e.scalar(`SELECT coalesce(sum(seconds), 0)::int FROM tts_usage WHERE user_id = $1`, e.user); n != 0 {
		t.Fatalf("a refused language booked %d seconds", n)
	}

	e.json(http.MethodPost, "/v1/audio-overviews/"+vi+"/speak",
		map[string]any{"engine": "byok", "connection_id": conn.ID.String()}, http.StatusAccepted)
	e.drainJobs()
	got := e.json(http.MethodGet, "/v1/audio-overviews/"+vi, nil, http.StatusOK)
	voices := openai.voices()
	if got["status"] != "ready" || got["tts_engine"] != "openai" || got["tts_model"] != "tts-1" ||
		len(voices) != 10 || voices[0] != "nova" || voices[1] != "onyx" || openai.auths[0] != "Bearer sk-speech" {
		t.Fatalf("overview %v voices %v", got, voices)
	}
	if kokoro.calls.Load() != 0 {
		t.Fatal("Kokoro was asked to speak Vietnamese")
	}
}

// The built-in voices are offered only while the service answers.
func TestTheBuiltinVoicesAreOfferedOnlyWhenHealthy(t *testing.T) {
	kokoro := newSpeechFake(t)
	kokoro.healthy.Store(false)
	e, reportID := audioE2E(t, kokoro)
	id := e.scriptedOverview(reportID, "en")
	if engines := e.speechEngines(id); len(engines) != 0 {
		t.Fatalf("an unhealthy Kokoro is offered: %v", engines)
	}
	res := e.do(http.MethodPost, "/v1/audio-overviews/"+id+"/speak", map[string]any{"engine": "builtin"})
	_ = res.Body.Close()
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("speak on an unhealthy engine: %d", res.StatusCode)
	}

	// And a server with no built-in engine never offers one.
	e2, reportID2 := audioE2E(t, nil)
	if engines := e2.speechEngines(e2.scriptedOverview(reportID2, "en")); len(engines) != 0 {
		t.Fatalf("no engine configured, yet offered %v", engines)
	}
}
