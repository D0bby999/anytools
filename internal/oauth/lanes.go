package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/D0bby999/anytools/internal/config"
)

// lanes.go — how a subscription connection comes into existence.
//
// There are exactly two shapes, and the difference between them is the whole
// finding of spike A2.
//
// ChatGPT is a RELAY: the user obtains a token triple themselves (by running
// the CLI, which completes a PKCE loopback on their own machine) and pastes it
// here. The server never starts an authorisation, because it cannot — the
// redirect target is the user's own 127.0.0.1:1455. Any future code here that
// builds a ChatGPT authorisation URL is wrong by construction.
//
// Gemini Code Assist IS server-completable, because Google's installed-app flow
// takes a redirect the server controls. It needs a client id and secret the
// owner supplies (see clientPair), then a two-call onboarding to find out which
// Cloud project the account's Code Assist tier lives in.

// RelayTokens is the triple a user pastes for the ChatGPT lane.
type RelayTokens struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	AccountID    string
}

// Validate rejects a paste that cannot work, with a message that says which
// part is missing.
//
// account_id is required, not optional: chatgpt-account-id is how the upstream
// knows which subscription a multi-tenant request is spending, and a triple
// without it produces a 401 the user would read as "my token is wrong".
func (t RelayTokens) Validate() error {
	switch {
	case strings.TrimSpace(t.AccessToken) == "":
		return fmt.Errorf("oauth: access_token is required")
	case strings.TrimSpace(t.RefreshToken) == "":
		return fmt.Errorf("oauth: refresh_token is required — without it the connection dies at the next expiry")
	case strings.TrimSpace(t.AccountID) == "":
		return fmt.Errorf("oauth: account_id is required for the ChatGPT lane")
	}
	return nil
}

// Result converts the paste into a TokenResult.
func (t RelayTokens) Result() *TokenResult {
	out := &TokenResult{
		AccessToken:  strings.TrimSpace(t.AccessToken),
		RefreshToken: strings.TrimSpace(t.RefreshToken),
		AccountID:    strings.TrimSpace(t.AccountID),
	}
	if t.ExpiresIn > 0 {
		out.ExpiresAt = time.Now().Add(time.Duration(t.ExpiresIn) * time.Second)
	}
	return out
}

