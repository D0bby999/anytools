package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/security"
)

// codex.go — the ChatGPT subscription lane, RELAY ONLY.
//
// Read the mechanism finding before changing anything here
// (reports/spike-providers.md, lane "Codex / ChatGPT relay"): postclaw's
// authorisation step is a PKCE loopback on the USER'S OWN 127.0.0.1:1455 that
// shells out to a local browser, and OpenAI publishes no device flow. A hosted,
// multi-tenant origin therefore CANNOT complete this lane. The only shape that
// works on a server is the relay: the user obtains a token triple themselves
// and hands it over, and the server merely stores, refreshes and uses it. There
// must never be a server-side authorisation step in this file.
//
// What the spike DID prove, live: the stored access token works server-side —
// HTTP 200, first content delta in 1.7-2.8 s.
//
// The client identity below is copied verbatim from postclaw's codex_build.go
// because a paraphrase would be a different request. It is also the honest
// shape of the ToS exposure RT-1 names: this is a hosted server presenting
// itself to chatgpt.com as the first-party Codex CLI on the user's laptop. That
// is why the lane is experimental, off by default, and carries the warning copy
// in Settings.
const (
	codexOriginator = "codex_cli_rs"
	codexUserAgent  = "codex_cli_rs/0.136.0"
	// CodexAPIBase is chatgpt.com's backend, not api.openai.com. A subscription
	// token is not an API key and the two endpoints do not accept each other's
	// credentials.
	CodexAPIBase = "https://chatgpt.com/backend-api"
	// DefaultCodexModel — a moving pin, see internal/byok/models.go.
	DefaultCodexModel = "gpt-5.6-sol"
)

// CodexProvider serves chat from a ChatGPT subscription token.
type CodexProvider struct {
	tokens       TokenSource
	accountID    string
	defaultModel string
	apiBase      string
	client       *http.Client
	sessionID    string
}

// NewCodexProvider builds the relay lane. accountID is the user's
// chatgpt-account-id, which is mandatory: without it chatgpt.com cannot tell
// which subscription a multi-tenant request is spending.
func NewCodexProvider(tokens TokenSource, accountID, defaultModel string) *CodexProvider {
	if defaultModel == "" {
		defaultModel = DefaultCodexModel
	}
	return &CodexProvider{
		tokens:       tokens,
		accountID:    accountID,
		defaultModel: defaultModel,
		apiBase:      CodexAPIBase,
		// SafeClient, not SafeBYOKClient: this lane's host is fixed, so
		// ANYTOOLS_BYOK_ALLOW_PRIVATE_ENDPOINTS — which exists for a
		// user-supplied base URL — has no business relaxing it.
		client: security.SafeClient(300 * time.Second),
		// One session id for the life of this provider instance, so a turn
		// looks like one client rather than N.
		sessionID: uuid.NewString(),
	}
}

func (p *CodexProvider) Name() string           { return "chatgpt_relay" }
func (p *CodexProvider) DefaultModel() string   { return p.defaultModel }
func (p *CodexProvider) SupportsThinking() bool { return true }

var _ Provider = (*CodexProvider)(nil)

// buildBody maps AnyTools messages onto the Responses API's `instructions` +
// `input` shape.
//
// Tool calls are deliberately NOT mapped. The Responses API expresses them
// differently from chat-completions, and this lane is experimental, off by
// default and unable to be authorised on a server — building a second tool
// protocol for it would be the most speculative code in the repo. Phase 6's
// grounded chat uses tools, so the readiness matrix reports this lane as
// chat-only rather than letting a tool turn fail at runtime.
func (p *CodexProvider) buildBody(model string, req ChatRequest, stream bool) map[string]any {
	var instructions []string
	input := make([]any, 0, len(req.Messages))
	for _, m := range req.Messages {
		if m.Role == "system" {
			instructions = append(instructions, StripCacheMarker(m.Content))
			continue
		}
		role := m.Role
		if role == "tool" {
			// A tool result with nowhere to go is still context the model needs.
			role = "user"
		}
		input = append(input, map[string]any{"role": role, "content": m.Content})
	}

	body := map[string]any{
		"model":  model,
		"input":  input,
		"stream": stream,
		// store:false keeps the conversation off OpenAI's servers. AnyTools
		// already holds the transcript; leaving a second copy in someone else's
		// account is not ours to opt the user into.
		"store": false,
	}
	if len(instructions) > 0 {
		body["instructions"] = strings.Join(instructions, "\n\n")
	}
	if v, ok := req.Options[OptMaxTokens]; ok {
		body["max_output_tokens"] = v
	}
	return body
}

