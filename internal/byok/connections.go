package byok

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/oauth"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/security"
	"github.com/D0bby999/anytools/internal/store"
)

// ErrInvalidInput is returned for a request the user can fix. The wrapped text
// is written to be shown to them, so it never carries an upstream error body,
// a URL with a key in it, or a database message.
var ErrInvalidInput = errors.New("byok: invalid input")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalidInput, fmt.Sprintf(format, args...))
}

// apiKeyProviders are the providers a user connects by pasting a key: the
// catalog's API-key and custom rows. The subscription providers are
// deliberately absent: they are created by the OAuth endpoints, and accepting
// one here would mean accepting a pasted access token as if it were a key,
// with no refresh token and therefore a one-hour lifespan.
var apiKeyProviders = func() map[string]bool {
	out := map[string]bool{}
	for _, p := range APIKeyProviders() {
		out[p] = true
	}
	return out
}()

// APIKeyProviders lists, in display order, the providers a key connects.
func APIKeyProviders() []string {
	var out []string
	for _, r := range catalogRows {
		if r.Auth == AuthAPIKey || r.Auth == AuthCustom {
			out = append(out, r.Type)
		}
	}
	return out
}

// NewConnection is the request to add an API-key connection.
type NewConnection struct {
	Provider string
	Name     string
	APIBase  string
	Secret   string
}

const maxConnectionName = 60

// CreateConnection validates and stores one pasted credential.
//
// The api_base check is the security-relevant part and it happens HERE, at
// write time, in addition to the connect-time guard in security.SafeBYOKClient.
// Two layers, because they fail differently: the write-time check gives the user
// a sentence they can act on ("only https endpoints are allowed"), while the
// connect-time one catches the case the write-time check cannot — a hostname
// that resolved publicly when it was saved and resolves to 169.254.169.254 when
// it is used.
func (s *Service) CreateConnection(ctx context.Context, userID uuid.UUID, in NewConnection) (*store.ProviderConnection, error) {
	provider := strings.TrimSpace(in.Provider)
	if !apiKeyProviders[provider] {
		return nil, invalid("unknown provider %q", provider)
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		// A blank name would leave the routes editor showing an empty row, so
		// it is filled rather than refused — the user named a provider, which
		// is enough to identify one connection.
		name = provider
	}
	if len(name) > maxConnectionName {
		return nil, invalid("name must be %d characters or fewer", maxConnectionName)
	}

	secret := strings.TrimSpace(in.Secret)
	if secret == "" {
		return nil, invalid("an API key is required")
	}

	apiBase := strings.TrimSpace(in.APIBase)
	if provider == providers.ProviderOpenAICompat && apiBase == "" {
		// Every other provider has a default endpoint; this one IS the endpoint.
		return nil, invalid("a base URL is required for an OpenAI-compatible endpoint")
	}
	if err := security.ValidateBYOKEndpoint(apiBase); err != nil {
		return nil, invalid("%s", endpointErrorMessage(err))
	}
	apiBase = normalizeBaseFor(provider, apiBase)

	conn, err := s.conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: provider,
		Kind:     store.KindAPIKey,
		Name:     name,
		APIBase:  apiBase,
		Secret:   secret,
	})
	if errors.Is(err, store.ErrDuplicateConnectionName) {
		return nil, invalid("you already have a connection named %q", name)
	}
	return conn, err
}

// UpdateConnection renames a connection, repoints its base URL, or replaces its
// key.
func (s *Service) UpdateConnection(ctx context.Context, userID, id uuid.UUID, in store.ConnectionUpdate) (*store.ProviderConnection, error) {
	existing, err := s.conns.GetConnection(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" || len(name) > maxConnectionName {
			return nil, invalid("name must be between 1 and %d characters", maxConnectionName)
		}
		in.Name = &name
	}
	if in.APIBase != nil {
		base := strings.TrimSpace(*in.APIBase)
		if existing.Provider == providers.ProviderOpenAICompat && base == "" {
			return nil, invalid("a base URL is required for an OpenAI-compatible endpoint")
		}
		if err := security.ValidateBYOKEndpoint(base); err != nil {
			return nil, invalid("%s", endpointErrorMessage(err))
		}
		base = normalizeBaseFor(existing.Provider, base)
		in.APIBase = &base
	}
	if in.Secret != nil {
		secret := strings.TrimSpace(*in.Secret)
		if secret == "" {
			// "Clear the key" is not an operation: a connection without a key
			// cannot serve, and deleting it is the honest way to say so.
			return nil, invalid("an API key is required — delete the connection instead of clearing its key")
		}
		if existing.Kind != store.KindAPIKey {
			return nil, invalid("a subscription connection has no API key to replace — reconnect it instead")
		}
		in.Secret = &secret
	}

	conn, err := s.conns.UpdateConnection(ctx, userID, id, in)
	if errors.Is(err, store.ErrDuplicateConnectionName) {
		return nil, invalid("you already have a connection with that name")
	}
	return conn, err
}

