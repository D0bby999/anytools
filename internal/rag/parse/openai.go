package parse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/D0bby999/anytools/internal/security"
)

// DefaultOpenAIBase carries its version segment for the reason recorded in
// security.NormalizeAPIBase: a base missing one is not an error the user sees,
// it is a silent empty answer.
const DefaultOpenAIBase = "https://api.openai.com/v1"

// DefaultOpenAIParseModel — UNMEASURED. The spike could not score this lane at
// all: the owner's key answered 429 `credit_balance_exhausted` in 3.4 s
// (reports/spike-parse.md). The wire format below is from OpenAI's Responses
// documentation and compiles, but no page-accuracy number exists for it, so the
// fallback order "Gemini → OpenAI → Anthropic" is designed, not measured.
const DefaultOpenAIParseModel = "gpt-4o"

// OpenAIParser converts PDFs with the Responses API's input_file part.
type OpenAIParser struct {
	apiKey    string
	apiBase   string
	model     string
	maxOutput int
	hc        *http.Client
}

func NewOpenAIParser(apiKey, apiBase, model string) *OpenAIParser {
	base := security.NormalizeAPIBase(apiBase, "v1")
	if base == "" {
		base = DefaultOpenAIBase
	}
	if model == "" {
		model = DefaultOpenAIParseModel
	}
	return &OpenAIParser{apiKey: apiKey, apiBase: base, model: model, maxOutput: 32768, hc: newClient()}
}

var _ DocumentParser = (*OpenAIParser)(nil)

func (o *OpenAIParser) Name() string  { return "openai" }
func (o *OpenAIParser) Model() string { return o.model }

func (o *OpenAIParser) ParsePages(ctx context.Context, pdfBytes []byte, startPage, endPage int) (Result, error) {
	return o.respond(ctx, map[string]any{
		"type":     "input_file",
		"filename": fmt.Sprintf("pages-%d-%d.pdf", startPage, endPage),
		// The Responses API takes an inline file as a data URI, not as
		// bare base64 — the same shape a browser <input type=file>
		// would produce.
		"file_data": "data:application/pdf;base64," + base64.StdEncoding.EncodeToString(pdfBytes),
	}, Prompt(startPage, endPage))
}

// openaiImageTypes are the photo types an `input_image` part takes; HEIC is
// not one of them.
var openaiImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true}

// ParseImage reads one photo (up-methods phase 16) as an `input_image` data
// URI at full detail, since the text on it is the whole point.
func (o *OpenAIParser) ParseImage(ctx context.Context, image []byte, mime string) (Result, error) {
	if !openaiImageTypes[mime] {
		return Result{}, fmt.Errorf("openai: %w (%s)", ErrImageNotAccepted, mime)
	}
	return o.respond(ctx, map[string]any{
		"type":      "input_image",
		"image_url": "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(image),
		"detail":    "high",
	}, ImagePrompt())
}

func (o *OpenAIParser) respond(ctx context.Context, part map[string]any, prompt string) (Result, error) {
	body := map[string]any{
		"model": o.model,
		"input": []any{map[string]any{"role": "user", "content": []any{
			part,
			map[string]any{"type": "input_text", "text": prompt},
		}}},
		"max_output_tokens": o.maxOutput,
	}

	raw, err := postJSON(ctx, o.hc, o.apiBase+"/responses", body,
		map[string]string{"Authorization": "Bearer " + o.apiKey})
	if err != nil {
		return Result{}, err
	}

	var r struct {
		Status            string `json:"status"`
		IncompleteDetails *struct {
			Reason string `json:"reason"`
		} `json:"incomplete_details"`
		Output []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return Result{}, fmt.Errorf("openai: decode response: %w", err)
	}

	out := Result{
		FinishReason: r.Status,
		InputTokens:  r.Usage.InputTokens,
		OutputTokens: r.Usage.OutputTokens,
	}
	if r.IncompleteDetails != nil {
		out.FinishReason = r.Status + ":" + r.IncompleteDetails.Reason
	}
	// The Responses API reports completion in `status`, not in a per-choice
	// finish_reason: anything but "completed" means the answer is partial.
	out.Truncated = r.Status != "completed"
	for _, item := range r.Output {
		for _, c := range item.Content {
			if c.Type == "output_text" {
				out.Markdown += c.Text
			}
		}
	}
	return out, nil
}

func (o *OpenAIParser) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	r, err := o.ParsePages(ctx, probePDF(), 1, 1)
	return checkPing("openai", r, err)
}
