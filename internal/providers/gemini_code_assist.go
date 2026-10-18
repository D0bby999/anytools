package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

// gemini_code_assist.go — the Gemini subscription lane.
//
// DEVIATION, recorded rather than hidden: phase-04's port list says to skip
// postclaw's gemini_cloudcode.go, while also requiring the Gemini Code Assist
// OAuth lane behind the experimental flag. Taken literally that ships a lane a
// user can connect and onboard but which cannot answer anything, which is worse
// than not shipping it. So the serving client is here, written small rather
// than ported (postclaw's is 297 lines of catalog and tool plumbing this
// product does not use).
//
// The lane is BLOCKED on the owner's own account and known to be so: the spike
// measured HTTP 401 UNAUTHENTICATED from cloudcode-pa, and Google's earlier 403
// VALIDATION_REQUIRED is why the account was never assigned a project id at all
// (reports/spike-providers.md). The owner's action is to sign in once at
// antigravity.google with that account and re-run the onboard.
//
// Its scope is the reason it is experimental and off by default: the lane uses
// a THIRD PARTY's published installed-app client id with `cloud-platform`
// scope, so a leaked refresh token is a full Google Cloud takeover for that
// user — Storage, BigQuery, Compute, Secret Manager — not AI quota theft.
const (
	// CodeAssistAPIBase is Google's internal Code Assist surface. It is not the
	// public generativelanguage endpoint and does not accept an API key.
	CodeAssistAPIBase = "https://cloudcode-pa.googleapis.com/v1internal"
	// DefaultCodeAssistModel — a moving pin, see internal/byok/models.go.
	DefaultCodeAssistModel = "gemini-2.5-pro"
)

// ErrNoCodeAssistProject reports that Google never assigned this account a Code
// Assist project, which is what a 403 VALIDATION_REQUIRED actually means.
var ErrNoCodeAssistProject = errors.New("gemini_code_assist: this Google account has no Code Assist project")

// GeminiCodeAssistProvider serves chat from a Gemini Code Assist subscription.
type GeminiCodeAssistProvider struct {
	tokens       TokenSource
	projectID    string
	defaultModel string
	apiBase      string
	client       *http.Client
}

// NewGeminiCodeAssistProvider builds the lane. projectID comes from the onboard
// call; an empty one means the account was never granted a Code Assist tier,
// which is the state the spike found.
func NewGeminiCodeAssistProvider(tokens TokenSource, projectID, defaultModel string) *GeminiCodeAssistProvider {
	if defaultModel == "" {
		defaultModel = DefaultCodeAssistModel
	}
	return &GeminiCodeAssistProvider{
		tokens:       tokens,
		projectID:    projectID,
		defaultModel: defaultModel,
		apiBase:      CodeAssistAPIBase,
		// SafeClient: fixed host, so the BYOK private-endpoint hatch must
		// not apply here (refresh_by_flow.go makes the same choice).
		client: security.SafeClient(300 * time.Second),
	}
}

func (p *GeminiCodeAssistProvider) Name() string           { return "gemini_code_assist" }
func (p *GeminiCodeAssistProvider) DefaultModel() string   { return p.defaultModel }
func (p *GeminiCodeAssistProvider) SupportsThinking() bool { return true }

var _ Provider = (*GeminiCodeAssistProvider)(nil)

// buildBody wraps a Gemini generateContent request in the Code Assist envelope
// (`{project, model, request:{...}}`), which is what distinguishes this surface
// from the public one.
func (p *GeminiCodeAssistProvider) buildBody(model string, req ChatRequest) map[string]any {
	var systemParts []any
	contents := make([]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			systemParts = append(systemParts, map[string]any{"text": m.Content})
			continue
		}
		role := "user"
		if m.Role == "assistant" {
			role = "model"
		}
		contents = append(contents, map[string]any{
			"role":  role,
			"parts": []any{map[string]any{"text": m.Content}},
		})
	}

	inner := map[string]any{"contents": contents}
	if len(systemParts) > 0 {
		inner["systemInstruction"] = map[string]any{"parts": systemParts}
	}
	gen := map[string]any{}
	if v, ok := req.Options[OptMaxTokens]; ok {
		gen["maxOutputTokens"] = v
	}
	if v, ok := req.Options[OptTemperature]; ok {
		gen["temperature"] = v
	}
	if len(gen) > 0 {
		inner["generationConfig"] = gen
	}

	return map[string]any{"project": p.projectID, "model": model, "request": inner}
}

