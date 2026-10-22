package byok_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/D0bby999/anytools/internal/byok"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
	"github.com/D0bby999/anytools/internal/testutil"
)

// A learner whose only AI is an OpenAI-compatible server (Ollama, LM Studio,
// a hosted vLLM) can index documents: the route names its model, verify
// learns the width, and a width the column cannot hold is refused in words
// (the private design notes, phase 2).
func TestAnOpenAICompatibleServerCanIndexDocuments(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	var width atomic.Int32
	width.Store(768)
	var sentDims atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["dimensions"]; ok {
			sentDims.Store(true)
		}
		vec := make([]float32, width.Load())
		vec[0] = 1
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []map[string]any{{"index": 0, "embedding": vec}}})
	}))
	defer srv.Close()

	svc, conns, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai_compat", Kind: store.KindAPIKey, Name: "ollama", Secret: "none", APIBase: srv.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}

	if !byok.ProviderSupports("openai_compat", byok.FunctionEmbed) {
		t.Fatal("an OpenAI-compatible endpoint cannot embed")
	}
	if byok.ProviderSupports("anthropic", byok.FunctionEmbed) {
		t.Fatal("Anthropic, which has no embeddings endpoint, was offered for embed")
	}
	err = svc.SetRoute(ctx, user, byok.FunctionEmbed, []byok.RouteEntry{{ConnectionID: c.ID}})
	if err == nil || !strings.Contains(byok.UserMessage(err), `Choose a model for "ollama"`) {
		t.Fatalf("a custom endpoint was routed with no model: %v", err)
	}
	if err := svc.SetRoute(ctx, user, byok.FunctionEmbed, []byok.RouteEntry{{ConnectionID: c.ID, Model: "nomic-embed-text"}}); err != nil {
		t.Fatalf("route: %v", err)
	}

	res, err := svc.VerifyConnection(ctx, user, c.ID, byok.FunctionEmbed)
	if err != nil || !res.OK || res.Dims != 768 || res.Model != "nomic-embed-text" {
		t.Fatalf("verify %+v err %v", res, err)
	}
	if sentDims.Load() {
		t.Fatal("an unknown server was sent a dimensions field")
	}

	// A second server whose model is wider than the column, checked before
	// anything has measured it.
	width.Store(4096)
	wide, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai_compat", Kind: store.KindAPIKey, Name: "wide", Secret: "none", APIBase: srv.URL + "/v1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetRoute(ctx, user, byok.FunctionEmbed, []byok.RouteEntry{{ConnectionID: wide.ID, Model: "qwen3-embedding:8b"}}); err != nil {
		t.Fatalf("route: %v", err)
	}
	res, err = svc.VerifyConnection(ctx, user, wide.ID, byok.FunctionEmbed)
	if err != nil || res.OK {
		t.Fatalf("a 4096-wide model passed verify: %+v err %v", res, err)
	}
	if !strings.Contains(res.Message, "4096 numbers wide") || !strings.Contains(res.Message, "3072") {
		t.Fatalf("the refusal does not say why: %q", res.Message)
	}
}

// Parse is optional: text files and text-layer PDFs are read on the server,
// so a learner with no parse route is warned about scanned PDFs, not blocked,
// and the core verdict is chat and embed alone.
func TestParseIsOptionalAndSaysWhatItCannotRead(t *testing.T) {
	svc, _, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))

	r, err := svc.Compute(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.CoreFunctions) != 2 || r.CoreFunctions[0] != byok.FunctionChat || r.CoreFunctions[1] != byok.FunctionEmbed {
		t.Fatalf("core functions = %v", r.CoreFunctions)
	}
	optional := false
	for _, f := range r.OptionalFunctions {
		optional = optional || f == byok.FunctionParse
	}
	if !optional {
		t.Fatalf("parse is not optional: %v", r.OptionalFunctions)
	}
	for _, row := range r.Functions {
		if row.Function != byok.FunctionParse {
			continue
		}
		if row.Status != byok.StatusWarn || row.ReasonCode != "parse_local" || !strings.Contains(row.Reason, "scanned PDFs") {
			t.Fatalf("parse row = %+v", row)
		}
	}
}

// A refusal names the provider and the task as a learner knows them.
func TestAnUnsupportedRouteIsRefusedInWords(t *testing.T) {
	svc, conns, _ := newService(t)
	ctx := context.Background()
	user := testutil.NewUser(t, testutil.TestDB(t))
	c, err := conns.CreateConnection(ctx, user, store.NewProviderConnection{
		Provider: "openai_compat", Kind: store.KindAPIKey, Name: "local", Secret: "none", APIBase: "https://example.com/v1"})
	if err != nil {
		t.Fatal(err)
	}
	err = svc.SetRoute(ctx, user, byok.FunctionParse, []byok.RouteEntry{{ConnectionID: c.ID, Model: "llava"}})
	if err == nil || byok.UserMessage(err) != "Custom endpoint cannot be used for reading documents" {
		t.Fatalf("refusal = %v", err)
	}
}
