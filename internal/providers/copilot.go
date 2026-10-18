package providers

// CopilotProvider serves GitHub Copilot chat with a user's GitHub sign-in.
//
// The stored credential is the long-lived GitHub token from the device grant
// (internal/oauth/copilot.go), which api.githubcopilot.com does NOT accept:
// it is exchanged for a Copilot session token that lasts about 25 minutes,
// and this wrapper rebuilds its inner OpenAI-compatible provider whenever that
// token rotates. Ported from postclaw internal/providers/copilot.go, whose
// wire details come from decolua/9router (MIT).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/security"
)

const (
	copilotSessionURL = "https://api.github.com/copilot_internal/v2/token"
	copilotAPIBase    = "https://api.githubcopilot.com"
	// copilotTokenLead refreshes the session token this long before expiry.
	copilotTokenLead = 2 * time.Minute

	// DefaultCopilotModel is included in every paid Copilot plan without
	// spending premium requests (dated 2026-09-26; route another to change it).
	DefaultCopilotModel = "gpt-5-mini"
)

// copilotIdentityHeaders mirror the VS Code Copilot Chat client; the API
// rejects callers without an editor identity.
var copilotIdentityHeaders = map[string]string{
	"Copilot-Integration-Id": "vscode-chat",
	"Editor-Version":         "vscode/1.110.0",
	"Editor-Plugin-Version":  "copilot-chat/0.38.0",
	"User-Agent":             "GitHubCopilotChat/0.38.0",
	"Openai-Intent":          "conversation-panel",
	"X-Github-Api-Version":   "2025-04-01",
	"X-Initiator":            "user",
}

// CopilotProvider implements Provider over a Copilot seat.
type CopilotProvider struct {
	github       TokenSource
	defaultModel string

	mu        sync.Mutex
	inner     *OpenAIProvider
	expiresAt time.Time

	sessionURL string
	apiBase    string
	client     *http.Client
}

// NewCopilotProvider builds the lane. github yields the stored GitHub token.
func NewCopilotProvider(github TokenSource, defaultModel string) *CopilotProvider {
	if defaultModel == "" {
		defaultModel = DefaultCopilotModel
	}
	return &CopilotProvider{
		github:       github,
		defaultModel: defaultModel,
		sessionURL:   copilotSessionURL,
		apiBase:      copilotAPIBase,
		// Fixed hosts: SafeClient, as for the Codex lane.
		client: security.SafeClient(30 * time.Second),
	}
}

func (p *CopilotProvider) Name() string         { return ProviderGitHubCopilot }
func (p *CopilotProvider) DefaultModel() string { return p.defaultModel }

// ensureInner exchanges the GitHub token for a Copilot session token when the
// cached one is missing or near expiry.
func (p *CopilotProvider) ensureInner(ctx context.Context) (*OpenAIProvider, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inner != nil && time.Now().Add(copilotTokenLead).Before(p.expiresAt) {
		return p.inner, nil
	}
	token, err := p.github.Token()
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, p.sessionURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/json")
	for k, v := range copilotIdentityHeaders {
		req.Header.Set(k, v)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("copilot: token exchange: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		// 401/403: the GitHub token was revoked, or the account has no
		// Copilot seat. An HTTPError lets the chain classify and bench it.
		return nil, &HTTPError{Status: resp.StatusCode, Body: "copilot token exchange refused"}
	}
	var out struct {
		Token     string `json:"token"`
		ExpiresAt int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Token == "" {
		return nil, fmt.Errorf("copilot: token exchange returned no token")
	}
	inner := NewOpenAIProvider(ProviderGitHubCopilot, out.Token, p.apiBase, p.defaultModel)
	inner.client = p.client
	inner.extraHeaders = copilotIdentityHeaders
	p.inner = inner
	if out.ExpiresAt > 0 {
		p.expiresAt = time.Unix(out.ExpiresAt, 0)
	} else {
		p.expiresAt = time.Now().Add(20 * time.Minute)
	}
	return p.inner, nil
}

func (p *CopilotProvider) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	inner, err := p.ensureInner(ctx)
	if err != nil {
		return nil, err
	}
	return inner.Chat(ctx, req)
}

func (p *CopilotProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (*ChatResponse, error) {
	inner, err := p.ensureInner(ctx)
	if err != nil {
		return nil, err
	}
	return inner.ChatStream(ctx, req, onChunk)
}

func (p *CopilotProvider) SupportsThinking() bool { return true }

var _ Provider = (*CopilotProvider)(nil)
