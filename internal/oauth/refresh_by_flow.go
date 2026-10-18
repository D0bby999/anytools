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
)

// refresh_by_flow.go — the per-lane token endpoints.
//
// Both lanes ROTATE: a successful refresh mints a new refresh token and kills
// the one that was used. That single fact is why the advisory lock in token.go
// is mandatory rather than nice to have, and why SaveOAuthCredential must
// persist the new refresh token even when the caller's request is failing.

// ChatGPTClientID is the Codex CLI's public client id.
//
// It is a PUBLIC client (no secret), which is the only reason it can appear in
// source at all. It is also the impersonation RT-1 names: a hosted server using
// it claims, by design indistinguishably, to be the first-party CLI on the
// user's own machine. That claim is what the experimental flag and the Settings
// warning copy exist to make explicit to the user before they opt in.
const ChatGPTClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

const (
	chatGPTTokenURL = "https://auth.openai.com/oauth/token"
	googleTokenURL  = "https://oauth2.googleapis.com/token"
	refreshTimeout  = 30 * time.Second
)

// ErrPermanentGrantFailure marks a refresh the provider will never accept again
// — a revoked, rotated-away or otherwise dead refresh token. The remedy is for
// the user to reconnect, so it is reported rather than retried.
var ErrPermanentGrantFailure = errors.New("oauth: refresh token is no longer valid")

// IsPermanentGrantFailure reports whether err means "reconnect", as opposed to
// "the token endpoint was briefly unreachable".
//
// The distinction earns its keep: treating a transient 503 as permanent marks a
// healthy connection dead in the UI, and treating a revoked grant as transient
// retries forever while the user sees nothing wrong.
func IsPermanentGrantFailure(err error) bool { return errors.Is(err, ErrPermanentGrantFailure) }

// DefaultRefresh dispatches to the lane's token endpoint.
func DefaultRefresh(ctx context.Context, flow Flow, refreshToken string) (*TokenResult, error) {
	switch flow {
	case FlowChatGPTRelay:
		return refreshChatGPT(ctx, refreshToken)
	case FlowGeminiCodeAssist:
		return refreshGoogle(ctx, refreshToken)
	case FlowClaudeSub:
		return refreshClaude(ctx, refreshToken)
	default:
		// FlowGitHubCopilot included: its GitHub token has no expiry and no
		// refresh token, so the token service never asks.
		return nil, fmt.Errorf("oauth: unknown flow %q", flow)
	}
}

func refreshChatGPT(ctx context.Context, refreshToken string) (*TokenResult, error) {
	body, _ := json.Marshal(map[string]string{
		"client_id":     ChatGPTClientID,
		"grant_type":    "refresh_token",
		"refresh_token": refreshToken,
	})
	raw, err := postToken(ctx, chatGPTTokenURL, "application/json", strings.NewReader(string(body)),
		map[string]string{"User-Agent": "codex_cli_rs/0.136.0"})
	if err != nil {
		return nil, err
	}
	return decodeTokenResponse(raw, refreshToken)
}

func refreshGoogle(ctx context.Context, refreshToken string) (*TokenResult, error) {
	id, secret, ok := clientPair()
	if !ok {
		return nil, ErrNoClientPair
	}
	form := url.Values{
		"client_id":     {id},
		"client_secret": {secret},
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}
	raw, err := postToken(ctx, googleTokenURL, "application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()), nil)
	if err != nil {
		return nil, err
	}
	return decodeTokenResponse(raw, refreshToken)
}

func postToken(ctx context.Context, endpoint, contentType string, body io.Reader, headers map[string]string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, refreshTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	// SafeClient, not SafeBYOKClient: a token endpoint is a fixed address of
	// ours, never a user-supplied base, so the private-endpoint escape hatch
	// must not apply to it.
	resp, err := newClient(refreshTimeout).Do(req)
	if err != nil {
		return nil, fmt.Errorf("token endpoint unreachable: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		// 400 with an OAuth error body is the shape of a dead grant; 401/403
		// mean the same in practice. Everything else — 429, 5xx, a proxy error
		// page — is transient and must not mark the connection dead.
		if resp.StatusCode == http.StatusBadRequest ||
			resp.StatusCode == http.StatusUnauthorized ||
			resp.StatusCode == http.StatusForbidden {
			return nil, fmt.Errorf("%w (HTTP %d)", ErrPermanentGrantFailure, resp.StatusCode)
		}
		return nil, fmt.Errorf("token endpoint returned HTTP %d", resp.StatusCode)
	}
	return raw, nil
}

// decodeTokenResponse parses the common OAuth token body.
//
// priorRefresh is carried forward when the provider does not return a new one:
// omitting `refresh_token` means "keep using the one you have", and treating it
// as an empty string would blank a live credential on the next save.
func decodeTokenResponse(raw []byte, priorRefresh string) (*TokenResult, error) {
	var r struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("decode token response: %w", err)
	}
	if r.AccessToken == "" {
		return nil, fmt.Errorf("%w: token endpoint returned no access token", ErrPermanentGrantFailure)
	}
	out := &TokenResult{
		AccessToken:  r.AccessToken,
		RefreshToken: r.RefreshToken,
		Scope:        r.Scope,
	}
	if out.RefreshToken == "" {
		out.RefreshToken = priorRefresh
	}
	if r.ExpiresIn > 0 {
		out.ExpiresAt = time.Now().Add(time.Duration(r.ExpiresIn) * time.Second)
	}
	return out, nil
}
