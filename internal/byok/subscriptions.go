package byok

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/store"
)

// subscriptions.go — the two sign-in lanes that complete in two steps: GitHub
// Copilot (device code) and Claude Pro/Max (pasted code). Both sit behind the
// experimental flag like the ChatGPT and Gemini lanes, and both end the same
// way: a connection row plus its encrypted tokens, or nothing.

// StartCopilot begins a Copilot device sign-in.
func (s *Service) StartCopilot(ctx context.Context, userID uuid.UUID) (*oauth.CopilotStart, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	return oauth.StartCopilot(ctx, userID)
}

// FinishCopilot polls GitHub once and, when the user has approved, stores
// the connection. oauth.ErrStillPending means "not yet".
func (s *Service) FinishCopilot(ctx context.Context, userID uuid.UUID, sessionID, name string) (*store.ProviderConnection, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	res, err := oauth.FinishCopilot(ctx, userID, sessionID)
	if err != nil {
		return nil, err
	}
	return s.saveSubscription(ctx, userID, subscriptionRow{
		provider: providers.ProviderGitHubCopilot, kind: store.KindOAuthCopilot,
		name: name, defaultName: "GitHub Copilot",
		meta:   store.OAuthMeta{Flow: string(oauth.FlowGitHubCopilot), AccountID: res.AccountID, Scope: res.Scope},
		tokens: res,
	})
}

// StartClaude begins a Claude subscription sign-in.
func (s *Service) StartClaude(userID uuid.UUID) (*oauth.ClaudeStart, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	return oauth.StartClaude(userID), nil
}

// FinishClaude exchanges the pasted code and stores the connection.
func (s *Service) FinishClaude(ctx context.Context, userID uuid.UUID, sessionID, code, name string) (*store.ProviderConnection, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	if strings.TrimSpace(code) == "" {
		return nil, invalid("paste the code Claude showed after you approved")
	}
	res, err := oauth.FinishClaude(ctx, userID, sessionID, code)
	if err != nil {
		return nil, err
	}
	return s.saveSubscription(ctx, userID, subscriptionRow{
		provider: providers.ProviderClaudeSub, kind: store.KindOAuthClaudeSub,
		name: name, defaultName: "Claude subscription",
		// AccountID carries Anthropic's account uuid: the serve path sends it
		// in metadata.user_id (providers.WithAnthropicOAuth).
		meta:   store.OAuthMeta{Flow: string(oauth.FlowClaudeSub), DeviceID: res.DeviceID, AccountID: res.AccountUUID},
		tokens: &res.TokenResult,
	})
}

type subscriptionRow struct {
	provider, kind, name, defaultName string
	meta                              store.OAuthMeta
	tokens                            *oauth.TokenResult
}

// saveSubscription writes the connection and its tokens, removing the row if
// the tokens cannot be stored — a connection without tokens cannot serve.
func (s *Service) saveSubscription(ctx context.Context, userID uuid.UUID, r subscriptionRow) (*store.ProviderConnection, error) {
	name := strings.TrimSpace(r.name)
	if name == "" {
		name = r.defaultName
	}
	if len(name) > maxConnectionName {
		return nil, invalid("name must be %d characters or fewer", maxConnectionName)
	}
	meta := r.meta
	conn, err := s.conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: r.provider,
		Kind:     r.kind,
		Name:     name,
		Settings: store.ConnectionSettings{OAuth: &meta},
	})
	if errors.Is(err, store.ErrDuplicateConnectionName) {
		return nil, invalid("you already have a connection named %q", name)
	}
	if err != nil {
		return nil, err
	}
	var expires *time.Time
	if !r.tokens.ExpiresAt.IsZero() {
		expires = &r.tokens.ExpiresAt
	}
	if err := s.tokens.SaveTokens(ctx, userID, conn.ID, r.tokens.AccessToken, r.tokens.RefreshToken, expires); err != nil {
		_ = s.conns.DeleteConnection(ctx, userID, conn.ID)
		return nil, err
	}
	return conn, nil
}
