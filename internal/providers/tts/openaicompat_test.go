package tts_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/tts"
)

// The fixtures (testdata/README.md) are half a second of the `pcm` format
// OpenAI and Kokoro-FastAPI both answer: 24 kHz, 16-bit, mono. They were
// made with ffmpeg, not recorded: no live key or Kokoro server existed here.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// fakeSpeech is an OpenAI-shaped speech endpoint: it records each request
// and answers with body (or status and body) under contentType.
type fakeSpeech struct {
	status      int
	body        []byte
	contentType string

	mu    sync.Mutex
	reqs  []map[string]any
	auths []string
	paths []string
	calls atomic.Int32
}

func (f *fakeSpeech) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	f.reqs = append(f.reqs, body)
	f.auths = append(f.auths, r.Header.Get("Authorization"))
	f.paths = append(f.paths, r.Method+" "+r.URL.Path)
	f.mu.Unlock()
	if f.contentType != "" {
		w.Header().Set("Content-Type", f.contentType)
	}
	if f.status != 0 && f.status != http.StatusOK {
		w.WriteHeader(f.status)
	}
	_, _ = w.Write(f.body)
}

var twoVoices = []tts.Speaker{{Name: "Host", Voice: "af_heart"}, {Name: "Expert", Voice: "am_michael"}}

func TestOpenAIAndKokoroPCMIsReadTurnByTurnInEachVoice(t *testing.T) {
	for _, tc := range []struct {
		name, fixture, contentType, model string
	}{
		{"openai", "openai_pcm.raw", "application/octet-stream", "tts-1"},
		{"kokoro", "kokoro_pcm.raw", "audio/pcm", "kokoro"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pcm := fixture(t, tc.fixture)
			eng := &fakeSpeech{body: pcm, contentType: tc.contentType}
			srv := httptest.NewServer(eng)
			defer srv.Close()
			c := tts.NewOpenAICompat(tc.name, "sk-1", srv.URL+"/v1", tc.model, srv.Client())
			turns := []tts.Turn{{Speaker: "Host", Text: "What is retrieval?"}, {Speaker: "Expert", Text: "Finding passages."}}
			got, err := c.Synthesize(context.Background(), turns, twoVoices, 10*tts.BytesPerSecond)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, append(append([]byte{}, pcm...), pcm...)) {
				t.Fatalf("got %d bytes, want the two turns' %d", len(got), 2*len(pcm))
			}
			if len(eng.reqs) != 2 {
				t.Fatalf("%d requests, want one per turn", len(eng.reqs))
			}
			for i, want := range []map[string]any{
				{"model": tc.model, "input": "What is retrieval?", "voice": "af_heart", "response_format": "pcm", "speed": 1.0},
				{"model": tc.model, "input": "Finding passages.", "voice": "am_michael", "response_format": "pcm", "speed": 1.0},
			} {
				for k, v := range want {
					if eng.reqs[i][k] != v {
						t.Errorf("request %d: %s = %v, want %v", i, k, eng.reqs[i][k], v)
					}
				}
				if eng.paths[i] != "POST /v1/audio/speech" || eng.auths[i] != "Bearer sk-1" {
					t.Errorf("request %d: %s, auth %q", i, eng.paths[i], eng.auths[i])
				}
			}
		})
	}
}

// A response over the budget is cut and refused: never read past the
// budget, and never returned in part.
func TestAnswerOverTheBudgetIsCutAndRefused(t *testing.T) {
	huge := make([]byte, 4*tts.BytesPerSecond)
	srv := httptest.NewServer(&fakeSpeech{body: huge, contentType: "audio/pcm"})
	defer srv.Close()
	c := tts.NewOpenAICompat("openai", "k", srv.URL+"/v1", "tts-1", srv.Client())
	_, err := c.Synthesize(context.Background(), []tts.Turn{{Speaker: "Host", Text: "Hi."}}, twoVoices, tts.BytesPerSecond)
	if !errors.Is(err, tts.ErrTooLong) {
		t.Fatalf("err %v, want ErrTooLong", err)
	}

	// The budget is the chunk's: two turns of 0.5 s fit in one second, three
	// do not, and the third is refused rather than read.
	pcm := fixture(t, "kokoro_pcm.raw")
	eng := &fakeSpeech{body: pcm, contentType: "audio/pcm"}
	srv2 := httptest.NewServer(eng)
	defer srv2.Close()
	c = tts.NewOpenAICompat("builtin", "", srv2.URL+"/v1", "kokoro", srv2.Client())
	three := []tts.Turn{{Speaker: "Host", Text: "a"}, {Speaker: "Expert", Text: "b"}, {Speaker: "Host", Text: "c"}}
	if _, err := c.Synthesize(context.Background(), three, twoVoices, int64(2*len(pcm))); !errors.Is(err, tts.ErrTooLong) {
		t.Fatalf("three turns in a two-turn budget: %v", err)
	}
	if eng.calls.Load() != 2 {
		t.Fatalf("%d calls; the third turn should not have been asked for", eng.calls.Load())
	}
}

