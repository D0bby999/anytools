package byok

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/embed"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
)

// Every preset must be connectable by key alone: a default base with its
// version segment, and a default chat model, so verify never asks for either.
func TestEveryPresetIsUsableWithoutABaseOrAModel(t *testing.T) {
	offered := map[string]bool{}
	for _, p := range APIKeyProviders() {
		offered[p] = true
	}
	for id, p := range presets {
		if !offered[id] {
			t.Errorf("preset %q is not offered on the Connections page", id)
		}
		if p.Base == "" || p.ChatModel == "" {
			t.Errorf("preset %q lacks a default base or chat model", id)
		}
		if got := presetBase(id, ""); got != p.Base {
			t.Errorf("preset %q with no stored base serves on %q, want %q", id, got, p.Base)
		}
		if defaultModelFor(id, FunctionQuiz) != p.ChatModel {
			t.Errorf("preset %q: quiz does not default to its chat model", id)
		}
		if ProviderSupports(id, FunctionParse) {
			t.Errorf("preset %q claims to parse documents; no preset has a parse client", id)
		}
		if ProviderSupports(id, FunctionEmbed) != (p.EmbedModel != "") {
			t.Errorf("preset %q: embed support does not match its embed model", id)
		}
	}
	// Z.AI's version segment is v4; the generic "append /v1" rule would break it.
	if got := presetBase(providers.ProviderZAI, "https://api.z.ai/api/paas/v4/"); got != "https://api.z.ai/api/paas/v4" {
		t.Errorf("zai stored base normalised to %q", got)
	}
}

// Mistral's embeddings endpoint rejects `dimensions`; Qwen's honours it. Both
// go through the same embedder, so the difference is pinned on the wire.
func TestPresetEmbeddersSendDimensionsOnlyWhereAccepted(t *testing.T) {
	t.Setenv(security.AllowPrivateEndpointsEnv, "1")
	var sent map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		sent = nil
		_ = json.Unmarshal(raw, &sent)
		_, _ = io.WriteString(w, `{"data":[{"index":0,"embedding":[0.1,0.2]}]}`)
	}))
	defer srv.Close()

	for _, tc := range []struct {
		provider string
		wantDims bool
	}{{providers.ProviderMistral, false}, {providers.ProviderQwen, true}} {
		entry := store.ChainEntry{Dims: 1024, Connection: store.ProviderConnection{
			Provider: tc.provider, Secret: "k", APIBase: srv.URL + "/v1",
		}}
		e, err := (&Service{}).embedClient(context.Background(), uuid.Nil, entry)
		if err != nil {
			t.Fatalf("%s: %v", tc.provider, err)
		}
		if _, err := e.Embed(context.Background(), []string{"x"}, embed.TaskQuery); err != nil && sent == nil {
			t.Fatalf("%s: %v", tc.provider, err)
		}
		if _, got := sent["dimensions"]; got != tc.wantDims {
			t.Errorf("%s: dimensions sent = %v, want %v", tc.provider, got, tc.wantDims)
		}
		if sent["model"] != presets[tc.provider].EmbedModel {
			t.Errorf("%s: model = %v", tc.provider, sent["model"])
		}
	}
}
