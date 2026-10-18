package stt_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/providers/stt"
)

// The fixtures are the documented verbose_json shapes of OpenAI
// (createTranscription), Groq (speech-to-text guide) and speaches (its
// OpenAI-compatible router), written down 2026-10-16. No live key existed to
// record them from; each keeps its source's quirks — OpenAI's "english",
// Groq's "English" and x_groq block, speaches' "en" and `words: null`.
func fixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestThreeEnginesParseToTheSameSegments(t *testing.T) {
	want := []stt.Segment{
		{Start: 0, End: 3.32, Text: "The beach was a popular spot on a hot summer day."},
		{Start: 3.32, End: 8.47, Text: "People were swimming in the ocean."},
	}
	for _, name := range []string{"openai_verbose.json", "groq_verbose.json", "speaches_verbose.json"} {
		got, err := stt.ParseResponse(fixture(t, name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got.Language != "en" || !got.Timed {
			t.Errorf("%s: language %q timed %v", name, got.Language, got.Timed)
		}
		if len(got.Segments) != len(want) {
			t.Fatalf("%s: %d segments", name, len(got.Segments))
		}
		for i := range want {
			g, w := got.Segments[i], want[i]
			if g.Text != w.Text || abs(g.Start-w.Start) > 0.01 || abs(g.End-w.End) > 0.01 {
				t.Errorf("%s segment %d = %+v, want %+v", name, i, g, w)
			}
		}
	}
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func TestTextOnlyAnswerIsSpreadAtSentenceEnds(t *testing.T) {
	got, err := stt.ParseResponse(fixture(t, "openai_gpt4o_json.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.Timed || len(got.Segments) != 2 {
		t.Fatalf("got %+v", got)
	}
	// No duration in a `json` answer: the caller spreads over its own window.
	spread := stt.Spread("One two. Three four five six.", 30)
	if len(spread) != 2 || spread[0].Start != 0 || spread[1].Start <= 0 || spread[1].End != 30 {
		t.Fatalf("spread %+v", spread)
	}
}

func TestEmptyAnswerIsNoSpeech(t *testing.T) {
	if _, err := stt.ParseResponse([]byte(`{"text":"","segments":[]}`)); !errors.Is(err, stt.ErrNoSpeech) {
		t.Fatalf("err %v", err)
	}
	if _, err := stt.ParseResponse([]byte(`<html>`)); !errors.Is(err, stt.ErrBadResponse) {
		t.Fatalf("err %v", err)
	}
}

// fakeEngine answers like the OpenAI-shaped endpoints and records each form.
type fakeEngine struct {
	status int
	body   []byte
	calls  atomic.Int32
	fields atomic.Value // map[string][]string
	auth   atomic.Value // string
	file   atomic.Value // []byte
}

func (f *fakeEngine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.calls.Add(1)
	if r.URL.Path != "/v1/audio/transcriptions" || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	f.auth.Store(r.Header.Get("Authorization"))
	mt, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mt != "multipart/form-data" {
		http.Error(w, "not multipart", 400)
		return
	}
	mr := multipart.NewReader(r.Body, params["boundary"])
	fields := map[string][]string{}
	for {
		p, err := mr.NextPart()
		if err != nil {
			break
		}
		data, _ := io.ReadAll(p)
		if p.FormName() == "file" {
			f.file.Store(data)
			fields["filename"] = []string{p.FileName()}
			continue
		}
		fields[p.FormName()] = append(fields[p.FormName()], string(data))
	}
	f.fields.Store(fields)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(f.status)
	_, _ = w.Write(f.body)
}

func TestRequestShapeIsVerboseJSONWithSegmentTimestamps(t *testing.T) {
	eng := &fakeEngine{status: 200, body: fixture(t, "groq_verbose.json")}
	srv := httptest.NewServer(eng)
	defer srv.Close()

	c := stt.NewOpenAICompat("gsk-key", srv.URL+"/v1", "whisper-large-v3-turbo", srv.Client())
	got, err := c.Transcribe(context.Background(), strings.NewReader("OggS…"), "audio/ogg", "en-US")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Segments) != 2 {
		t.Fatalf("segments %+v", got.Segments)
	}
	fields := eng.fields.Load().(map[string][]string)
	want := map[string][]string{
		"filename":                  {"audio.ogg"},
		"model":                     {"whisper-large-v3-turbo"},
		"response_format":           {"verbose_json"},
		"timestamp_granularities[]": {"segment"},
		"language":                  {"en"},
	}
	if !reflect.DeepEqual(fields, want) {
		t.Fatalf("form fields\n got %v\nwant %v", fields, want)
	}
	if eng.auth.Load().(string) != "Bearer gsk-key" {
		t.Fatal("the key was not sent as a bearer")
	}
	if string(eng.file.Load().([]byte)) != "OggS…" {
		t.Fatal("the audio was not sent as the file part")
	}
}

func TestGPT4oModelsAskForJSON(t *testing.T) {
	eng := &fakeEngine{status: 200, body: fixture(t, "openai_gpt4o_json.json")}
	srv := httptest.NewServer(eng)
	defer srv.Close()
	c := stt.NewOpenAICompat("sk", srv.URL+"/v1", "gpt-4o-mini-transcribe", srv.Client())
	if _, err := c.Transcribe(context.Background(), strings.NewReader("x"), "audio/ogg", ""); err != nil {
		t.Fatal(err)
	}
	fields := eng.fields.Load().(map[string][]string)
	if fields["response_format"][0] != "json" || fields["timestamp_granularities[]"] != nil || fields["language"] != nil {
		t.Fatalf("fields %v", fields)
	}
}

func TestRefusalsAreReadableAndNeverCarryTheKey(t *testing.T) {
	const key = "sk-test-SECRETKEY123"
	cases := []struct {
		name   string
		status int
		body   []byte
		want   string
	}{
		{"401", 401, fixture(t, "openai_401.json"), "rejected the key"},
		{"413", 413, fixture(t, "groq_413.json"), "too large"},
	}
	for _, tc := range cases {
		srv := httptest.NewServer(&fakeEngine{status: tc.status, body: tc.body})
		c := stt.NewOpenAICompat(key, srv.URL+"/v1", "whisper-1", srv.Client())
		_, err := c.Transcribe(context.Background(), strings.NewReader("x"), "audio/ogg", "")
		srv.Close()
		var he *providers.HTTPError
		if !errors.As(err, &he) || he.Status != tc.status {
			t.Fatalf("%s: err %v", tc.name, err)
		}
		if strings.Contains(err.Error(), key) || strings.Contains(he.Body, key) {
			t.Errorf("%s: the key is in the error: %v", tc.name, err)
		}
		if msg := stt.Explain(err); !strings.Contains(msg, tc.want) || strings.Contains(msg, key) {
			t.Errorf("%s: sentence %q", tc.name, msg)
		}
	}

	// A transport failure names the URL, never the header the key rides in.
	c := stt.NewOpenAICompat(key, "http://127.0.0.1:1/v1", "whisper-1", &http.Client{Timeout: time.Second})
	_, err := c.Transcribe(context.Background(), strings.NewReader("x"), "audio/ogg", "")
	if err == nil || strings.Contains(err.Error(), key) {
		t.Fatalf("transport error %v", err)
	}
}

func TestAudioOverTheUploadLimitIsNeverSent(t *testing.T) {
	eng := &fakeEngine{status: 200, body: fixture(t, "openai_verbose.json")}
	srv := httptest.NewServer(eng)
	defer srv.Close()
	c := stt.NewOpenAICompat("k", srv.URL+"/v1", "whisper-1", srv.Client())
	big := io.LimitReader(zeros{}, stt.MaxUpload+1)
	if _, err := c.Transcribe(context.Background(), big, "audio/ogg", ""); !errors.Is(err, stt.ErrAudioTooLarge) {
		t.Fatalf("err %v", err)
	}
	if eng.calls.Load() != 0 {
		t.Fatal("over-limit audio reached the engine")
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

func TestPingSendsOneSecondOfSilenceAndAcceptsAnEmptyTranscript(t *testing.T) {
	eng := &fakeEngine{status: 200, body: []byte(`{"text":"","segments":[],"language":"en","duration":1.0}`)}
	srv := httptest.NewServer(eng)
	defer srv.Close()
	c := stt.NewOpenAICompat("k", srv.URL+"/v1", "whisper-1", srv.Client())
	if err := c.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	wav := eng.file.Load().([]byte)
	if !bytes.HasPrefix(wav, []byte("RIFF")) || len(wav) < 32000 {
		t.Fatalf("probe is not a one-second WAV (%d bytes)", len(wav))
	}
	eng.status, eng.body = 401, []byte(`{"error":{"message":"bad key"}}`)
	if err := c.Ping(context.Background()); err == nil {
		t.Fatal("a 401 verified")
	}
}

// speaches answers /health and the OpenAI routes under /v1, keyless.
func TestBuiltinTalksToSpeachesWithoutAKey(t *testing.T) {
	eng := &fakeEngine{status: 200, body: fixture(t, "speaches_verbose.json")}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("OK")) })
	var downloaded atomic.Bool
	mux.HandleFunc("GET /v1/models/{id...}", func(w http.ResponseWriter, r *http.Request) {
		if !downloaded.Load() || r.PathValue("id") != stt.DefaultBuiltinModel {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(`{"id":"` + stt.DefaultBuiltinModel + `"}`))
	})
	mux.Handle("/v1/", eng)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	e := stt.NewBuiltinEngine(srv.URL, "")
	if e.Available(context.Background()) {
		t.Fatal("speaches without its model is available")
	}
	downloaded.Store(true)
	e.Forget()
	if !e.Available(context.Background()) {
		t.Fatal("a healthy speaches with its model is not available")
	}
	c := stt.NewBuiltin(e, "")
	got, err := c.Transcribe(context.Background(), strings.NewReader("x"), "audio/ogg", "")
	if err != nil || len(got.Segments) != 2 {
		t.Fatalf("got %+v err %v", got, err)
	}
	if eng.auth.Load().(string) != "" {
		t.Fatal("the built-in engine was sent an Authorization header")
	}
	if m := eng.fields.Load().(map[string][]string)["model"][0]; m != stt.DefaultBuiltinModel {
		t.Fatalf("model %q", m)
	}
}

func TestModelLabel(t *testing.T) {
	for in, want := range map[string]string{
		"Systran/faster-whisper-small":              "Whisper small",
		"deepdml/faster-whisper-large-v3-turbo-ct2": "Whisper large-v3-turbo",
		"Systran/faster-distil-whisper-large-v3":    "Whisper large-v3",
	} {
		if got := stt.ModelLabel(in); got != want {
			t.Errorf("%s: %q", in, got)
		}
	}
}
