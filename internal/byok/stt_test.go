package byok_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/testutil"
)

// Up-methods phase 21: `stt` is served by OpenAI, Groq, an OpenAI-compatible
// endpoint and Gemini API keys, and by nothing else.
func TestSTTRoutesOnlyToSpeechProviders(t *testing.T) {
	svc, conns, _ := newService(t)
	t.Setenv("ANYTOOLS_EXPERIMENTAL_SUBSCRIPTION_LANES", "1")
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))

	mk := func(provider, kind, model string) byok.RouteEntry {
		t.Helper()
		c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
			Provider: provider, Kind: kind, Name: provider + "-" + kind + "-" + uuid.NewString()[:6], Secret: "secret",
		})
		if err != nil {
			t.Fatalf("create %s/%s: %v", provider, kind, err)
		}
		return byok.RouteEntry{ConnectionID: c.ID, Model: model}
	}
	if err := svc.SetRoute(ctx, user, byok.FunctionSTT, []byok.RouteEntry{
		mk("groq", store.KindAPIKey, ""),
		mk("openai", store.KindAPIKey, ""),
		mk("gemini", store.KindAPIKey, ""),
		mk("openai_compat", store.KindAPIKey, "Systran/faster-whisper-large-v3"),
	}); err != nil {
		t.Fatalf("speech providers were refused: %v", err)
	}
	for _, refused := range [][2]string{
		{"anthropic", store.KindAPIKey},
		{"deepseek", store.KindAPIKey},
		{"mistral", store.KindAPIKey},
		{"gemini", store.KindOAuthGeminiSub},
	} {
		if err := svc.SetRoute(ctx, user, byok.FunctionSTT, []byok.RouteEntry{mk(refused[0], refused[1], "whisper-1")}); err == nil {
			t.Errorf("%s (%s) was accepted for speech to text", refused[0], refused[1])
		}
	}
	// An OpenAI-compatible server has no honest default model.
	if err := svc.SetRoute(ctx, user, byok.FunctionSTT, []byok.RouteEntry{mk("openai_compat", store.KindAPIKey, "")}); err == nil {
		t.Error("an OpenAI-compatible entry with no model was accepted")
	}
	if byok.KindOf(byok.FunctionSTT) != byok.KindSTT {
		t.Fatal("stt is not its own kind")
	}
}

