package embed

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/D0bby999/anytools/internal/security"
)

// DefaultOpenAIBase carries its version segment — see
// security.NormalizeAPIBase.
const DefaultOpenAIBase = "https://api.openai.com/v1"

// DefaultOpenAIEmbedModel is text-embedding-3-small at its native 1536.
// Phase 5's column is halfvec(3072) with zero padding precisely so a 1536-wide
// model is a first-class choice rather than a migration (red-team RT-6).
const DefaultOpenAIEmbedModel = "text-embedding-3-small"

// OpenAIEmbedder calls POST /v1/embeddings.
type OpenAIEmbedder struct {
	apiKey  string
	apiBase string
	model   string
	dims    int
	hc      *http.Client
	// noDimsField: the endpoint rejects OpenAI's `dimensions` (Mistral).
	noDimsField bool
}

// WithoutDimensionsField stops the embedder sending `dimensions`, for an
// OpenAI-compatible endpoint that rejects the field. The model's native width
// is then the only width, and a mismatch is still reported by Embed.
func (e *OpenAIEmbedder) WithoutDimensionsField() *OpenAIEmbedder {
	e.noDimsField = true
	return e
}

// NewOpenAIEmbedder builds the OpenAI lane. dims may be zero when the width is
// not yet known; it is filled in by the first verify ping.
func NewOpenAIEmbedder(apiKey, apiBase, model string, dims int) *OpenAIEmbedder {
	base := security.NormalizeAPIBase(apiBase, "v1")
	if base == "" {
		base = DefaultOpenAIBase
	}
	if model == "" {
		model = DefaultOpenAIEmbedModel
	}
	return &OpenAIEmbedder{apiKey: apiKey, apiBase: base, model: model, dims: dims, hc: newClient()}
}

var _ Embedder = (*OpenAIEmbedder)(nil)

func (e *OpenAIEmbedder) Name() string  { return "openai" }
func (e *OpenAIEmbedder) Model() string { return e.model }
func (e *OpenAIEmbedder) Dims() int     { return e.dims }

// Embed sends every input in one request. Batching policy — how many chunks go
// into one call, and what to do when one is too long — is phase 5's; this
// method does what it is asked and reports a width mismatch rather than
// silently returning vectors the caller's table cannot hold.
func (e *OpenAIEmbedder) Embed(ctx context.Context, texts []string, _ Task) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	body := map[string]any{"model": e.model, "input": texts}
	// OpenAI's `dimensions` truncates the vector server-side for the -3 models.
	// Sending it only when a width is already pinned means a first call learns
	// the native width instead of imposing one.
	if e.dims > 0 && !e.noDimsField {
		body["dimensions"] = e.dims
	}

	raw, err := postJSON(ctx, e.hc, e.apiBase+"/embeddings", body,
		map[string]string{"Authorization": "Bearer " + e.apiKey})
	if err != nil {
		return nil, err
	}

	var r struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("openai: decode embeddings: %w", err)
	}
	if len(r.Data) != len(texts) {
		return nil, fmt.Errorf("openai: asked for %d embeddings, got %d", len(texts), len(r.Data))
	}

	// The API documents `index` and returns them in order, but the contract the
	// caller depends on is "one vector per input, in input order" — placing by
	// index makes that true even if a provider ever answers out of order.
	out := make([][]float32, len(texts))
	for _, d := range r.Data {
		if d.Index < 0 || d.Index >= len(out) {
			return nil, fmt.Errorf("openai: embedding index %d out of range", d.Index)
		}
		if e.dims > 0 && len(d.Embedding) != e.dims {
			return nil, fmt.Errorf("%w: want %d, got %d", ErrDimensionMismatch, e.dims, len(d.Embedding))
		}
		out[d.Index] = d.Embedding
	}
	for i, v := range out {
		if v == nil {
			return nil, fmt.Errorf("openai: no embedding returned for input %d", i)
		}
	}
	return out, nil
}

func (e *OpenAIEmbedder) Ping(ctx context.Context) (int, error) {
	vecs, err := e.Embed(ctx, []string{probeText}, TaskQuery)
	if err != nil {
		return 0, err
	}
	if len(vecs) != 1 || len(vecs[0]) == 0 {
		return 0, fmt.Errorf("openai: embed verify returned no vector")
	}
	return len(vecs[0]), nil
}
