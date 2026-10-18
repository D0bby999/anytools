package parse

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// DefaultGeminiBase is Google's generative-language endpoint, version segment
// included. A stored api_base is normalised against this by
// security.NormalizeAPIBase before it reaches here.
const DefaultGeminiBase = "https://generativelanguage.googleapis.com/v1beta"

// DefaultGeminiParseModel is the lane the spike measured: 2/2 on tables, 10/10
// on page attribution, 0 truncations on a 19-page document
// (reports/spike-parse.md). Model ids move fast — see internal/byok/models.go
// for the dated list and the rule about changing them.
const DefaultGeminiParseModel = "gemini-3.6-flash"

// GeminiParser converts PDFs with generateContent and an inline PDF part.
type GeminiParser struct {
	apiKey    string
	apiBase   string
	model     string
	maxOutput int
	hc        *http.Client
}

// NewGeminiParser builds the Gemini lane. apiBase may be empty for the default.
func NewGeminiParser(apiKey, apiBase, model string) *GeminiParser {
	base := security.NormalizeAPIBase(apiBase, "v1beta")
	if base == "" {
		base = DefaultGeminiBase
	}
	if model == "" {
		model = DefaultGeminiParseModel
	}
	return &GeminiParser{apiKey: apiKey, apiBase: base, model: model, maxOutput: 32768, hc: newClient()}
}

var _ DocumentParser = (*GeminiParser)(nil)

func (g *GeminiParser) Name() string  { return "gemini" }
func (g *GeminiParser) Model() string { return g.model }

func (g *GeminiParser) ParsePages(ctx context.Context, pdfBytes []byte, startPage, endPage int) (Result, error) {
	return g.generate(ctx, "application/pdf", pdfBytes, Prompt(startPage, endPage))
}

// geminiImageTypes are the photo types generateContent takes inline. Gemini
// is the one lane that reads HEIC.
var geminiImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, MimeHEIC: true}

// ParseImage reads one photo (up-methods phase 16): the same inline part as
// a PDF, with the photo's own type.
func (g *GeminiParser) ParseImage(ctx context.Context, image []byte, mime string) (Result, error) {
	if !geminiImageTypes[mime] {
		return Result{}, fmt.Errorf("gemini: %w (%s)", ErrImageNotAccepted, mime)
	}
	return g.generate(ctx, mime, image, ImagePrompt())
}

func (g *GeminiParser) generate(ctx context.Context, mime string, data []byte, prompt string) (Result, error) {
	gen := map[string]any{"maxOutputTokens": g.maxOutput, "temperature": 0}
	if strings.Contains(g.model, "2.5") {
		// 2.5-flash spends its output budget on thinking tokens; transcription
		// is the whole job here, so the budget goes to transcription.
		gen["thinkingConfig"] = map[string]any{"thinkingBudget": 0}
	}

	body := map[string]any{
		"contents": []any{map[string]any{"parts": []any{
			map[string]any{"inline_data": map[string]any{
				"mime_type": mime,
				"data":      base64.StdEncoding.EncodeToString(data),
			}},
			map[string]any{"text": prompt},
		}}},
		"generationConfig": gen,
	}

	url := g.apiBase + "/models/" + g.model + ":generateContent"
	raw, err := postJSON(ctx, g.hc, url, body, map[string]string{"x-goog-api-key": g.apiKey})
	if err != nil {
		return Result{}, err
	}

	var r struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return Result{}, fmt.Errorf("gemini: decode response: %w", err)
	}

	out := Result{
		InputTokens:  r.UsageMetadata.PromptTokenCount,
		OutputTokens: r.UsageMetadata.CandidatesTokenCount,
	}
	if len(r.Candidates) == 0 {
		// A 200 with no candidate is a refusal or a safety block, not an empty
		// document. Returning Result{} with no error here would let the caller
		// store a blank page as successfully parsed.
		//
		// The upstream body is NOT embedded: it reaches the user through
		// byok.VerifyErrorMessage, and a provider's body can echo the document
		// it was given. It goes to the debug log instead.
		slog.Debug("gemini: no candidate in parse response", "body", clip(string(raw)))
		return out, fmt.Errorf("gemini: %w", ErrNoCandidate)
	}
	out.FinishReason = r.Candidates[0].FinishReason
	out.Truncated = out.FinishReason != "STOP"
	for _, p := range r.Candidates[0].Content.Parts {
		out.Markdown += p.Text
	}
	return out, nil
}

func (g *GeminiParser) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	r, err := g.ParsePages(ctx, probePDF(), 1, 1)
	return checkPing("gemini", r, err)
}

// GeminiListModels returns the model ids this key may call for generateContent.
// Served by GET /v1/byok/connections/{id}/models so the routes editor offers a
// real list rather than a hardcoded one that goes stale.
func GeminiListModels(ctx context.Context, apiKey, apiBase string) ([]string, error) {
	base := security.NormalizeAPIBase(apiBase, "v1beta")
	if base == "" {
		base = DefaultGeminiBase
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/models?pageSize=200", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := security.SafeBYOKClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("gemini: list models: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini: list models: HTTP %d", resp.StatusCode)
	}

	var r struct {
		Models []struct {
			Name                       string   `json:"name"`
			SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, fmt.Errorf("gemini: decode model list: %w", err)
	}

	var names []string
	for _, m := range r.Models {
		for _, g := range m.SupportedGenerationMethods {
			if g == "generateContent" {
				names = append(names, strings.TrimPrefix(m.Name, "models/"))
				break
			}
		}
	}
	return names, nil
}