func TestSTTForNarrowsToTheChosenConnectionAndSkipsGemini(t *testing.T) {
	svc, conns, routes := newService(t)
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user, other := testutil.NewUser(t, pool), testutil.NewUser(t, pool)

	conn := func(owner uuid.UUID, provider string) uuid.UUID {
		c, err := conns.CreateConnection(ctx, owner, store.NewProviderConnection{
			Provider: provider, Kind: store.KindAPIKey, Name: provider + "-" + uuid.NewString()[:6], Secret: "k"})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	gemini, groq, openai := conn(user, "gemini"), conn(user, "groq"), conn(user, "openai")
	if err := routes.ReplaceRoute(ctx, user, "stt", []store.RouteEntryInput{
		{ConnectionID: gemini, Model: "gemini-2.5-flash"},
		{ConnectionID: groq, Model: ""},
		{ConnectionID: openai, Model: "whisper-1"},
	}); err != nil {
		t.Fatal(err)
	}

	all, err := svc.STTFor(ctx, user, uuid.Nil)
	if err != nil || all.Len() != 2 {
		t.Fatalf("all: %d %v", all.Len(), err)
	}
	if e := all.Entries()[0]; e.ConnectionID != groq || e.Model != byok.DefaultGroqSTTModel {
		t.Fatalf("first entry %+v", e)
	}
	only, _ := svc.STTFor(ctx, user, openai)
	if only.Len() != 1 || only.Entries()[0].ConnectionID != openai {
		t.Fatalf("only openai: %+v", only.Entries())
	}
	// Another learner's connection, or one not routed, is an empty chain:
	// the same answer as an id that does not exist.
	for _, id := range []uuid.UUID{conn(other, "groq"), conn(user, "groq"), uuid.New()} {
		if c, _ := svc.STTFor(ctx, user, id); c.Len() != 0 {
			t.Errorf("%s resolved to %d entries", id, c.Len())
		}
	}

	// Gemini reads URLs: the stt route's key first, then the parse route's,
	// each connection once.
	parseGemini := conn(user, "gemini")
	if err := routes.ReplaceRoute(ctx, user, "parse", []store.RouteEntryInput{
		{ConnectionID: parseGemini, Model: "gemini-2.5-pro"},
		{ConnectionID: gemini, Model: "gemini-2.5-flash"},
	}); err != nil {
		t.Fatal(err)
	}
	urls, err := svc.TranscriberFor(ctx, user)
	if err != nil || urls.Len() != 2 {
		t.Fatalf("url transcribers: %d %v", urls.Len(), err)
	}
	if urls.Entries()[0].ConnectionID != gemini || urls.Entries()[1].ConnectionID != parseGemini {
		t.Fatalf("order %+v", urls.Entries())
	}
}

// Verify sends a second of silence to an OpenAI-shaped endpoint and expects
// a 200 transcript.
func TestVerifySTTSendsSilenceAndExpectsATranscript(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	var status atomic.Int32
	status.Store(200)
	var sawWAV atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			http.NotFound(w, r)
			return
		}
		f, _, err := r.FormFile("file")
		if err == nil {
			head := make([]byte, 4)
			_, _ = io.ReadFull(f, head)
			sawWAV.Store(string(head) == "RIFF")
		}
		w.WriteHeader(int(status.Load()))
		if status.Load() == 200 {
			_, _ = w.Write([]byte(`{"text":"","language":"en","duration":1.0,"segments":[]}`))
		} else {
			_, _ = w.Write([]byte(`{"error":{"message":"Invalid API Key sk-live-SECRET"}}`))
		}
	}))
	defer srv.Close()

	svc, conns, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai", Kind: store.KindAPIKey, Name: "oa", Secret: "sk-live-SECRET", APIBase: srv.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}
	res, err := svc.VerifyConnection(ctx, user, c.ID, byok.FunctionSTT)
	if err != nil || !res.OK || res.Model != "whisper-1" || !sawWAV.Load() {
		t.Fatalf("verify %+v err %v wav %v", res, err, sawWAV.Load())
	}
	status.Store(401)
	res, err = svc.VerifyConnection(ctx, user, c.ID, byok.FunctionSTT)
	if err != nil || res.OK || !strings.Contains(res.Message, "rejected this key") || strings.Contains(res.Message, "SECRET") {
		t.Fatalf("verify 401 %+v err %v", res, err)
	}
}

// Readiness: stt is optional; the built-in engine, when it answers, makes the
// row ready with no route at all, and is absent when it does not.
func TestReadinessListsTheBuiltinEngineOnlyWhenItAnswers(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))

	row := func() byok.FunctionReadiness {
		r, err := svc.Compute(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		optional := false
		for _, fn := range r.OptionalFunctions {
			optional = optional || fn == byok.FunctionSTT
		}
		if !optional {
			t.Fatal("stt is not listed as optional")
		}
		for _, f := range r.Functions {
			if f.Function == byok.FunctionSTT {
				return f
			}
		}
		t.Fatal("no stt row")
		return byok.FunctionReadiness{}
	}
	if r := row(); r.Status != byok.StatusBlocked || len(r.Entries) != 0 {
		t.Fatalf("no engine: %+v", r)
	}
	var up atomic.Bool
	svc.UseBuiltin(byok.FunctionSTT, byok.BuiltinEngine{
		Label: "Built-in transcription (free, slower)", Available: func(context.Context) bool { return up.Load() }})
	if r := row(); r.Status != byok.StatusBlocked || len(r.Entries) != 0 {
		t.Fatalf("engine down: %+v", r)
	}
	up.Store(true)
	r := row()
	if r.Status != byok.StatusGreen || len(r.Entries) != 1 || r.Entries[0].Provider != byok.BuiltinProvider ||
		r.Entries[0].Name != "Built-in transcription (free, slower)" {
		t.Fatalf("engine up: %+v", r)
	}
}
