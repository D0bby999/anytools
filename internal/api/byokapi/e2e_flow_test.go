package byokapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/testutil"
)

// e2e_flow_test.go — the phase's acceptance criterion, driven end to end at the
// HTTP layer: a user adds a Gemini key, verifies it, assigns it to the chat,
// parse and embed routes, and the readiness card turns green.
//
// Every call goes through the real mux, the real RequireUser middleware, the
// real handlers, the real service and the real Postgres. The only substitution
// is the provider itself: a fake Gemini that speaks all three wire formats, so
// the test asserts on AnyTools' behaviour rather than on Google's uptime.
// The same journey against the owner's live key is live_verify_test.go, which
// runs only under ANYTOOLS_LIVE_TESTS=1.

// fakeGemini answers the three endpoints a Gemini connection is verified
// against: the OpenAI-shim chat completion, generateContent for parse, and
// batchEmbedContents for embed.
func fakeGemini(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	// Chat, through Google's OpenAI compatibility shim.
	//
	// The path is /v1beta/OPENAI/chat/completions, which is where Google
	// actually serves it — NOT /v1beta/chat/completions. An earlier version of
	// this fixture served both wire formats off one base, which no real Google
	// endpoint does, and so could not catch a client that built the wrong chat
	// URL. Anything registered here must be a path Google really answers on.
	mux.HandleFunc("POST /v1beta/openai/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("chat call arrived without a bearer token")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		// The shim 400s on any field it does not know, and the provider's
		// compatibility layer is supposed to have stripped them. Asserting it
		// here is what keeps that layer wired to a Gemini connection.
		for _, forbidden := range []string{"frequency_penalty", "repetition_penalty", "enable_thinking", "thinking_budget"} {
			if _, present := body[forbidden]; present {
				t.Errorf("the Gemini lane sent %q, which Google's shim rejects for every call", forbidden)
			}
		}
		writeJSON(w, map[string]any{
			"choices": []any{map[string]any{
				"message":       map[string]any{"role": "assistant", "content": "ready"},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 1, "total_tokens": 9},
		})
	})

	// Parse: one page of Markdown carrying the probe text and its page marker.
	mux.HandleFunc("POST /v1beta/models/{model}", func(w http.ResponseWriter, r *http.Request) {
		model := r.PathValue("model")
		switch {
		case strings.HasSuffix(model, ":generateContent"):
			writeJSON(w, map[string]any{
				"candidates": []any{map[string]any{
					"content":      map[string]any{"parts": []any{map[string]any{"text": "<!-- page: 1 -->\nAnyTools verify page\n"}}},
					"finishReason": "STOP",
				}},
				"usageMetadata": map[string]any{"promptTokenCount": 120, "candidatesTokenCount": 12},
			})
		case strings.HasSuffix(model, ":batchEmbedContents"):
			var body struct {
				Requests []struct {
					TaskType string `json:"task_type"`
				} `json:"requests"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if len(body.Requests) == 0 || body.Requests[0].TaskType == "" {
				t.Error("the embed call did not carry a task_type — retrieval quality depends on it")
			}
			values := make([]float32, 3072)
			for i := range values {
				values[i] = 0.01
			}
			embeddings := make([]any, len(body.Requests))
			for i := range embeddings {
				embeddings[i] = map[string]any{"values": values}
			}
			writeJSON(w, map[string]any{"embeddings": embeddings})
		default:
			t.Errorf("unexpected model method %q", model)
			w.WriteHeader(http.StatusNotFound)
		}
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func TestSettingsFlowGeminiKeyToGreenReadiness(t *testing.T) {
	// The fake provider listens on 127.0.0.1, which the SSRF guard blocks by
	// design. Opening the documented escape hatch is what lets a loopback
	// endpoint be used at all — and the guard itself is proven separately, in
	// internal/security and in TestCreateConnectionRejectsAPrivateBaseURL, so
	// nothing is lost by opening it here.
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	provider := fakeGemini(t)
	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	// --- Settings → Connections: add a Gemini key -------------------------
	created := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
		"provider": "gemini",
		"name":     "My Gemini key",
		"api_base": provider.URL,
		"secret":   "AIza-test-key",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("add key: %d %s", created.Code, created.Body.String())
	}
	conn := decodeBody[map[string]any](t, created)
	connID, _ := conn["id"].(string)
	if connID == "" {
		t.Fatalf("no connection id in %s", created.Body.String())
	}
	// The base URL was normalised to include its version segment. Without this,
	// a missing segment is a silent HTTP 200 with an empty body.
	if base, _ := conn["api_base"].(string); !strings.HasSuffix(base, "/v1beta") {
		t.Fatalf("api_base was not normalised: %q", base)
	}

	// Before verifying, readiness must be honest: nothing is routed.
	before := decodeBody[byok.Readiness](t, h.do(t, user, http.MethodGet, "/v1/readiness", nil))
	if before.Core != byok.StatusBlocked {
		t.Fatalf("core readiness with nothing routed = %q, want blocked", before.Core)
	}

	// --- Verify the key for each function it will serve --------------------
	for _, fn := range []string{"chat", "parse", "embed"} {
		rec := h.do(t, user, http.MethodPost, "/v1/byok/connections/"+connID+"/verify",
			map[string]any{"function": fn})
		if rec.Code != http.StatusOK {
			t.Fatalf("verify %s: %d %s", fn, rec.Code, rec.Body.String())
		}
		result := decodeBody[map[string]any](t, rec)
		if ok, _ := result["ok"].(bool); !ok {
			t.Fatalf("verify %s failed: %s", fn, rec.Body.String())
		}
		if fn == "embed" {
			if dims, _ := result["dims"].(float64); int(dims) != 3072 {
				t.Fatalf("embed verify reported dims %v, want 3072 — the width must come from a real call", result["dims"])
			}
		}
	}

	// --- Settings → Routes: assign the connection to all three -------------
	for _, fn := range []string{"chat", "parse", "embed"} {
		rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/"+fn, map[string]any{
			"entries": []map[string]any{{"connection_id": connID}},
		})
		if rec.Code != http.StatusNoContent {
			t.Fatalf("route %s: %d %s", fn, rec.Code, rec.Body.String())
		}
	}

	routes := decodeBody[struct {
		Routes map[string][]struct {
			ConnectionID string `json:"connection_id"`
			Model        string `json:"model"`
			Dims         int    `json:"dims"`
		} `json:"routes"`
	}](t, h.do(t, user, http.MethodGet, "/v1/byok/routes", nil))

	for _, fn := range []string{"chat", "parse", "embed"} {
		entries := routes.Routes[fn]
		if len(entries) != 1 || entries[0].ConnectionID != connID {
			t.Fatalf("route %s did not stick: %+v", fn, entries)
		}
		if entries[0].Model == "" {
			t.Fatalf("route %s has no model — a chain entry with no model cannot be called", fn)
		}
	}
	// The embed entry carries the width the verify measured, so phase 5 can pin
	// a knowledge base to it without asking the provider again.
	if routes.Routes["embed"][0].Dims != 3072 {
		t.Fatalf("the embed route did not inherit the verified width: %+v", routes.Routes["embed"][0])
	}

	// --- The readiness card turns green ------------------------------------
	after := decodeBody[byok.Readiness](t, h.do(t, user, http.MethodGet, "/v1/readiness", nil))
	if after.Core != byok.StatusGreen {
		t.Fatalf("core readiness = %q, want green\n%+v", after.Core, after.Functions)
	}
	for _, row := range after.Functions {
		switch row.Function {
		case byok.FunctionChat, byok.FunctionParse, byok.FunctionEmbed:
			if row.Status != byok.StatusGreen {
				t.Errorf("%s = %q (%s), want green", row.Function, row.Status, row.Reason)
			}
		case byok.FunctionResearch:
			// Unrouted, so blocked — and the wording has to point at the fix.
			if row.Status != byok.StatusBlocked || !strings.Contains(row.Reason, "route") {
				t.Errorf("research = %q / %q, want blocked with a routing reason", row.Status, row.Reason)
			}
		}
	}

	// --- With a search key, research stops being KB-only -------------------
	if err := h.svc.SetRoute(t.Context(), user, byok.FunctionResearch,
		[]byok.RouteEntry{{ConnectionID: mustUUID(t, connID)}}); err != nil {
		t.Fatalf("route research: %v", err)
	}
	withoutKey := decodeBody[byok.Readiness](t, h.do(t, user, http.MethodGet, "/v1/readiness", nil))
	if row := findFunction(withoutKey, byok.FunctionResearch); row.Status != byok.StatusWarn ||
		!strings.Contains(row.Reason, "KB-only") {
		t.Fatalf("research without a search key = %q / %q, want a KB-only warning", row.Status, row.Reason)
	}
}

// A connection whose verify FAILED must not be reported as ready, and the
// reason must be the user-facing sentence rather than the provider's body.
func TestReadinessReportsARejectedKey(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"API key not valid. Key: AIza-leaked-value"}}`))
	}))
	defer refusing.Close()

	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	created := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
		"provider": "gemini", "name": "bad key", "api_base": refusing.URL, "secret": "AIza-wrong",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("add key: %d %s", created.Code, created.Body.String())
	}
	connID := decodeBody[map[string]any](t, created)["id"].(string)

	verify := h.do(t, user, http.MethodPost, "/v1/byok/connections/"+connID+"/verify", nil)
	if verify.Code != http.StatusOK {
		t.Fatalf("a failed verify must still be a successful request: %d", verify.Code)
	}
	result := decodeBody[map[string]any](t, verify)
	if ok, _ := result["ok"].(bool); ok {
		t.Fatal("a 401 from the provider was reported as a working key")
	}
	if msg, _ := result["message"].(string); !strings.Contains(msg, "rejected") {
		t.Fatalf("message %q does not tell the user what happened", msg)
	}
	// The provider's body echoed the key back. It must not reach the browser.
	if strings.Contains(verify.Body.String(), "AIza-leaked-value") {
		t.Fatal("the provider's error body, containing a key fragment, was passed through to the response")
	}

	if err := h.svc.SetRoute(t.Context(), user, byok.FunctionChat,
		[]byok.RouteEntry{{ConnectionID: mustUUID(t, connID)}}); err != nil {
		t.Fatalf("route: %v", err)
	}
	readiness := decodeBody[byok.Readiness](t, h.do(t, user, http.MethodGet, "/v1/readiness", nil))
	if readiness.Core != byok.StatusBlocked {
		t.Fatalf("core readiness with a rejected key = %q, want blocked", readiness.Core)
	}
	if row := findFunction(readiness, byok.FunctionChat); !strings.Contains(row.Entries[0].Note, "rejected") {
		t.Fatalf("the chat entry does not say the key was rejected: %+v", row.Entries[0])
	}
}