func TestAnswersThatAreNotAudioAreRefused(t *testing.T) {
	for name, f := range map[string]*fakeSpeech{
		"json at 200":  {body: []byte(`{"ok":true}`), contentType: "application/json"},
		"html at 200":  {body: []byte(`<html>proxy</html>`), contentType: "text/html; charset=utf-8"},
		"odd length":   {body: []byte{1, 2, 3}, contentType: "audio/pcm"},
		"empty answer": {body: nil, contentType: "audio/pcm"},
	} {
		srv := httptest.NewServer(f)
		c := tts.NewOpenAICompat("openai", "k", srv.URL+"/v1", "tts-1", srv.Client())
		_, err := c.Synthesize(context.Background(), []tts.Turn{{Speaker: "Host", Text: "Hi."}}, twoVoices, tts.BytesPerSecond)
		srv.Close()
		if !errors.Is(err, tts.ErrBadAudio) {
			t.Errorf("%s: err %v, want ErrBadAudio", name, err)
		}
	}
}

func TestRefusalsNeverCarryTheKey(t *testing.T) {
	const key = "sk-test-SECRETKEY123"
	for _, tc := range []struct {
		name   string
		status int
		body   []byte
	}{
		{"openai 401", 401, fixture(t, "openai_401.json")},
		{"kokoro 400", 400, fixture(t, "kokoro_400.json")},
	} {
		srv := httptest.NewServer(&fakeSpeech{status: tc.status, body: tc.body, contentType: "application/json"})
		c := tts.NewOpenAICompat("openai", key, srv.URL+"/v1", "tts-1", srv.Client())
		_, err := c.Synthesize(context.Background(), []tts.Turn{{Speaker: "Host", Text: "Hi."}}, twoVoices, tts.BytesPerSecond)
		srv.Close()
		var he *providers.HTTPError
		if !errors.As(err, &he) || he.Status != tc.status {
			t.Fatalf("%s: err %v", tc.name, err)
		}
		if strings.Contains(err.Error(), key) || strings.Contains(he.Body, key) {
			t.Errorf("%s: the key is in the error: %v", tc.name, err)
		}
	}

	// A transport failure names the URL, never the header the key rides in.
	c := tts.NewOpenAICompat("openai", key, "http://127.0.0.1:1/v1", "tts-1", &http.Client{Timeout: time.Second})
	err := c.Ping(context.Background())
	if err == nil || strings.Contains(err.Error(), key) {
		t.Fatalf("transport error %v", err)
	}
}

func TestPingSpeaksOneSentenceInAVoiceTheFamilyHas(t *testing.T) {
	for model, voice := range map[string]string{"tts-1": "alloy", "gpt-4o-mini-tts": "alloy", "kokoro": "af_heart"} {
		eng := &fakeSpeech{body: fixture(t, "openai_pcm.raw"), contentType: "audio/pcm"}
		srv := httptest.NewServer(eng)
		c := tts.NewOpenAICompat("openai", "k", srv.URL+"/v1", model, srv.Client())
		err := c.Ping(context.Background())
		srv.Close()
		if err != nil {
			t.Fatalf("%s: %v", model, err)
		}
		if eng.reqs[0]["voice"] != voice || eng.reqs[0]["input"] == "" {
			t.Errorf("%s: probe %v", model, eng.reqs[0])
		}
	}
}

// Kokoro-FastAPI answers /health once its model is warm, and serves the
// OpenAI routes under /v1, keyless.
func TestBuiltinTalksToKokoroFastAPIWithoutAKey(t *testing.T) {
	eng := &fakeSpeech{body: fixture(t, "kokoro_pcm.raw"), contentType: "audio/pcm"}
	var healthy atomic.Bool
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		if !healthy.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"status":"healthy"}`))
	})
	mux.HandleFunc("GET /v1/models/{id}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("id") != tts.DefaultBuiltinModel {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"id":"kokoro","object":"model","owned_by":"kokoro"}`))
	})
	mux.Handle("POST /v1/audio/speech", eng)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	e := tts.NewBuiltinEngine(srv.URL)
	if e.Available(context.Background()) {
		t.Fatal("an unhealthy Kokoro is available")
	}
	healthy.Store(true)
	e.Forget()
	if !e.Available(context.Background()) {
		t.Fatal("a healthy Kokoro is not available")
	}
	c := tts.NewBuiltin(e)
	if c.Name() != tts.BuiltinProvider || c.Model() != "kokoro" || tts.Family(c.Model()) != tts.FamilyKokoro {
		t.Fatalf("builtin client %s/%s", c.Name(), c.Model())
	}
	pcm, err := c.Synthesize(context.Background(), []tts.Turn{{Speaker: "Host", Text: "Hello."}}, twoVoices, tts.BytesPerSecond)
	if err != nil || len(pcm) != 24000 {
		t.Fatalf("got %d bytes, err %v", len(pcm), err)
	}
	if eng.auths[0] != "" {
		t.Fatal("the built-in engine was sent an Authorization header")
	}
	if tts.NewBuiltinEngine("").Available(context.Background()) {
		t.Fatal("an unconfigured engine is available")
	}
}

func TestFamily(t *testing.T) {
	for model, want := range map[string]string{
		"kokoro": tts.FamilyKokoro, "Kokoro-82M": tts.FamilyKokoro, "tts-1": tts.FamilyOpenAI,
		"tts-1-hd": tts.FamilyOpenAI, "gpt-4o-mini-tts": tts.FamilyOpenAI, "": tts.FamilyOpenAI,
	} {
		if got := tts.Family(model); got != want {
			t.Errorf("Family(%q) = %s, want %s", model, got, want)
		}
	}
}
