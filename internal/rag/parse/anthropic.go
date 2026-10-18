package parse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/D0bby999/anytools/internal/security"
)

// DefaultAnthropicBase, version segment included — this is the exact lane where
// the missing-version failure was measured: ".../api/anthropic" plus the
// client's own "/messages" returned HTTP 200 with an empty body and
// finish_reason "stop" (reports/spike-providers.md).
const DefaultAnthropicBase = "https://api.anthropic.com/v1"

// DefaultAnthropicParseModel — UNMEASURED, and less measured than it looks. The
// spike's Anthropic lane pointed at z.ai's Anthropic-protocol endpoint, whose
// balance was zero (429, code 1113), so whether an Anthropic-compatible gateway
// accepts a `document` content block AT ALL is still unknown
// (reports/spike-parse.md, "BLOCKED"). Only api.anthropic.com is documented to.
const DefaultAnthropicParseModel = "claude-sonnet-4-5-20250929"

const anthropicAPIVersion = "2023-06-01"

// AnthropicParser converts PDFs with a `document` content block.
type AnthropicParser struct {
	apiKey    string
	apiBase   string
	model     string
	maxOutput int
	hc        *http.Client
}

func NewAnthropicParser(apiKey, apiBase, model string) *AnthropicParser {
	base := security.NormalizeAPIBase(apiBase, "v1")
	if base == "" {
		base = DefaultAnthropicBase
	}
	if model == "" {
		model = DefaultAnthropicParseModel
	}
	return &AnthropicParser{apiKey: apiKey, apiBase: base, model: model, maxOutput: 32768, hc: newClient()}
}

var _ DocumentParser = (*AnthropicParser)(nil)

func (a *AnthropicParser) Name() string  { return "anthropic" }
func (a *AnthropicParser) Model() string { return a.model }

func (a *AnthropicParser) ParsePages(ctx context.Context, pdfBytes []byte, startPage, endPage int) (Result, error) {
	return a.message(ctx, "document", "application/pdf", pdfBytes, Prompt(startPage, endPage))
}

// anthropicImageTypes are the photo types an `image` block takes; HEIC is not
// one of them.
var anthropicImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true}

// anthropicMaxImageBase64 is the Messages API's cap on one image, which it
// measures on the base64 text: about 3.75 MB of photo.
const anthropicMaxImageBase64 = 5 << 20

// ParseImage reads one photo (up-methods phase 16) as an `image` block. A
// photo over the API's cap is declined here rather than spent on a 400.
func (a *AnthropicParser) ParseImage(ctx context.Context, image []byte, mime string) (Result, error) {
	if !anthropicImageTypes[mime] || base64.StdEncoding.EncodedLen(len(image)) > anthropicMaxImageBase64 {
		return Result{}, fmt.Errorf("anthropic: %w (%s, %d bytes)", ErrImageNotAccepted, mime, len(image))
	}
	return a.message(ctx, "image", mime, image, ImagePrompt())
}

func (a *AnthropicParser) message(ctx context.Context, block, mime string, data []byte, prompt string) (Result, error) {
	body := map[string]any{
		"model":      a.model,
		"max_tokens": a.maxOutput,
		"messages": []any{map[string]any{"role": "user", "content": []any{
			map[string]any{"type": block, "source": map[string]any{
				"type":       "base64",
				"media_type": mime,
				"data":       base64.StdEncoding.EncodeToString(data),
			}},
			map[string]any{"type": "text", "text": prompt},
		}}},
	}

	raw, err := postJSON(ctx, a.hc, a.apiBase+"/messages", body, map[string]string{
		"x-api-key":         a.apiKey,
		"anthropic-version": anthropicAPIVersion,
	})
	if err != nil {
		return Result{}, err
	}

	var r struct {
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return Result{}, fmt.Errorf("anthropic: decode response: %w", err)
	}

	out := Result{
		FinishReason: r.StopReason,
		Truncated:    r.StopReason != "end_turn" && r.StopReason != "stop_sequence",
		InputTokens:  r.Usage.InputTokens,
		OutputTokens: r.Usage.OutputTokens,
	}
	for _, c := range r.Content {
		if c.Type == "text" {
			out.Markdown += c.Text
		}
	}
	return out, nil
}

func (a *AnthropicParser) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	r, err := a.ParsePages(ctx, probePDF(), 1, 1)
	return checkPing("anthropic", r, err)
}