func findFunction(r byok.Readiness, fn byok.Function) byok.FunctionReadiness {
	for _, row := range r.Functions {
		if row.Function == fn {
			return row
		}
	}
	return byok.FunctionReadiness{}
}

// An OpenAI-compatible endpoint has no honest default model — the base URL is
// whatever the user pasted. Verifying it before a model is named must say so,
// not send `"model": ""` and report the provider's unexplained 400.
func TestVerifyingAnOpenAICompatConnectionNeedsAModelFirst(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")

	var sawModel string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		sawModel = body.Model
		writeJSON(w, map[string]any{
			"choices": []any{map[string]any{
				"message":       map[string]any{"content": "ready"},
				"finish_reason": "stop",
			}},
		})
	}))
	defer srv.Close()

	h := newHarness(t)
	pool := testutil.TestDB(t)
	user := testutil.NewUser(t, pool)

	created := h.do(t, user, http.MethodPost, "/v1/byok/connections", map[string]any{
		"provider": "openai_compat", "name": "my gateway", "api_base": srv.URL, "secret": "sk-x",
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", created.Code, created.Body.String())
	}
	connID := decodeBody[map[string]any](t, created)["id"].(string)

	// With no model, verify reads the model list (phase 4 of plan
	// 261021-1100); this server lists none, so the answer names the fix.
	refused := h.do(t, user, http.MethodPost, "/v1/byok/connections/"+connID+"/verify", nil)
	if refused.Code != http.StatusOK {
		t.Fatalf("verify without a model = %d (body %s)", refused.Code, refused.Body.String())
	}
	if passed, _ := decodeBody[map[string]any](t, refused)["ok"].(bool); passed || !strings.Contains(refused.Body.String(), "Choose a model") {
		t.Fatalf("the refusal does not name the problem: %s", refused.Body.String())
	}
	if sawModel != "" {
		t.Fatalf("a request was sent to the provider with model %q", sawModel)
	}

	// Once a model is routed, verify exercises THAT model rather than a default.
	if rec := h.do(t, user, http.MethodPut, "/v1/byok/routes/chat", map[string]any{
		"entries": []map[string]any{{"connection_id": connID, "model": "my-local-model"}},
	}); rec.Code != http.StatusNoContent {
		t.Fatalf("route: %d %s", rec.Code, rec.Body.String())
	}

	ok := h.do(t, user, http.MethodPost, "/v1/byok/connections/"+connID+"/verify", nil)
	if ok.Code != http.StatusOK {
		t.Fatalf("verify: %d %s", ok.Code, ok.Body.String())
	}
	if passed, _ := decodeBody[map[string]any](t, ok)["ok"].(bool); !passed {
		t.Fatalf("verify failed: %s", ok.Body.String())
	}
	if sawModel != "my-local-model" {
		t.Fatalf("verify probed %q, not the routed model", sawModel)
	}
}
