package byok_test

import (
	"context"
	"encoding/json"
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

// Up-methods phase 22: `tts` is served by an OpenAI API key and by a
// learner's own OpenAI-compatible speech server, and by nothing else — not
// Gemini any more, not Anthropic, not a chat preset, not a subscription lane
// (learning-depth red team AS-16).
func TestTTSRoutesOnlyToOpenAIShapedSpeechKeys(t *testing.T) {
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

	if err := svc.SetRoute(ctx, user, byok.FunctionTTS, []byok.RouteEntry{
		mk("openai", store.KindAPIKey, ""),
		mk("openai_compat", store.KindAPIKey, "kokoro"),
	}); err != nil {
		t.Fatalf("an OpenAI key or a speech server was refused for speech: %v", err)
	}
	// The model is named, as a learner can type one: the allow-list must
	// refuse the provider on its own, not only because it has no default.
	for _, refused := range [][2]string{
		{"gemini", store.KindAPIKey},
		{"anthropic", store.KindAPIKey},
		{"deepseek", store.KindAPIKey},
		{"groq", store.KindAPIKey},
		{"gemini", store.KindOAuthGeminiSub},
	} {
		err := svc.SetRoute(ctx, user, byok.FunctionTTS, []byok.RouteEntry{mk(refused[0], refused[1], "tts-1")})
		if err == nil {
			t.Errorf("%s (%s) was accepted for speech", refused[0], refused[1])
		}
	}
	// An OpenAI-compatible server has no honest default model.
	if err := svc.SetRoute(ctx, user, byok.FunctionTTS, []byok.RouteEntry{mk("openai_compat", store.KindAPIKey, "")}); err == nil {
		t.Error("an OpenAI-compatible speech entry with no model was accepted")
	}
	if byok.KindOf(byok.FunctionTTS) != byok.KindTTS {
		t.Fatal("tts is not its own kind; ChatFor would hand it a chat client")
	}
	if _, err := svc.ChatFor(ctx, user, byok.FunctionTTS); err == nil {
		t.Fatal("ChatFor served the speech function")
	}
}

// Speech is optional: a user with no `tts` route is not blocked, and the
// chain says there is no route rather than failing.
func TestTTSIsOptional(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))

	r, err := svc.Compute(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range r.CoreFunctions {
		if f == byok.FunctionTTS {
			t.Fatal("tts is listed as a core function")
		}
	}
	chain, err := svc.TTSFor(ctx, user, uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if chain.Len() != 0 {
		t.Fatalf("an unrouted user has %d speech entries", chain.Len())
	}
}

func TestTTSForNarrowsToTheChosenConnection(t *testing.T) {
	svc, conns, routes := newService(t)
	ctx := context.Background()
	pool := testutil.TestDB(t)
	user, other := testutil.NewUser(t, pool), testutil.NewUser(t, pool)
	conn := func(owner uuid.UUID, provider, base string) uuid.UUID {
		c, err := conns.CreateConnection(ctx, owner, store.NewProviderConnection{
			Provider: provider, Kind: store.KindAPIKey, Name: provider + "-" + uuid.NewString()[:6], Secret: "k", APIBase: base})
		if err != nil {
			t.Fatal(err)
		}
		return c.ID
	}
	openai, kokoro := conn(user, "openai", ""), conn(user, "openai_compat", "https://tts.example.com/v1")
	if err := routes.ReplaceRoute(ctx, user, "tts", []store.RouteEntryInput{
		{ConnectionID: openai, Model: ""}, {ConnectionID: kokoro, Model: "kokoro"},
	}); err != nil {
		t.Fatal(err)
	}
	all, err := svc.TTSFor(ctx, user, uuid.Nil)
	if err != nil || all.Len() != 2 {
		t.Fatalf("all: %d %v", all.Len(), err)
	}
	if e := all.Entries()[0]; e.Client.Model() != byok.DefaultOpenAITTSModel || e.Client.Name() != "openai" {
		t.Fatalf("first entry speaks %s/%s", e.Client.Name(), e.Client.Model())
	}
	only, _ := svc.TTSFor(ctx, user, kokoro)
	if only.Len() != 1 || only.Entries()[0].ConnectionID != kokoro || only.Entries()[0].Client.Model() != "kokoro" {
		t.Fatalf("only kokoro: %+v", only.Entries())
	}
	for _, id := range []uuid.UUID{conn(other, "openai", ""), conn(user, "openai", ""), uuid.New()} {
		if c, _ := svc.TTSFor(ctx, user, id); c.Len() != 0 {
			t.Errorf("%s resolved to %d entries", id, c.Len())
		}
	}
}

// Verify speaks one short sentence and expects audio back.
func TestVerifyTTSSpeaksOneSentence(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	var status atomic.Int32
	status.Store(200)
	var input atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		input.Store(body)
		if status.Load() != 200 {
			w.WriteHeader(int(status.Load()))
			_, _ = w.Write([]byte(`{"error":{"message":"Incorrect API key provided: sk-live-SECRET"}}`))
			return
		}
		w.Header().Set("Content-Type", "audio/pcm")
		_, _ = w.Write(make([]byte, 4800))
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
	res, err := svc.VerifyConnection(ctx, user, c.ID, byok.FunctionTTS)
	if err != nil || !res.OK || res.Model != "tts-1" {
		t.Fatalf("verify %+v err %v", res, err)
	}
	body := input.Load().(map[string]any)
	if body["response_format"] != "pcm" || body["input"] == "" || body["voice"] != "alloy" {
		t.Fatalf("probe %v", body)
	}
	status.Store(401)
	res, err = svc.VerifyConnection(ctx, user, c.ID, byok.FunctionTTS)
	if err != nil || res.OK || strings.Contains(res.Message, "SECRET") {
		t.Fatalf("verify 401 %+v err %v", res, err)
	}
}

// Readiness: Gemini is no longer offered for speech, and the built-in voices
// are on the tts row only while they answer.
func TestReadinessOffersBuiltinVoicesOnlyWhenHealthyAndNeverGemini(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	if byok.ProviderSupports("gemini", byok.FunctionTTS) {
		t.Fatal("Gemini is offered for speech")
	}
	row := func() byok.FunctionReadiness {
		r, err := svc.Compute(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range r.Functions {
			if f.Function == byok.FunctionTTS {
				return f
			}
		}
		t.Fatal("no tts row")
		return byok.FunctionReadiness{}
	}
	var healthy atomic.Bool
	svc.UseBuiltin(byok.FunctionTTS, byok.BuiltinEngine{
		Label:     "Built-in voices (free)",
		Available: func(context.Context) bool { return healthy.Load() },
	})
	if r := row(); len(r.Entries) != 0 || r.Status == byok.StatusGreen {
		t.Fatalf("unhealthy engine listed: %+v", r)
	}
	healthy.Store(true)
	r := row()
	if r.Status != byok.StatusGreen || len(r.Entries) != 1 || r.Entries[0].Provider != byok.BuiltinProvider ||
		r.Entries[0].Name != "Built-in voices (free)" {
		t.Fatalf("healthy engine: %+v", r)
	}
}

// Learning depth, phase 6 (red team AS-6): an OpenAlex key is not a
// web-search key. It is not in the web chain, readiness still says "no search
// key", and PaperKeyFor finds it.
func TestAnOpenAlexKeyIsNotAWebSearchKey(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	if _, err := svc.SaveSearchConnection(ctx, user, byok.ProviderOpenAlex, "oa-key"); err != nil {
		t.Fatal(err)
	}
	chain, err := svc.SearchFor(ctx, user)
	if err != nil || chain.Len() != 0 {
		t.Fatalf("web chain = %v entries, %v", chain.Len(), err)
	}
	if key, err := svc.PaperKeyFor(ctx, user); err != nil || key != "oa-key" {
		t.Fatalf("PaperKeyFor = %q, %v", key, err)
	}
	r, err := svc.Compute(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range r.Functions {
		if f.Function == byok.FunctionResearch && f.Status == byok.StatusGreen {
			t.Fatal("readiness counted the OpenAlex key as a search key")
		}
	}
	if _, err := svc.SaveSearchConnection(ctx, user, "semanticscholar", "k"); err == nil {
		t.Fatal("an unknown search provider was accepted")
	}
}