func (p *GeminiCodeAssistProvider) do(ctx context.Context, method string, body map[string]any) (io.ReadCloser, error) {
	if p.projectID == "" {
		// Failing here, by name, beats a 403 whose text ("VALIDATION_REQUIRED")
		// reads like a transient problem with the request.
		return nil, fmt.Errorf("gemini_code_assist: %w", ErrNoCodeAssistProject)
	}
	token, err := p.tokens.Token()
	if err != nil {
		return nil, fmt.Errorf("gemini_code_assist: no credentials: %w", err)
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("gemini_code_assist: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+":"+method, bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gemini_code_assist: create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+token)

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gemini_code_assist: request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		resp.Body.Close()
		return nil, &HTTPError{
			Status:     resp.StatusCode,
			Body:       "gemini_code_assist: " + string(respBody),
			RetryAfter: ParseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	return resp.Body, nil
}

// codeAssistResponse is the envelope shape both the unary and streamed calls
// return: a `response` object holding an ordinary Gemini candidate list.
type codeAssistResponse struct {
	Response struct {
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
	} `json:"response"`
}

func (r *codeAssistResponse) text() string {
	var sb strings.Builder
	if len(r.Response.Candidates) > 0 {
		for _, part := range r.Response.Candidates[0].Content.Parts {
			sb.WriteString(part.Text)
		}
	}
	return sb.String()
}

func (p *GeminiCodeAssistProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	model := req.Model
	if model == "" {
		model = p.defaultModel
	}
	return RetryDo(ctx, DefaultRetryConfig(), func() (*ChatResponse, error) {
		body, err := p.do(ctx, "generateContent", p.buildBody(model, req))
		if err != nil {
			return nil, err
		}
		defer body.Close()

		var r codeAssistResponse
		if err := json.NewDecoder(body).Decode(&r); err != nil {
			return nil, fmt.Errorf("gemini_code_assist: decode response: %w", err)
		}
		out := &ChatResponse{Content: r.text(), FinishReason: "stop"}
		if len(r.Response.Candidates) > 0 {
			out.RawFinishReason = r.Response.Candidates[0].FinishReason
			if out.RawFinishReason == "MAX_TOKENS" {
				out.FinishReason = "length"
			}
		}
		out.Usage = &Usage{
			PromptTokens:     r.Response.UsageMetadata.PromptTokenCount,
			CompletionTokens: r.Response.UsageMetadata.CandidatesTokenCount,
			TotalTokens:      r.Response.UsageMetadata.PromptTokenCount + r.Response.UsageMetadata.CandidatesTokenCount,
		}
		if out.Content == "" {
			return nil, fmt.Errorf("gemini_code_assist: %w", ErrEmptyResponse)
		}
		return out, nil
	})
}

func (p *GeminiCodeAssistProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error) {
	model := req.Model
	if model == "" {
		model = p.defaultModel
	}

	body, err := RetryDo(ctx, DefaultRetryConfig(), func() (io.ReadCloser, error) {
		return p.do(ctx, "streamGenerateContent?alt=sse", p.buildBody(model, req))
	})
	if err != nil {
		return nil, err
	}
	defer body.Close()

	result := &ChatResponse{FinishReason: "stop"}
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var r codeAssistResponse
		if json.Unmarshal([]byte(payload), &r) != nil {
			continue
		}
		if chunk := r.text(); chunk != "" {
			result.Content += chunk
			if onChunk != nil {
				onChunk(StreamChunk{Content: chunk})
			}
		}
		if r.Response.UsageMetadata.CandidatesTokenCount > 0 {
			result.Usage = &Usage{
				PromptTokens:     r.Response.UsageMetadata.PromptTokenCount,
				CompletionTokens: r.Response.UsageMetadata.CandidatesTokenCount,
				TotalTokens:      r.Response.UsageMetadata.PromptTokenCount + r.Response.UsageMetadata.CandidatesTokenCount,
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("gemini_code_assist: stream read error: %w", err)
	}
	if result.Content == "" {
		return nil, fmt.Errorf("gemini_code_assist: %w", ErrEmptyResponse)
	}
	if onChunk != nil {
		onChunk(StreamChunk{Done: true})
	}
	return result, nil
}