// DeleteConnection removes a connection. Its route entries and OAuth tokens go
// with it by ON DELETE CASCADE, which is why there is no cleanup code here: a
// route pointing at a deleted connection is a state the database refuses to
// hold rather than one this function has to remember to prevent.
func (s *Service) DeleteConnection(ctx context.Context, userID, id uuid.UUID) error {
	return s.conns.DeleteConnection(ctx, userID, id)
}

// ListConnections returns the user's connections, without secrets.
func (s *Service) ListConnections(ctx context.Context, userID uuid.UUID) ([]store.ProviderConnection, error) {
	return s.conns.ListConnections(ctx, userID)
}

// SaveRelayConnection stores a pasted ChatGPT token triple as a connection.
//
// Relay-only by construction: this function RECEIVES tokens the user obtained
// themselves. There is no companion "start the ChatGPT authorisation" function
// and there cannot be one — the flow's redirect target is the user's own
// 127.0.0.1:1455 (reports/spike-providers.md).
func (s *Service) SaveRelayConnection(ctx context.Context, userID uuid.UUID, name string, tokens oauth.RelayTokens) (*store.ProviderConnection, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	if err := tokens.Validate(); err != nil {
		return nil, fmt.Errorf("%w: %s", ErrInvalidInput, err.Error())
	}
	res := tokens.Result()

	if strings.TrimSpace(name) == "" {
		name = "ChatGPT subscription"
	}
	conn, err := s.conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: providers.ProviderChatGPTRelay,
		Kind:     store.KindOAuthRelay,
		Name:     strings.TrimSpace(name),
		Settings: store.ConnectionSettings{OAuth: &store.OAuthMeta{
			Flow:      string(oauth.FlowChatGPTRelay),
			AccountID: res.AccountID,
		}},
	})
	if errors.Is(err, store.ErrDuplicateConnectionName) {
		return nil, invalid("you already have a connection named %q", name)
	}
	if err != nil {
		return nil, err
	}

	var expires *time.Time
	if !res.ExpiresAt.IsZero() {
		expires = &res.ExpiresAt
	}
	if err := s.tokens.SaveTokens(ctx, userID, conn.ID, res.AccessToken, res.RefreshToken, expires); err != nil {
		// The connection row without its tokens is a connection that cannot
		// serve, so it is removed rather than left as a broken card.
		_ = s.conns.DeleteConnection(ctx, userID, conn.ID)
		return nil, err
	}
	return conn, nil
}

// GeminiConsentURL builds the Google consent URL the user visits to obtain an
// authorisation code for the Code Assist lane.
//
// Without this the Settings card asked the user to construct a Google OAuth URL
// by hand — the correct scope, `access_type=offline` and `prompt=consent`
// included, the last two being what make Google return a refresh token at all.
// Getting any of them wrong produces a connection that works for an hour.
func (s *Service) GeminiConsentURL(redirectURI string) (string, error) {
	if !s.lanesEnabled() {
		return "", oauth.ErrLanesDisabled
	}
	if strings.TrimSpace(redirectURI) == "" {
		return "", invalid("a redirect URI is required — it must be one registered with your Google OAuth client")
	}
	u, err := oauth.GeminiAuthURL(strings.TrimSpace(redirectURI))
	if errors.Is(err, oauth.ErrRedirectNotAllowed) {
		return "", invalid("that redirect URI is not one this deployment registered (" + oauth.GeminiRedirectsEnv + ")")
	}
	return u, err
}