func (p *CodexProvider) do(ctx context.Context, body map[string]any) (io.ReadCloser, error) {
	token, err := p.tokens.Token()
	if err != nil {
		return nil, fmt.Errorf("chatgpt_relay: no credentials: %w", err)
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("chatgpt_relay: marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+"/codex/responses", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("chatgpt_relay: create request: %w", err)
	}
	h := httpReq.Header
	h.Set("Content-Type", "application/json")
	h.Set("Authorization", "Bearer "+token)
	h.Set("OpenAI-Beta", "responses=v1")
	h.Set("chatgpt-account-id", p.accountID)
	h.Set("originator", codexOriginator)
	h.Set("session_id", p.sessionID)
	h.Set("User-Agent", codexUserAgent)
	h.Set("x-client-request-id", uuid.NewString())

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chatgpt_relay: request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		resp.Body.Close()
		return nil, &HTTPError{
			Status:     resp.StatusCode,
			Body:       "chatgpt_relay: " + string(respBody),
			RetryAfter: ParseRetryAfter(resp.Header.Get("Retry-After")),
		}
	}
	return resp.Body, nil
}

func (p *CodexProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	model := req.Model
	if model == "" {
		model = p.defaultModel
	}
	return RetryDo(ctx, DefaultRetryConfig(), func() (*ChatResponse, error) {
		body, err := p.do(ctx, p.buildBody(model, req, false))
		if err != nil {
			return nil, err
		}
		defer body.Close()

		var r struct {
			Status string `json:"status"`
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
		if err := json.NewDecoder(body).Decode(&r); err != nil {
			return nil, fmt.Errorf("chatgpt_relay: decode response: %w", err)
		}

		out := &ChatResponse{FinishReason: "stop", RawFinishReason: r.Status}
		if r.Status != "completed" {
			out.FinishReason = "length"
		}
		for _, item := range r.Output {
			for _, c := range item.Content {
				if c.Type == "output_text" {
					out.Content += c.Text
				}
			}
		}
		out.Usage = &Usage{
			PromptTokens:     r.Usage.InputTokens,
			CompletionTokens: r.Usage.OutputTokens,
			TotalTokens:      r.Usage.InputTokens + r.Usage.OutputTokens,
		}
		if out.Content == "" {
			return nil, fmt.Errorf("chatgpt_relay: %w", ErrEmptyResponse)
		}
		return out, nil
	})
}

func (p *CodexProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error) {
	model := req.Model
	if model == "" {
		model = p.defaultModel
	}

	body, err := RetryDo(ctx, DefaultRetryConfig(), func() (io.ReadCloser, error) {
		return p.do(ctx, p.buildBody(model, req, true))
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
		if payload == "[DONE]" {
			break
		}
		var ev struct {
			Type     string `json:"type"`
			Delta    string `json:"delta"`
			Response struct {
				Usage struct {
					InputTokens  int `json:"input_tokens"`
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
			} `json:"response"`
		}
		if json.Unmarshal([]byte(payload), &ev) != nil {
			continue
		}
		switch ev.Type {
		case "response.output_text.delta":
			if ev.Delta != "" {
				result.Content += ev.Delta
				if onChunk != nil {
					onChunk(StreamChunk{Content: ev.Delta})
				}
			}
		case "response.completed":
			result.Usage = &Usage{
				PromptTokens:     ev.Response.Usage.InputTokens,
				CompletionTokens: ev.Response.Usage.OutputTokens,
				TotalTokens:      ev.Response.Usage.InputTokens + ev.Response.Usage.OutputTokens,
			}
		}
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("chatgpt_relay: stream read error: %w", err)
	}
	if result.Content == "" {
		return nil, fmt.Errorf("chatgpt_relay: %w", ErrEmptyResponse)
	}
	if onChunk != nil {
		onChunk(StreamChunk{Done: true})
	}
	return result, nil
}