// GeminiAuthURL builds the Google consent URL for the Code Assist lane.
//
// `access_type=offline` + `prompt=consent` is what makes Google return a
// refresh token at all; without both, a re-authorisation returns only an access
// token and the connection dies in an hour.
//
// No `state` parameter, deliberately. State exists to bind a callback to the
// browser session that started it, and this flow has no callback: the user
// copies the code out of Google's page and pastes it into Settings themselves.
// A state value nothing verifies is security theatre, and shipping one would
// suggest a CSRF defence that is not there.
func GeminiAuthURL(redirectURI string) (string, error) {
	id, _, ok := clientPair()
	if !ok {
		return "", ErrNoClientPair
	}
	if !GeminiRedirectAllowed(redirectURI) {
		return "", ErrRedirectNotAllowed
	}
	q := url.Values{
		"client_id":     {id},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		// cloud-platform is the scope Code Assist requires and the reason this
		// lane is gated: it is a full Google Cloud grant for that user.
		"scope":       {"openid email profile https://www.googleapis.com/auth/cloud-platform"},
		"access_type": {"offline"},
		"prompt":      {"consent"},
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + q.Encode(), nil
}

// ExchangeGeminiCode swaps an authorisation code for tokens.
func ExchangeGeminiCode(ctx context.Context, code, redirectURI string) (*TokenResult, error) {
	id, secret, ok := clientPair()
	if !ok {
		return nil, ErrNoClientPair
	}
	form := url.Values{
		"client_id":     {id},
		"client_secret": {secret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirectURI},
	}
	raw, err := postToken(ctx, googleTokenURL, "application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()), nil)
	if err != nil {
		return nil, err
	}
	return decodeTokenResponse(raw, "")
}

// OnboardCodeAssist finds the Cloud project the account's Code Assist tier
// lives in, onboarding it if Google says it needs onboarding first.
//
// An EMPTY project id with no error is a real, expected outcome and the one the
// spike measured on the owner's account: Google refuses that account a Code
// Assist tier (403 VALIDATION_REQUIRED), which is precisely why no project was
// ever assigned. The caller stores the empty value and the readiness matrix
// explains it, rather than this function inventing a project that does not
// exist.
func OnboardCodeAssist(ctx context.Context, accessToken string) (projectID string, err error) {
	load, err := codeAssistCall(ctx, accessToken, "loadCodeAssist", map[string]any{
		"metadata": map[string]any{"pluginType": "GEMINI"},
	})
	if err != nil {
		return "", err
	}
	var loaded struct {
		CloudaicompanionProject string `json:"cloudaicompanionProject"`
		CurrentTier             *struct {
			ID string `json:"id"`
		} `json:"currentTier"`
		AllowedTiers []struct {
			ID        string `json:"id"`
			IsDefault bool   `json:"isDefault"`
		} `json:"allowedTiers"`
	}
	if err := json.Unmarshal(load, &loaded); err != nil {
		return "", fmt.Errorf("oauth: decode loadCodeAssist: %w", err)
	}
	if loaded.CloudaicompanionProject != "" {
		return loaded.CloudaicompanionProject, nil
	}

	tier := ""
	if loaded.CurrentTier != nil {
		tier = loaded.CurrentTier.ID
	}
	if tier == "" {
		for _, t := range loaded.AllowedTiers {
			if t.IsDefault {
				tier = t.ID
				break
			}
		}
	}
	if tier == "" {
		// No tier to onboard into. Not an error: it is the answer.
		return "", nil
	}

	onboard, err := codeAssistCall(ctx, accessToken, "onboardUser", map[string]any{
		"tierId":   tier,
		"metadata": map[string]any{"pluginType": "GEMINI"},
	})
	if err != nil {
		return "", err
	}
	var onboarded struct {
		Response struct {
			CloudaicompanionProject struct {
				ID string `json:"id"`
			} `json:"cloudaicompanionProject"`
		} `json:"response"`
	}
	if err := json.Unmarshal(onboard, &onboarded); err != nil {
		return "", fmt.Errorf("oauth: decode onboardUser: %w", err)
	}
	return onboarded.Response.CloudaicompanionProject.ID, nil
}

func codeAssistCall(ctx context.Context, accessToken, method string, body map[string]any) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://cloudcode-pa.googleapis.com/v1internal:"+method, strings.NewReader(string(data)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := newClient(30 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("oauth: %s unreachable: %w", method, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oauth: %s returned HTTP %d — this Google account may not have a Code Assist tier; "+
			"sign in once at https://antigravity.google with it and try again", method, resp.StatusCode)
	}
	return raw, nil
}

// GeminiRedirectsEnv lists, comma-separated, the redirect URIs this
// deployment registered on its Gemini Code Assist OAuth client.
const GeminiRedirectsEnv = "ANYTOOLS_GEMINI_SUB_REDIRECT_URIS"

// ErrRedirectNotAllowed is returned for a redirect URI the operator did not
// list in GeminiRedirectsEnv.
var ErrRedirectNotAllowed = errors.New("oauth: that redirect URI is not one this deployment registered")

// GeminiRedirectAllowed reports whether uri is on the operator's list.
//
// The URI used to be taken from the request as-is (security audit F-10).
// Google refuses unregistered redirects today, but a permissively registered
// client would then have turned this into an open redirect carrying an
// authorisation code. An allowlist makes that impossible whatever the client
// registration says; an empty list allows nothing.
func GeminiRedirectAllowed(uri string) bool {
	uri = strings.TrimSpace(uri)
	if uri == "" {
		return false
	}
	for _, allowed := range strings.Split(config.Getenv(GeminiRedirectsEnv), ",") {
		if strings.TrimSpace(allowed) == uri {
			return true
		}
	}
	return false
}