// SaveGeminiSubConnection exchanges a pasted authorisation code, onboards the
// account onto its Code Assist tier, and stores the result.
func (s *Service) SaveGeminiSubConnection(ctx context.Context, userID uuid.UUID, name, code, redirectURI string) (*store.ProviderConnection, error) {
	if !s.lanesEnabled() {
		return nil, oauth.ErrLanesDisabled
	}
	if strings.TrimSpace(code) == "" {
		return nil, invalid("an authorisation code is required")
	}
	if !oauth.GeminiRedirectAllowed(redirectURI) {
		return nil, invalid("that redirect URI is not one this deployment registered (" + oauth.GeminiRedirectsEnv + ")")
	}

	res, err := oauth.ExchangeGeminiCode(ctx, code, redirectURI)
	if err != nil {
		return nil, err
	}
	// An empty project id here is an EXPECTED outcome, not a failure: it means
	// Google refuses this account a Code Assist tier, which is what the spike
	// measured. The connection is stored anyway so the readiness matrix can
	// explain it in the one place a user will look.
	projectID, err := oauth.OnboardCodeAssist(ctx, res.AccessToken)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(name) == "" {
		name = "Gemini Code Assist"
	}
	conn, err := s.conns.CreateConnection(ctx, userID, store.NewProviderConnection{
		Provider: providers.ProviderGeminiSub,
		Kind:     store.KindOAuthGeminiSub,
		Name:     strings.TrimSpace(name),
		Settings: store.ConnectionSettings{OAuth: &store.OAuthMeta{
			Flow:      string(oauth.FlowGeminiCodeAssist),
			ProjectID: projectID,
			Scope:     res.Scope,
		}},
	})
	if errors.Is(err, store.ErrDuplicateConnectionName) {
		return nil, invalid("you already have a connection named %q", name)
	}
	if err != nil {
		return nil, err
	}

	var expires *time.Time
	if !res.ExpiresAt.IsZero() {
		expires = &res.ExpiresAt
	}
	if err := s.tokens.SaveTokens(ctx, userID, conn.ID, res.AccessToken, res.RefreshToken, expires); err != nil {
		_ = s.conns.DeleteConnection(ctx, userID, conn.ID)
		return nil, err
	}
	return conn, nil
}

// normalizeBaseFor turns whatever the user pasted into the ONE canonical shape
// every client for that provider expects.
//
// Gemini needs its own branch because the OpenAI-shim base Google's docs show
// (".../v1beta/openai") is not a base parse and embed can use. Whichever of the
// two a user pastes, the stored value is the NATIVE base; the chat client adds
// the shim suffix when it builds its URL (see models.go).
func normalizeBaseFor(provider, raw string) string {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	if base == "" {
		return ""
	}
	if provider == providers.ProviderGemini {
		base = strings.TrimRight(strings.TrimSuffix(base, GeminiShimSuffix), "/")
	}
	return security.NormalizeAPIBase(base, versionSegmentFor(provider))
}

// versionSegmentFor returns the API version a provider's base URL must end in.
//
// Appending it when the user left it off is what prevents the silent failure
// measured on 2026-09-16: a base without its version segment returns HTTP 200
// with an EMPTY body and finish_reason "stop", so the user sees a blank answer
// rather than an error (reports/spike-providers.md).
func versionSegmentFor(provider string) string {
	switch provider {
	case providers.ProviderGemini:
		return "v1beta"
	case providers.ProviderOpenAI, providers.ProviderAnthropic,
		providers.ProviderOpenRouter, providers.ProviderOpenAICompat:
		return "v1"
	default:
		return ""
	}
}

// endpointErrorMessage turns an SSRF rejection into something a user can act
// on, without echoing the address that was refused — a validation message is
// not a place to confirm which internal hosts exist.
func endpointErrorMessage(err error) string {
	switch {
	case errors.Is(err, security.ErrSSRFPrivateIP), errors.Is(err, security.ErrSSRFLoopback),
		errors.Is(err, security.ErrSSRFLinkLocal), errors.Is(err, security.ErrSSRFMulticast):
		return "that base URL points at a private or internal address, which is not allowed"
	case strings.Contains(err.Error(), "only https"):
		return "the base URL must start with https://"
	case strings.Contains(err.Error(), "DNS"):
		return "that base URL's hostname could not be resolved"
	default:
		return "that base URL is not a valid endpoint"
	}
}
