package embed

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/D0bby999/anytools/internal/security"
)

// DefaultGeminiBase carries its version segment — see
// security.NormalizeAPIBase.
const DefaultGeminiBase = "https://generativelanguage.googleapis.com/v1beta"

// DefaultGeminiEmbedModel is gemini-embedding-001, verified alive on a FREE key
// at 3072 dimensions (~/.claude/rules/9router-media-api.md, measured
// 2026-08-21). Its predecessors — embedding-001, text-embedding-004,
// text-embedding-005 — all answer 404 "not supported for embedContent"; do not
// offer them as alternatives.
const DefaultGeminiEmbedModel = "gemini-embedding-001"

// GeminiEmbedder calls :batchEmbedContents, with task_type set.
type GeminiEmbedder struct {
	apiKey  string
	apiBase string
	model   string
	dims    int
	hc      *http.Client
}

func NewGeminiEmbedder(apiKey, apiBase, model string, dims int) *GeminiEmbedder {
	base := security.NormalizeAPIBase(apiBase, "v1beta")
	if base == "" {
		base = DefaultGeminiBase
	}
	if model == "" {
		model = DefaultGeminiEmbedModel
	}
	return &GeminiEmbedder{apiKey: apiKey, apiBase: base, model: model, dims: dims, hc: newClient()}
}

var _ Embedder = (*GeminiEmbedder)(nil)

func (e *GeminiEmbedder) Name() string  { return "gemini" }
func (e *GeminiEmbedder) Model() string { return e.model }
func (e *GeminiEmbedder) Dims() int     { return e.dims }

// geminiTaskType maps AnyTools' Task onto Google's task_type values.
//
// This is the parameter that makes a question land near its answers rather than
// near other questions. Defaulting an unknown Task to the document type would
// silently degrade every query, so the mapping is total over the two values the
// type defines and falls back to the query type — the safer error, because a
// query embedded as a document is one bad search, while a corpus embedded as
// queries is a bad index.
func geminiTaskType(t Task) string {
	if t == TaskDocument {
		return "RETRIEVAL_DOCUMENT"
	}
	return "RETRIEVAL_QUERY"
}

func (e *GeminiEmbedder) Embed(ctx context.Context, texts []string, task Task) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}

	modelPath := "models/" + e.model
	requests := make([]any, 0, len(texts))
	for _, t := range texts {
		req := map[string]any{
			"model":     modelPath,
			"content":   map[string]any{"parts": []any{map[string]any{"text": t}}},
			"task_type": geminiTaskType(task),
		}
		// outputDimensionality is Gemini's Matryoshka truncation. Same rule as
		// OpenAI's `dimensions`: only sent once a width is pinned, so a first
		// call learns the native one.
		if e.dims > 0 {
			req["outputDimensionality"] = e.dims
		}
		requests = append(requests, req)
	}

	url := e.apiBase + "/" + modelPath + ":batchEmbedContents"
	raw, err := postJSON(ctx, e.hc, url, map[string]any{"requests": requests},
		map[string]string{"x-goog-api-key": e.apiKey})
	if err != nil {
		return nil, err
	}

	var r struct {
		Embeddings []struct {
			Values []float32 `json:"values"`
		} `json:"embeddings"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("gemini: decode embeddings: %w", err)
	}
	if len(r.Embeddings) != len(texts) {
		return nil, fmt.Errorf("gemini: asked for %d embeddings, got %d", len(texts), len(r.Embeddings))
	}

	out := make([][]float32, len(texts))
	for i, emb := range r.Embeddings {
		if len(emb.Values) == 0 {
			return nil, fmt.Errorf("gemini: empty embedding for input %d", i)
		}
		if e.dims > 0 && len(emb.Values) != e.dims {
			return nil, fmt.Errorf("%w: want %d, got %d", ErrDimensionMismatch, e.dims, len(emb.Values))
		}
		out[i] = emb.Values
	}
	return out, nil
}

func (e *GeminiEmbedder) Ping(ctx context.Context) (int, error) {
	vecs, err := e.Embed(ctx, []string{probeText}, TaskQuery)
	if err != nil {
		return 0, err
	}
	if len(vecs) != 1 || len(vecs[0]) == 0 {
		return 0, fmt.Errorf("gemini: embed verify returned no vector")
	}
	return len(vecs[0]), nil
}
